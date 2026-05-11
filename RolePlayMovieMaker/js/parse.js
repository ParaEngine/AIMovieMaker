// ============ Main parse flow (button handler) ============
import { ui } from './ui.js';
import { state } from './state.js';
import { log, setProgress } from './utils.js';
import { getSettings, clampFps, refreshMainModelSelect, activeModel, currentProvider } from './settings.js';
import { selectedUpload } from './uploads.js';
import { runGoogle, runGoogleWithFileUri } from './gemini.js';
import { runOpenRouter, runOpenRouterWithUrl } from './openrouter.js';
import { saveProject } from './project.js';
import { updateParseVideoResultSummary } from './view_parse_video.js';

function openSettingsForApiKey(provider) {
  if (!ui.settingsDlg) return;
  if (typeof ui.settingsDlg.showModal === 'function') ui.settingsDlg.showModal();
  else ui.settingsDlg.setAttribute('open', '');
  const target = provider === 'openrouter' ? ui.openrouterKey : ui.googleKey;
  target?.focus();
  target?.select?.();
}

export function initParse() {
  ui.parse.addEventListener('click', async () => {
    const cached = selectedUpload();
    const file = ui.file.files?.[0];
    const directUrl = (ui.urlInput?.value || '').trim();
    const directMime = (ui.urlMime?.value || '').trim() || 'video/mp4';
    if (!cached && !file && !directUrl) { log('请选择 MP4 文件、粘贴视频 URL 或选择一个缓存上传。', 'err'); return; }
    if (directUrl && !/^https?:\/\//i.test(directUrl)) {
      log('视频 URL 必须以 http:// 或 https:// 开头', 'err');
      return;
    }
    const settings = getSettings();
    settings.prompt = ui.promptText.value;
    settings.fps = clampFps(ui.fps.value);
    settings.provider = currentProvider();

    // Cached Gemini Files API uploads are account-bound and must use Google.
    if (cached && settings.provider !== 'google') {
      log('已选择 Gemini 缓存上传 — 强制使用 Google 提供商。', 'ok');
      settings.provider = 'google';
      if (ui.providerMain) ui.providerMain.value = 'google';
      if (ui.provider) ui.provider.value = 'google';
    }
    if (ui.provider && ui.provider.value !== settings.provider) {
      ui.provider.value = settings.provider;
    }
    if (ui.providerMain && ui.providerMain.value !== settings.provider) {
      ui.providerMain.value = settings.provider;
    }
    refreshMainModelSelect(settings.provider);
    settings.model = (ui.model.value || activeModel(settings) || '').trim();

    if (settings.provider === 'google' && !settings.googleKey) {
      log('缺少 Google API 密钥。请先填写 API Key。', 'err');
      openSettingsForApiKey('google');
      return;
    }
    if (settings.provider === 'openrouter' && !settings.openrouterKey) {
      log('缺少 OpenRouter API 密钥。请先填写 API Key。', 'err');
      openSettingsForApiKey('openrouter');
      return;
    }
    if (settings.provider === 'openrouter' && !file && !directUrl) {
      log('OpenRouter 需要本地 MP4 文件或视频 URL（缓存的 Gemini 文件不能在 OpenRouter 上复用）。', 'err');
      return;
    }

    ui.parse.disabled = true;
    ui.cancel.disabled = false;
    ui.output.value = '// 处理中…';
    ui.output.readOnly = true;
    ui.copy.disabled = ui.download.disabled = ui.downloadSrt.disabled = true;
    updateParseVideoResultSummary(null);
    setProgress(0);
    state.abortController = new AbortController();

    try {
      if (directUrl) {
        log(`使用直接视频 URL（${directMime}）：${directUrl}`);
        if (settings.provider === 'google') {
          await runGoogleWithFileUri(directUrl, directMime, settings, state.abortController.signal);
        } else {
          await runOpenRouterWithUrl(directUrl, file?.name || 'video.mp4', directMime, settings, state.abortController.signal);
        }
      } else if (settings.provider === 'google') {
        await runGoogle(file, cached, settings, state.abortController.signal);
      } else {
        await runOpenRouter(file, settings, state.abortController.signal);
      }
      log('阶段 2 已完成，正在自动保存项目…');
      await saveProject();
    } catch (err) {
      if (err.name === 'AbortError') log('已取消。', 'warn');
      else { console.error(err); log('错误：' + (err.message || err), 'err'); }
    } finally {
      ui.parse.disabled = false;
      ui.cancel.disabled = true;
      ui.output.readOnly = false;
      state.abortController = null;
    }
  });

  ui.cancel.addEventListener('click', () => {
    if (state.abortController) state.abortController.abort();
  });
}
