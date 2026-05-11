// ============ Generic utilities ============
import { ui } from './ui.js';

/* ---------------- log helpers ---------------- */
export function log(msg, level = '') {
  const line = document.createElement('div');
  if (level) line.className = level;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${msg}`;
  ui.status.appendChild(line);
  ui.status.scrollTop = ui.status.scrollHeight;
}

export function setProgress(pct) {
  ui.progress.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

export function humanSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function sleep(ms, signal) {
  return new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); });
  });
}

/* Parse "MM:SS,mmm" / "HH:MM:SS,mmm" / "MM:SS.mmm" / plain seconds number into seconds. */
export function parseTimestamp(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(p => p.trim());
  if (parts.length < 2 || parts.length > 3) return parseFloat(s.replace(',', '.')) || 0;
  const last = parts[parts.length - 1].replace(',', '.');
  const sec = parseFloat(last) || 0;
  let h = 0, m = 0;
  if (parts.length === 3) { h = parseInt(parts[0], 10) || 0; m = parseInt(parts[1], 10) || 0; }
  else { m = parseInt(parts[0], 10) || 0; }
  return h * 3600 + m * 60 + sec;
}

export function formatTimecode(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ---------------- file naming ---------------- */
export function sanitizeProjectName(s) {
  return String(s || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '');
}

export function fileFingerprint(file) {
  return `${file.name}|${file.size}|${file.lastModified || 0}`;
}

/* ---------------- downloads ---------------- */
export function triggerDownload(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

export function suggestName(ext) {
  const base = ui.file.files?.[0]?.name?.replace(/\.[^.]+$/, '') || 'video';
  return `${base}.${ext}`;
}

/* ---------------- canvas drawing helpers ---------------- */
export function colorForSpeaker(key) {
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 85%, 70%)`;
}

export function wrapMeasure(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (ctx.measureText(trial).width <= maxWidth) cur = trial;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = wrapMeasure(ctx, text, maxWidth);
  const limited = (maxLines && lines.length > maxLines)
    ? [...lines.slice(0, maxLines - 1), (lines[maxLines - 1] || '') + '\u2026']
    : lines;
  limited.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* XHR-based upload so we get progress events. */
export function fetchWithProgress(url, body, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded);
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, responseText: xhr.responseText });
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal) signal.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
}

export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}
