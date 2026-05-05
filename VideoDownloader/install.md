# VideoDownloader – Installation

## 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

## 2. Install ffmpeg

ffmpeg is required by yt-dlp to merge video and audio streams into MP4.

| OS      | Command                        |
|---------|--------------------------------|
| Windows | `winget install FFmpeg`         |
| macOS   | `brew install ffmpeg`           |
| Linux   | `sudo apt install ffmpeg`       |

Verify it's on PATH:

```bash
ffmpeg -version
```

## 3. YouTube-only extras

Bilibili works out of the box. **YouTube** additionally requires:

### 3.1 Deno (JavaScript runtime)

YouTube uses an "n challenge" that needs a JS runtime to solve. Install Deno:

| OS      | Command                              |
|---------|--------------------------------------|
| Windows | `winget install DenoLand.Deno`       |
| macOS   | `brew install deno`                  |
| Linux   | `curl -fsSL https://deno.land/install.sh \| sh` |

Verify:

```bash
deno --version
```

### 3.2 yt-dlp-ejs (challenge solver)

```bash
pip install -U yt-dlp-ejs
```

### 3.3 cookies.txt (login required)

YouTube blocks unauthenticated downloads as "bot traffic". Export your YouTube cookies:

1. Install the browser extension **"Get cookies.txt LOCALLY"** (Chrome / Edge / Firefox).
2. Visit <https://www.youtube.com/> while logged in.
3. Click the extension icon → **Export** → save as `cookies.txt`.
4. Place the file next to this script:
	```
	tools/VideoDownloader/cookies.txt
	```

> The server automatically uses `cookies.txt` if present. The same file works for Bilibili too if you ever need to download member-only content.

> **Security:** `cookies.txt` contains your active YouTube session. It is git-ignored, but do not commit or share it.

## 4. Run the server

```bash
python download_videos_server.py
```

Open <http://localhost:55010/> in your browser, paste video URLs, and click **Start**.

Downloaded MP4s are saved to the `downloads/` folder and served at `http://localhost:55010/files/<filename>`.
