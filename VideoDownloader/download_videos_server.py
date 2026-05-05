"""Local helper that downloads YouTube / Bilibili videos as MP4 via yt-dlp.

Requirements:
    pip install -U yt-dlp
    ffmpeg must be installed and available on PATH.
        Windows:  winget install FFmpeg
        macOS:    brew install ffmpeg
        Linux:    sudo apt install ffmpeg

Run:
    python download_videos_server.py

Then open http://localhost:55010/ in your browser, paste URLs, click Start.
Downloaded MP4s are stored under ./downloads/ next to this script and are
available at http://localhost:55010/files/<filename>.
"""
from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

ROOT_DIR = Path(__file__).resolve().parent
DOWNLOAD_DIR = ROOT_DIR / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)
PORT = 55010

# job_id -> { "q": Queue, "done": bool, "files": [relpath] }
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()

HTML_FILE = ROOT_DIR / "downloadVideos.html"


def find_ytdlp() -> list[str] | None:
    exe = shutil.which("yt-dlp") or shutil.which("yt-dlp.exe")
    if exe:
        return [exe]
    # fall back to "python -m yt_dlp"
    try:
        subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--version"],
            check=True, capture_output=True,
        )
        return [sys.executable, "-m", "yt_dlp"]
    except Exception:
        return None


YTDLP_CMD = find_ytdlp()


def find_ffmpeg() -> str | None:
    """Return the ffmpeg executable path if found, else None."""
    exe = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
    if exe:
        return exe
    return None


FFMPEG_CMD = find_ffmpeg()


def emit(job_id: str, event: dict) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job:
        job["q"].put(event)


PROGRESS_RE = re.compile(r"\[download\]\s+([\d\.]+)%")
DEST_RE = re.compile(r"\[download\] Destination:\s+(.+)")
MERGER_RE = re.compile(r'\[Merger\] Merging formats into "(.+)"')
ALREADY_RE = re.compile(r"\[download\]\s+(.+?)\s+has already been downloaded")

# Cookies file for sites that need auth (e.g. Bilibili).
# Export from Chrome via "Get cookies.txt LOCALLY" extension and save here.
COOKIES_FILE = ROOT_DIR / "cookies.txt"


def run_job(job_id: str, urls: list[str]) -> None:
    if not YTDLP_CMD:
        emit(job_id, {"type": "error",
                      "message": "yt-dlp not found. Run: pip install -U yt-dlp"})
        emit(job_id, {"type": "done"})
        return

    for idx, url in enumerate(urls):
        emit(job_id, {"type": "start", "index": idx, "url": url})
        out_template = str(DOWNLOAD_DIR / "%(title).150B [%(id)s].%(ext)s")
        cmd = [
            *YTDLP_CMD,
            "--newline",
            "--no-colors",
            "--progress",
            "--merge-output-format", "mp4",
            # Prefer mp4-compatible streams; fall back to best.
            "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
            "-o", out_template,
        ]
        # Bilibili requires cookies to avoid HTTP 412.
        if "bilibili.com" in url:
            if COOKIES_FILE.is_file():
                cmd += ["--cookies", str(COOKIES_FILE)]
            else:
                emit(job_id, {"type": "log", "index": idx,
                      "message": "Warning: cookies.txt not found. Bilibili may reject the request. "
                                 "Export cookies from Chrome using 'Get cookies.txt LOCALLY' extension "
                                 "and save as cookies.txt next to this script."})
        # YouTube increasingly requires cookies to bypass bot/anti-abuse checks.
        if "youtube.com" in url or "youtu.be" in url:
            if COOKIES_FILE.is_file():
                cmd += ["--cookies", str(COOKIES_FILE)]
            else:
                # Try to read cookies directly from an installed browser.
                # User can override via env var YTDLP_BROWSER (e.g. "chrome", "edge", "firefox").
                browser = os.environ.get("YTDLP_BROWSER", "chrome")
                cmd += ["--cookies-from-browser", browser]
                emit(job_id, {"type": "log", "index": idx,
                      "message": f"YouTube: using --cookies-from-browser {browser}. "
                                 f"If this fails, export cookies.txt or set env YTDLP_BROWSER=edge|firefox."})
        cmd.append(url)
        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1,
            )
        except Exception as exc:
            emit(job_id, {"type": "log", "index": idx,
                          "message": f"spawn failed: {exc}"})
            emit(job_id, {"type": "result", "index": idx,
                          "ok": False, "file": None})
            continue

        final_path: Path | None = None
        last_dest: Path | None = None
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            emit(job_id, {"type": "log", "index": idx, "message": line})
            m = PROGRESS_RE.search(line)
            if m:
                try:
                    emit(job_id, {"type": "progress", "index": idx,
                                  "percent": float(m.group(1))})
                except ValueError:
                    pass
                continue
            m = DEST_RE.search(line)
            if m:
                last_dest = Path(m.group(1).strip())
                continue
            m = MERGER_RE.search(line)
            if m:
                final_path = Path(m.group(1).strip())
                continue
            m = ALREADY_RE.search(line)
            if m:
                final_path = Path(m.group(1).strip())
                continue

        rc = proc.wait()
        if rc == 0:
            path = final_path or last_dest
            rel = None
            if path:
                try:
                    rel = path.resolve().relative_to(DOWNLOAD_DIR).as_posix()
                except Exception:
                    rel = path.name
            emit(job_id, {"type": "result", "index": idx,
                          "ok": True, "file": rel})
        else:
            emit(job_id, {"type": "result", "index": idx,
                          "ok": False, "file": None,
                          "message": f"yt-dlp exited with code {rc}"})

    emit(job_id, {"type": "done"})


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # quieter
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        if path in ("/", "/index.html", "/downloadVideos.html"):
            self._serve_html()
            return
        if path.startswith("/files/"):
            self._serve_file(path[len("/files/"):])
            return
        if path == "/api/check":
            self._serve_check()
            return
        if path == "/api/list":
            self._serve_list()
            return
        if path.startswith("/api/events"):
            job_id = parsed.query.split("job=", 1)[-1] if "job=" in parsed.query else ""
            self._serve_events(job_id)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/api/download":
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length).decode("utf-8") if length else "{}"
            try:
                data = json.loads(body)
            except Exception:
                self.send_error(400, "bad json")
                return
            urls = [u.strip() for u in data.get("urls", []) if u and u.strip()]
            if not urls:
                self.send_error(400, "no urls")
                return
            job_id = uuid.uuid4().hex
            with JOBS_LOCK:
                JOBS[job_id] = {"q": queue.Queue(), "done": False}
            threading.Thread(target=run_job, args=(job_id, urls),
                             daemon=True).start()
            payload = json.dumps({"job": job_id, "count": len(urls)}).encode()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if parsed.path == "/api/delete":
            self._handle_delete()
            return
        self.send_error(404)

    def _serve_html(self) -> None:
        if not HTML_FILE.exists():
            self.send_error(404, "downloadVideos.html missing")
            return
        data = HTML_FILE.read_bytes()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_file(self, rel: str) -> None:
        rel = rel.replace("\\", "/")
        target = (DOWNLOAD_DIR / rel).resolve()
        try:
            target.relative_to(DOWNLOAD_DIR.resolve())
        except ValueError:
            self.send_error(403)
            return
        if not target.is_file():
            self.send_error(404)
            return
        size = target.stat().st_size
        self.send_response(200)
        self._cors()
        ext = target.suffix.lower()
        ctype = {
            ".mp4": "video/mp4",
            ".webm": "video/webm",
            ".mkv": "video/x-matroska",
            ".m4a": "audio/mp4",
        }.get(ext, "application/octet-stream")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        safe_ascii_name = target.name.encode("ascii", "replace").decode("ascii")
        encoded_name = quote(target.name, safe="")
        disposition = "inline" if ext in {".mp4", ".webm", ".mkv", ".m4a"} else "attachment"
        self.send_header(
            "Content-Disposition",
            f"{disposition}; filename=\"{safe_ascii_name}\"; filename*=UTF-8''{encoded_name}",
        )
        self.end_headers()
        with target.open("rb") as fh:
            shutil.copyfileobj(fh, self.wfile)

    def _handle_delete(self) -> None:
        """Delete specified files from the downloads directory."""
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            data = json.loads(body)
        except Exception:
            self.send_error(400, "bad json")
            return
        files: list[str] = data.get("files", [])
        if not files:
            self.send_error(400, "no files specified")
            return
        deleted = []
        errors = []
        for rel in files:
            rel = rel.replace("\\", "/")
            target = (DOWNLOAD_DIR / rel).resolve()
            try:
                target.relative_to(DOWNLOAD_DIR.resolve())
            except ValueError:
                errors.append({"file": rel, "error": "path traversal blocked"})
                continue
            if target.is_file():
                try:
                    target.unlink()
                    deleted.append(rel)
                except Exception as exc:
                    errors.append({"file": rel, "error": str(exc)})
            else:
                errors.append({"file": rel, "error": "not found"})
        payload = json.dumps({"deleted": deleted, "errors": errors}).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_check(self) -> None:
        """Return JSON with install status of yt-dlp and ffmpeg."""
        result = {
            "ytdlp": {"installed": YTDLP_CMD is not None,
                      "cmd": " ".join(YTDLP_CMD) if YTDLP_CMD else None},
            "ffmpeg": {"installed": FFMPEG_CMD is not None,
                       "cmd": FFMPEG_CMD},
        }
        payload = json.dumps(result).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_list(self) -> None:
        items = []
        for p in sorted(DOWNLOAD_DIR.rglob("*")):
            if p.is_file():
                rel = p.relative_to(DOWNLOAD_DIR).as_posix()
                items.append({
                    "name": rel,
                    "size": p.stat().st_size,
                    "url": f"/files/{quote(rel, safe='/')}",
                })
        payload = json.dumps({"files": items}).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_events(self, job_id: str) -> None:
        with JOBS_LOCK:
            job = JOBS.get(job_id)
        if not job:
            self.send_error(404, "unknown job")
            return
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        q: queue.Queue = job["q"]
        try:
            while True:
                try:
                    ev = q.get(timeout=15)
                except queue.Empty:
                    try:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                    except Exception:
                        return
                    continue
                try:
                    self.wfile.write(f"data: {json.dumps(ev)}\n\n".encode())
                    self.wfile.flush()
                except Exception:
                    return
                if ev.get("type") == "done":
                    with JOBS_LOCK:
                        JOBS.pop(job_id, None)
                    return
        except (BrokenPipeError, ConnectionResetError):
            return


def main() -> None:
    print(f"Video download server: http://localhost:{PORT}/")
    print(f"Saving to: {DOWNLOAD_DIR}")
    if not YTDLP_CMD:
        print("WARNING: yt-dlp not found. Install with: pip install -U yt-dlp")
    else:
        print(f"Using yt-dlp: {' '.join(YTDLP_CMD)}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
