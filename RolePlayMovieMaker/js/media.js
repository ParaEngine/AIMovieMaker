// ============ Timeline media abstraction (MP4 <video> | YouTube iframe) ============
import { ui } from './ui.js';
import { log } from './utils.js';
import { media } from './state.js';
import { loadSettings, saveSettings } from './settings.js';
// Lazy peer imports to break circular references with the annotation editor view.
import { rebuildTimeline, drawPreviewCanvas, updateCursor, updateActiveBars, updateReadout } from './view_video_annotation_editor.js';

export function parseYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return id || null;
    }
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
      if (m) return m[2];
    }
  } catch {}
  return null;
}

function setTimelineSourceHint(text) {
  if (!ui.timelineSourceHint) return;
  const hint = text || '尚未加载视频。';
  const labelEl = ui.timelineSourceHint.querySelector('.source-label');
  if (labelEl) labelEl.textContent = sourceLabel(hint);
  ui.timelineSourceHint.title = hint;
  ui.timelineSourceHint.setAttribute('aria-label', hint);
}

function sourceLabel(text) {
  const raw = String(text || '').replace(/^来源(?:（YouTube）)?：/, '').trim();
  if (!raw) return '尚未加载视频';
  let label = raw;
  try {
    const url = new URL(raw);
    const ytId = parseYouTubeId(raw);
    label = ytId ? `YouTube: ${ytId}` : `${url.hostname}${url.pathname}`;
  } catch {}
  return label.length > 34 ? `${label.slice(0, 31)}...` : label;
}

/* Public entry point: switch the timeline player to the given URL. */
export function setTimelineMediaSrc(url, info = {}) {
  if (!url) return;
  const ytId = parseYouTubeId(url);
  if (ytId) {
    switchToYouTube(ytId, info.label || url);
  } else {
    switchToVideoEl(url, info.label || (info.kind === 'file' ? 'Local file' : url));
  }
}
// Back-compat alias.
export const setTimelineVideoSrc = setTimelineMediaSrc;

function switchToVideoEl(url, label) {
  destroyYouTubePlayer();
  media.mode = 'video';
  if (ui.timelineYT) ui.timelineYT.style.display = 'none';
  if (ui.timelineVideo) {
    ui.timelineVideo.style.display = '';
    ui.timelineVideo.src = url;
    ui.timelineVideo.load();
  }
  setTimelineSourceHint(`来源：${label}`);
}

function switchToYouTube(videoId, label) {
  if (ui.timelineVideo) {
    try { ui.timelineVideo.pause(); } catch {}
    ui.timelineVideo.removeAttribute('src');
    try { ui.timelineVideo.load(); } catch {}
    ui.timelineVideo.style.display = 'none';
  }
  if (ui.timelineYT) ui.timelineYT.style.display = '';
  setTimelineSourceHint(`来源（YouTube）：${label}`);

  loadYouTubeApi().then(() => {
    if (media.ytPlayer && typeof media.ytPlayer.cueVideoById === 'function') {
      media.ytPlayer.cueVideoById(videoId);
      media.ytPaused = true;
      return;
    }
    media.ytPlayer = new window.YT.Player(ui.timelineYT, {
      videoId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1, autoplay: 0 },
      events: {
        onReady: () => {
          media.ytReady = true;
          media.mode = 'youtube';
          startYouTubePoll();
          try {
            media.ytDuration = media.ytPlayer.getDuration() || 0;
          } catch { media.ytDuration = 0; }
          rebuildTimeline();
          drawPreviewCanvas();
        },
        onStateChange: (e) => {
          // 1=playing, 2=paused, 0=ended
          media.ytPaused = e.data !== 1;
          try {
            const d = media.ytPlayer.getDuration();
            if (d && d !== media.ytDuration) {
              media.ytDuration = d;
              rebuildTimeline();
            }
          } catch {}
        },
      },
    });
  }).catch(err => {
    log(`YouTube 播放器加载失败：${err.message || err}`, 'err');
  });
}

function destroyYouTubePlayer() {
  if (media.ytPollTimer) { clearInterval(media.ytPollTimer); media.ytPollTimer = null; }
  if (media.ytSeekPauseTimer) { clearTimeout(media.ytSeekPauseTimer); media.ytSeekPauseTimer = null; }
  if (media.ytPlayer && typeof media.ytPlayer.destroy === 'function') {
    try { media.ytPlayer.destroy(); } catch {}
  }
  media.ytPlayer = null;
  media.ytReady = false;
  media.ytDuration = 0;
  media.ytPaused = true;
  media.ytLastTime = 0;
  media.ytSeekTarget = null;
  media.ytSeekSettlingUntil = 0;
}

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (media.ytApiPromise) return media.ytApiPromise;
  media.ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch {} resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => reject(new Error('加载 YouTube IFrame API 失败'));
    document.head.appendChild(s);
  });
  return media.ytApiPromise;
}

function startYouTubePoll() {
  if (media.ytPollTimer) clearInterval(media.ytPollTimer);
  media.ytPollTimer = setInterval(() => {
    if (media.mode !== 'youtube' || !media.ytPlayer) return;
    let t = 0, d = 0;
    try { t = media.ytPlayer.getCurrentTime() || 0; } catch {}
    try { d = media.ytPlayer.getDuration() || 0; } catch {}
    if (d && d !== media.ytDuration) {
      media.ytDuration = d;
      rebuildTimeline();
    }
    if (media.ytSeekTarget !== null && Date.now() < media.ytSeekSettlingUntil && Math.abs(t - media.ytSeekTarget) > 0.35) {
      media.ytLastTime = media.ytSeekTarget;
    } else {
      media.ytLastTime = t;
      media.ytSeekTarget = null;
      media.ytSeekSettlingUntil = 0;
    }
    updateCursor();
    updateActiveBars();
    updateReadout();
    drawPreviewCanvas();
  }, 200);
}

/* Unified accessors used by the timeline / preview code. */
export function mediaCurrentTime() {
  if (media.mode === 'youtube') return media.ytLastTime || 0;
  return ui.timelineVideo ? (ui.timelineVideo.currentTime || 0) : 0;
}
export function mediaDuration() {
  if (media.mode === 'youtube') return media.ytDuration || 0;
  const d = ui.timelineVideo ? ui.timelineVideo.duration : 0;
  return isFinite(d) ? d : 0;
}
export function mediaPaused() {
  if (media.mode === 'youtube') return !!media.ytPaused;
  return ui.timelineVideo ? ui.timelineVideo.paused : true;
}
export function mediaPlay() {
  if (media.mode === 'youtube') { try { media.ytPlayer && media.ytPlayer.playVideo(); } catch {} return; }
  if (ui.timelineVideo) ui.timelineVideo.play().catch(() => {});
}
export function mediaPause() {
  if (media.mode === 'youtube') { try { media.ytPlayer && media.ytPlayer.pauseVideo(); } catch {} return; }
  if (ui.timelineVideo) ui.timelineVideo.pause();
}
export function mediaSeek(t) {
  const nextTime = Math.max(0, t);
  if (media.mode === 'youtube') {
    const wasPaused = !!media.ytPaused;
    media.ytSeekTarget = nextTime;
    media.ytSeekSettlingUntil = Date.now() + 1200;
    try { media.ytPlayer && media.ytPlayer.seekTo(nextTime, true); } catch {}
    media.ytLastTime = nextTime;
    if (wasPaused && media.ytPlayer) {
      const token = ++media.ytSeekPauseToken;
      if (media.ytSeekPauseTimer) clearTimeout(media.ytSeekPauseTimer);
      try { media.ytPlayer.playVideo(); } catch {}
      media.ytSeekPauseTimer = setTimeout(() => {
        if (token !== media.ytSeekPauseToken || media.mode !== 'youtube' || !media.ytPlayer) return;
        try { media.ytPlayer.pauseVideo(); } catch {}
        media.ytPaused = true;
      }, 220);
    }
    return;
  }
  if (ui.timelineVideo) ui.timelineVideo.currentTime = nextTime;
}
export function mediaHasSource() {
  if (media.mode === 'youtube') return !!media.ytPlayer;
  return !!(ui.timelineVideo && ui.timelineVideo.src);
}

export function initMedia() {
  /* File input that explicitly drives the timeline player. */
  ui.timelineFileInput.addEventListener('change', () => {
    const f = ui.timelineFileInput.files?.[0];
    if (!f) return;
    setTimelineMediaSrc(URL.createObjectURL(f), { kind: 'file', label: f.name });
  });

  /* Space key toggles play/pause on the output (timeline) video. */
  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!mediaHasSource()) return;
    e.preventDefault();
    if (mediaPaused()) mediaPlay();
    else mediaPause();
  });

  /* Restore last entered URL + feed the timeline preview when it changes. */
  if (!ui.urlInput) return;
  const s = loadSettings();
  if (s.lastUrl) ui.urlInput.value = s.lastUrl;
  if (s.lastUrlMime && ui.urlMime) ui.urlMime.value = s.lastUrlMime;
  const persist = () => {
    const ss = loadSettings();
    ss.lastUrl = ui.urlInput.value.trim();
    ss.lastUrlMime = (ui.urlMime?.value || '').trim();
    saveSettings(ss);
    const u = ss.lastUrl;
    if (u && /^https?:\/\//i.test(u)) setTimelineVideoSrc(u);
  };
  ui.urlInput.addEventListener('change', persist);
  ui.urlMime?.addEventListener('change', persist);
  const u = ui.urlInput.value.trim();
  if (u && /^https?:\/\//i.test(u)) setTimelineVideoSrc(u);
}
