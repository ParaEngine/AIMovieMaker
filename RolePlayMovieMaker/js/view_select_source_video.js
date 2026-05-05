// ============ View: Stage 1 — Select Source Video ============
// Pick one source: a video URL, an MP4 upload, or a cached Gemini file.
// Owns the DOM IDs used by uploads.js / media.js / parse.js for the source.

import { registerView, gotoNextStage } from './views.js';
import { setTimelineMediaSrc, parseYouTubeId } from './media.js';
import { ui } from './ui.js';
import { projectState } from './state.js';
import { humanSize } from './utils.js';
import { loadSettings, saveSettings } from './settings.js';
import { saveProject } from './project.js';

let urlProjectSaveTimer = null;
let lastSavedProjectUrlKey = '';

export function registerSelectSourceVideoView() {
  registerView({
    id: 'stage1',
    label: '源视频',
    stage: 1,
    mount: mountStage1,
    onShow: syncFromUrlInput,
  });
}

function mountStage1(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1>① 选择源视频</h1>
        <div class="vh-sub">粘贴一个视频链接，或选择一个 MP4 文件 / 缓存文件。只需要提供一种来源。</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" id="btnStage1Next">下一步：解析视频 →</button>
      </div>
    </div>

    <div class="view-grid-2">
      <section class="panel">
        <h2>视频链接</h2>
        <label for="urlInput">YouTube 或 MP4 URL</label>
        <input type="text" id="urlInput" placeholder="https://youtu.be/... 或 https://example.com/video.mp4" autocomplete="off" />
        <div class="hint">输入后会自动识别 YouTube 或普通视频 URL，并优先使用该链接解析。</div>

        <div class="status" id="stage1Status" style="margin-top:14px;">请粘贴视频链接，或在右侧选择 MP4 文件 / 缓存文件。</div>
      </section>

      <section class="panel">
        <h2>本地 MP4 / 缓存</h2>
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
        <div class="hint">通过 Gemini Files API 支持最大约 2GB 的文件。</div>

        <video id="preview" controls style="margin-top:12px; display:none;"></video>
      </section>
    </div>
  `;

  const fileInput = container.querySelector('#fileInput');
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) {
      clearUrlSource();
      setStatus(`已选择本地 MP4：${f.name} (${humanSize(f.size)})`, 'ok');
    }
  });

  const sourceSel = container.querySelector('#sourceSel');
  sourceSel.addEventListener('change', () => {
    if (sourceSel.value && sourceSel.value !== 'new') clearUrlSource();
  });

  const urlInput = container.querySelector('#urlInput');
  urlInput.addEventListener('input', syncFromUrlInput);
  urlInput.addEventListener('change', syncFromUrlInput);

  container.querySelector('#btnStage1Next').addEventListener('click', gotoNextStage);
}

function syncFromUrlInput(event) {
  let url = (ui.urlInput?.value || '').trim();
  if (!url) {
    persistUrl();
    setStatus('请粘贴视频链接，或选择 MP4 文件 / 缓存文件。');
    return;
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) {
    url = 'https://youtu.be/' + url;
    ui.urlInput.value = url;
  }
  if (!/^https?:\/\//i.test(url)) {
    setStatus('视频链接必须以 http:// 或 https:// 开头。', 'warn');
    return;
  }
  const sourceKind = classifyVideoUrl(url);
  if (!sourceKind) {
    persistUrl();
    setStatus('继续输入视频链接，系统会自动识别 YouTube 或 MP4 URL。', 'warn');
    return;
  }
  if (ui.urlMime) ui.urlMime.value = 'video/mp4';
  persistUrl();
  if (ui.file) ui.file.value = '';
  if (ui.source && ui.source.value !== 'new') {
    ui.source.value = 'new';
    ui.source.dispatchEvent(new Event('change', { bubbles: true }));
  }
  setTimelineMediaSrc(url, { kind: sourceKind, label: url });
  setStatus(`已自动使用${sourceKind === 'youtube' ? ' YouTube 链接' : '视频 URL'}：${url}`, 'ok');
  if (event?.type === 'input' || event?.type === 'change') scheduleUrlProjectSave(url);
}

function classifyVideoUrl(url) {
  if (parseYouTubeId(url)) return 'youtube';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(host) || host === 'youtu.be') return '';
    if (!parsed.hostname || parsed.pathname === '/') return '';
    return 'url';
  } catch {
    return '';
  }
}

function clearUrlSource() {
  if (ui.urlInput) ui.urlInput.value = '';
  persistUrl();
}

function persistUrl() {
  const ss = loadSettings();
  ss.lastUrl = ui.urlInput.value.trim();
  ss.lastUrlMime = (ui.urlMime?.value || '').trim();
  saveSettings(ss);
}

function scheduleUrlProjectSave(url) {
  const saveKey = `${projectState.name || ''}\n${url}`;
  if (!url || saveKey === lastSavedProjectUrlKey) return;
  if (urlProjectSaveTimer) clearTimeout(urlProjectSaveTimer);
  urlProjectSaveTimer = setTimeout(async () => {
    urlProjectSaveTimer = null;
    const currentUrl = (ui.urlInput?.value || '').trim();
    if (!currentUrl || currentUrl !== url) return;
    const saved = await saveProject();
    if (saved) lastSavedProjectUrlKey = `${projectState.name || ''}\n${currentUrl}`;
  }, 700);
}

function setStatus(text, level = '') {
  const el = document.getElementById('stage1Status');
  if (!el) return;
  el.innerHTML = '';
  const div = document.createElement('div');
  if (level) div.className = level;
  div.textContent = text;
  el.appendChild(div);
}
