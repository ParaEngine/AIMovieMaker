// ============ Keepwork SDK loader + Keepwork CDN upload cache ============
import { KEEPWORK_SDK_CDN_URL, LS_KW_UPLOADS } from './constants.js';
import { log, humanSize, fileFingerprint } from './utils.js';
import { setProgress } from './utils.js';

let _sdkPromise = null;

export function loadKeepworkSDK() {
  if (window.keepwork) return Promise.resolve(window.keepwork);
  if (_sdkPromise) return _sdkPromise;
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
    document.head.appendChild(s);
  });
  const isLocal = ['127.0.0.1', 'localhost'].includes(location.hostname);
  _sdkPromise = (isLocal
    ? import('/keepworkSDK/index.js').catch(() => loadScript(KEEPWORK_SDK_CDN_URL))
    : loadScript(KEEPWORK_SDK_CDN_URL)
  ).then(() => {
    if (!window.keepwork) throw new Error('keepworkSDK loaded but window.keepwork missing.');
    return window.keepwork;
  }).catch((e) => { _sdkPromise = null; throw e; });
  return _sdkPromise;
}

export async function ensureKeepworkLogin() {
  const sdk = await loadKeepworkSDK();
  if (sdk.token) return sdk;
  log('请登录 Keepwork 以上传视频…');
  if (typeof sdk.showLoginWindow === 'function') {
    await sdk.showLoginWindow({ title: '登录以上传视频' });
  } else if (sdk.loginWindow?.show) {
    await sdk.loginWindow.show({ title: '登录以上传视频' });
  } else {
    throw new Error('Keepwork loginWindow 不可用。');
  }
  if (!sdk.token) throw new Error('OpenRouter 视频上传需要 Keepwork 登录。');
  try {
    await sdk.getUserProfile?.({ forceRefresh: true, useCache: false });
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('rpmm:loginChanged', { detail: { loggedIn: true } }));
  } catch {}
  log('Keepwork 登录成功。', 'ok');
  return sdk;
}

/* ---------------- Keepwork upload cache (shared across providers) ---------------- */
export function loadKwUploads() {
  try { return JSON.parse(localStorage.getItem(LS_KW_UPLOADS) || '{}') || {}; }
  catch { return {}; }
}
export function saveKwUploads(map) { localStorage.setItem(LS_KW_UPLOADS, JSON.stringify(map)); }

export function getCachedKwUrl(file) {
  if (!file) return null;
  const map = loadKwUploads();
  const entry = map[fileFingerprint(file)];
  return entry?.url || null;
}

export function setCachedKwUrl(file, url) {
  const map = loadKwUploads();
  map[fileFingerprint(file)] = {
    url,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified || 0,
    savedAt: new Date().toISOString(),
  };
  // Keep at most 50 entries (drop oldest).
  const entries = Object.entries(map).sort((a, b) => (b[1].savedAt || '').localeCompare(a[1].savedAt || ''));
  saveKwUploads(Object.fromEntries(entries.slice(0, 50)));
}

export async function uploadVideoToKeepwork(file, signal) {
  // Reuse a previously uploaded URL for the same file (matched by name + size + lastModified).
  const cachedUrl = getCachedKwUrl(file);
  if (cachedUrl) {
    log(`复用 ${file.name} 的 Keepwork 缓存 URL：${cachedUrl}`, 'ok');
    setProgress(50);
    return cachedUrl;
  }

  const sdk = await ensureKeepworkLogin();
  if (!sdk.userWorks?.uploadAsset) throw new Error('keepwork.userWorks.uploadAsset 不可用。');
  log(`上传 ${humanSize(file.size)} 到 Keepwork CDN…`);
  // The video-work-prod bucket lives in Qiniu's z0 region; the SDK defaults to z2 (used for images).
  const regionUrls = [
    'https://up-z0.qiniup.com/',
    'https://up-z1.qiniup.com/',
    'https://up-z2.qiniup.com/',
    'https://up-na0.qiniup.com/',
    'https://up-as0.qiniup.com/',
  ];
  const doUpload = async (uploadUrl) => {
    const result = await sdk.userWorks.uploadAsset(file, {
      prefix: 'videoParser',
      filename: file.name,
      uploadUrl,
      onProgress: ({ percent }) => {
        setProgress(Math.min(50, percent / 2));
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      },
    });
    if (!result?.url) throw new Error('Keepwork 上传未返回公开 URL。');
    return result.url;
  };
  let lastErr;
  for (const uploadUrl of regionUrls) {
    try {
      const url = await doUpload(uploadUrl);
      log(`通过 ${uploadUrl} 上传。URL：${url}`, 'ok');
      setCachedKwUrl(file, url);
      return url;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const m = msg.match(/use\s+(up-[a-z0-9]+\.qiniup\.com)/i);
      if (m) {
        const correct = `https://${m[1]}/`;
        log(`区域不匹配；使用 ${correct} 重试…`, 'warn');
        try {
          const url = await doUpload(correct);
          log(`通过 ${correct} 上传。URL：${url}`, 'ok');
          setCachedKwUrl(file, url);
          return url;
        } catch (e2) {
          lastErr = e2;
          break;
        }
      }
      if (signal?.aborted) throw e;
      if (!/incorrect region/i.test(msg)) break;
    }
  }
  throw lastErr || new Error('Keepwork upload failed.');
}
