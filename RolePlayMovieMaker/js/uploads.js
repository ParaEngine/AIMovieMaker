// ============ Gemini Files API upload cache (account-bound) ============
import { LS_UPLOADS } from './constants.js';
import { ui, mountHTML } from './ui.js';
import { log, humanSize } from './utils.js';
import { getSettings } from './settings.js';

/* ---------------- HTML markup owned by this module ---------------- */
/* The Input panel is a single cohesive section — even though prompt.js,
 * settings.js, parse.js, and output.js wire some of its inner controls,
 * this module owns the panel skeleton (uploads.js is the dominant feature).
 */
export function mountInputPanelUI(parent) {
  if (document.getElementById('sourceSel')) return;
  const main = parent || document.getElementById('appMain') || document.body;
  mountHTML(`
<section class="panel">
  <h2>输入</h2>

  <label>来源</label>
  <div class="row" style="align-items:center;">
    <select id="sourceSel" style="flex:2;">
      <option value="new">— 上传新的 MP4 —</option>
    </select>
    <button type="button" id="btnRefreshFiles" class="secondary" style="flex:0 0 auto;" title="验证缓存文件是否仍存在于 Gemini">刷新</button>
    <button type="button" id="btnDeleteFile" class="secondary" style="flex:0 0 auto;" title="删除选中的缓存文件" disabled>删除</button>
  </div>
  <div class="hint" id="fileMetaHint">之前上传的文件会保存在本地。Gemini 会在约 48 小时后自动过期。</div>

  <label for="fileInput">MP4 视频文件</label>
  <input type="file" id="fileInput" accept="video/mp4,video/*" />
  <div class="hint">通过 Gemini Files API 支持最大约 2GB 的文件。较长视频会以 1 FPS 处理。</div>

  <label for="urlInput">…或者视频 URL（直接发送给模型）</label>
  <div class="row">
    <input type="text" id="urlInput" placeholder="https://example.com/video.mp4" style="flex:3;" />
    <input type="text" id="urlMime" placeholder="video/mp4" title="MIME 类型" style="flex:0 0 110px;" />
  </div>
  <div class="hint">粘贴 https:// 的 MP4 URL（例如 Keepwork CDN URL 或 Gemini 可访问的 YouTube 链接）。填入后会代替文件 / 缓存上传。</div>

  <video id="preview" controls style="margin-top:12px; display:none;"></video>

  <label for="modelSelect">模型</label>
  <select id="modelSelect"></select>
  <div class="hint">当前提供商：<span id="modelProviderTag">—</span>。在<strong>设置 ⚙</strong>中管理模型列表。</div>

  <label for="fpsInput">视频采样 FPS</label>
  <input type="number" id="fpsInput" min="1" max="24" step="1" value="2" />
  <div class="hint">Gemini 从视频中解码的每秒帧数。默认 2，越高时间戳越精准但成本也按比例增加。范围 1–24。</div>

  <label for="promptText">
    提示词（发送给模型）
    <button type="button" id="btnResetPrompt" class="secondary" style="float:right; padding:2px 8px; font-size:11px;">恢复默认</button>
  </label>
  <textarea id="promptText" style="min-height:220px;"></textarea>
  <div class="hint">该文本会原样发送，可随意编辑。模型同时被要求返回符合内置响应 schema 的 JSON。</div>

  <div class="actions">
    <button id="btnParse">解析视频</button>
    <button id="btnCancel" class="secondary" disabled>取消</button>
  </div>

  <div class="progress"><div id="progressBar"></div></div>
  <div class="status" id="status">就绪。</div>
</section>`, main);
}

export function loadUploads() {
  try { return JSON.parse(localStorage.getItem(LS_UPLOADS) || '[]') || []; }
  catch { return []; }
}
export function saveUploads(list) { localStorage.setItem(LS_UPLOADS, JSON.stringify(list)); }

export function addUpload(meta) {
  const list = loadUploads().filter(x => x.name !== meta.name);
  list.unshift(meta);
  saveUploads(list.slice(0, 50));
  renderUploads();
}

export function removeUpload(name) {
  saveUploads(loadUploads().filter(x => x.name !== name));
  renderUploads();
}

export function renderUploads() {
  const prev = ui.source.value;
  const list = loadUploads();
  ui.source.innerHTML = '<option value="new">— 上传新的 MP4 —</option>';
  for (const f of list) {
    const opt = document.createElement('option');
    opt.value = f.name;
    const expires = f.expiresAt ? ` · 过期于 ${new Date(f.expiresAt).toLocaleString()}` : '';
    const size = f.sizeBytes ? ` · ${humanSize(f.sizeBytes)}` : '';
    opt.textContent = `${f.displayName || f.name}${size}${expires}`;
    ui.source.appendChild(opt);
  }
  if ([...ui.source.options].some(o => o.value === prev)) ui.source.value = prev;
  onSourceChange();
}

export function selectedUpload() {
  const v = ui.source.value;
  if (!v || v === 'new') return null;
  return loadUploads().find(x => x.name === v) || null;
}

export function onSourceChange() {
  const cached = selectedUpload();
  ui.deleteFile.disabled = !cached;
  if (cached) {
    ui.file.disabled = true;
    ui.preview.style.display = 'none';
    ui.fileMetaHint.textContent = `已选择缓存：${cached.uri}`;
  } else {
    ui.file.disabled = false;
    ui.fileMetaHint.textContent = '之前上传的文件会保存在本地。Gemini 会在约 48 小时后自动过期。';
  }
}

export function initUploads() {
  ui.source.addEventListener('change', onSourceChange);

  ui.deleteFile.addEventListener('click', async () => {
    const cached = selectedUpload();
    if (!cached) return;
    const key = getSettings().googleKey;
    if (key) {
      try {
        await fetch(`https://generativelanguage.googleapis.com/v1beta/${cached.name}?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
        log(`已在 Gemini 上删除 ${cached.name}。`, 'ok');
      } catch {
        log('远程删除失败；仍从本地缓存中移除。', 'warn');
      }
    }
    removeUpload(cached.name);
  });

  ui.refreshFiles.addEventListener('click', async () => {
    const key = getSettings().googleKey;
    if (!key) { log('请先在设置中添加 Google API 密钥。', 'err'); return; }
    const list = loadUploads();
    if (!list.length) { log('没有可刷新的缓存上传。'); return; }
    log(`正在验证 ${list.length} 个缓存文件…`);
    const surviving = [];
    for (const f of list) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${f.name}?key=${encodeURIComponent(key)}`);
        if (r.ok) {
          const meta = await r.json();
          surviving.push({
            ...f,
            uri: meta.uri || f.uri,
            mimeType: meta.mimeType || meta.mime_type || f.mimeType,
            state: meta.state,
            expiresAt: meta.expirationTime || f.expiresAt,
          });
        } else {
          log(`  ${f.displayName || f.name}：未找到（${r.status}），已移除。`, 'warn');
        }
      } catch {
        log(`  ${f.displayName || f.name}：错误，保留。`, 'warn');
        surviving.push(f);
      }
    }
    saveUploads(surviving);
    renderUploads();
    log(`刷新完成。有效文件 ${surviving.length} 个。`, 'ok');
  });

  renderUploads();
}
