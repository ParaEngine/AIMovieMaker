// ============ Settings persistence + provider/model UI ============
import { LS_KEY, DEFAULT_GOOGLE_MODELS, DEFAULT_OPENROUTER_MODELS } from './constants.js';
import { ui, mountHTML } from './ui.js';
import { log } from './utils.js';

export function mountSettingsUI() {
  if (document.getElementById('settingsDlg')) return;
  mountHTML(`
<dialog id="settingsDlg" style="border:1px solid var(--border); background:var(--panel); color:var(--text); border-radius:10px; padding:0; max-width:520px; width:90%;">
  <form method="dialog" style="padding:20px;">
    <h2 style="margin:0 0 12px; font-size:16px;">设置</h2>

    <label>提供商（使用哪个 API 密钥）</label>
    <select id="providerSel">
      <option value="google">使用 Google API 密钥（Gemini 直连 — 推荐用于视频）</option>
      <option value="openrouter">使用 OpenRouter API 密钥（通过 Keepwork CDN 上传）</option>
    </select>

    <label>Google AI Studio API 密钥</label>
    <div class="password-field">
      <input type="password" id="googleKey" autocomplete="off" />
      <button type="button" class="password-toggle" data-target="googleKey" aria-label="显示 Google API 密钥" title="显示密钥">
        <svg class="icon-eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7C3.7 7.61 7.58 5 12 5s8.3 2.61 9.94 6.65a1 1 0 0 1 0 .7C20.3 16.39 16.42 19 12 19s-8.3-2.61-9.94-6.65Z"/><circle cx="12" cy="12" r="3"/></svg>
        <svg class="icon-eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"/><path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58"/><path d="M9.88 5.18A9.67 9.67 0 0 1 12 5c4.42 0 8.3 2.61 9.94 6.65a1 1 0 0 1 0 .7 10.78 10.78 0 0 1-2.31 3.43"/><path d="M6.61 6.61a10.87 10.87 0 0 0-4.55 5.04 1 1 0 0 0 0 .7C3.7 16.39 7.58 19 12 19a9.85 9.85 0 0 0 4.31-.98"/></svg>
      </button>
    </div>
    <div class="hint">可在 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--accent);">aistudio.google.com/apikey</a> 获取密钥。</div>

    <label>默认 Google 模型</label>
    <div class="row">
      <select id="googleModelSel" style="flex:2;"></select>
      <input type="text" id="googleModelCustom" placeholder="自定义，如 gemini-2.5-flash" style="flex:3;" />
    </div>
    <div class="hint">从列表中选择，或输入你的 Google 密钥可访问的任何模型 ID。自定义值非空时会覆盖下拉选项。</div>

    <label>OpenRouter API 密钥</label>
    <div class="password-field">
      <input type="password" id="openrouterKey" autocomplete="off" />
      <button type="button" class="password-toggle" data-target="openrouterKey" aria-label="显示 OpenRouter API 密钥" title="显示密钥">
        <svg class="icon-eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7C3.7 7.61 7.58 5 12 5s8.3 2.61 9.94 6.65a1 1 0 0 1 0 .7C20.3 16.39 16.42 19 12 19s-8.3-2.61-9.94-6.65Z"/><circle cx="12" cy="12" r="3"/></svg>
        <svg class="icon-eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"/><path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58"/><path d="M9.88 5.18A9.67 9.67 0 0 1 12 5c4.42 0 8.3 2.61 9.94 6.65a1 1 0 0 1 0 .7 10.78 10.78 0 0 1-2.31 3.43"/><path d="M6.61 6.61a10.87 10.87 0 0 0-4.55 5.04 1 1 0 0 0 0 .7C3.7 16.39 7.58 19 12 19a9.85 9.85 0 0 0 4.31-.98"/></svg>
      </button>
    </div>
    <div class="hint">可在 <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" style="color:var(--accent);">openrouter.ai/keys</a> 获取密钥。设置后，解析器会将视频上传到 Keepwork CDN 文件夹并将公开 URL 发送给 OpenRouter（需登录 Keepwork）。</div>

    <label>默认 OpenRouter 模型</label>
    <div class="row">
      <select id="openrouterModelSel" style="flex:2;"></select>
      <input type="text" id="openrouterModelCustom" placeholder="自定义，如 anthropic/claude-3.5-sonnet" style="flex:3;" />
    </div>
    <div class="hint">OpenRouter 需要供应商前缀（如 <code>google/gemini-2.5-pro</code>）。参见 <a href="https://openrouter.ai/models" target="_blank" rel="noopener" style="color:var(--accent);">openrouter.ai/models</a>。</div>

    <div class="hint" style="margin-top:12px;">密钥仅保存在浏览器的 <code>localStorage</code> 中。</div>

    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
      <button type="button" id="btnSettingsClose" class="secondary">关闭</button>
      <button type="button" id="btnSettingsClear" class="secondary">清除密钥</button>
      <button type="submit" id="btnSettingsSave">保存</button>
    </div>
  </form>
</dialog>`);
}

function trimApiKeyFields(settings) {
  return {
    ...settings,
    googleKey: String(settings?.googleKey || '').trim(),
    openrouterKey: String(settings?.openrouterKey || '').trim(),
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return trimApiKeyFields(JSON.parse(raw) || {});
  } catch { return {}; }
}

export function saveSettings(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(trimApiKeyFields(s || {})));
}

export function clampFps(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 2;
  return Math.max(1, Math.min(24, Math.round(n)));
}

export function looksLikeOpenRouterApiKey(key) {
  return /^sk-or-[A-Za-z0-9_-]{20,}$/.test(String(key || '').trim());
}

export function getSettings() {
  const s = loadSettings();
  return {
    provider: s.provider || 'google',
    googleKey: s.googleKey || '',
    openrouterKey: s.openrouterKey || '',
    googleModel: s.googleModel || s.model || DEFAULT_GOOGLE_MODELS[0],
    openrouterModel: s.openrouterModel || DEFAULT_OPENROUTER_MODELS[0],
    fps: clampFps(s.fps),
  };
}

export function fillModelSelect(selEl, list, current) {
  if (!selEl) return;
  selEl.innerHTML = '';
  const seen = new Set();
  const add = (v) => {
    if (!v || seen.has(v)) return;
    seen.add(v);
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    selEl.appendChild(o);
  };
  for (const m of list) add(m);
  if (current && !seen.has(current)) add(current);
  selEl.value = current || list[0];
}

export function activeModel(settings) {
  return settings.provider === 'openrouter' ? settings.openrouterModel : settings.googleModel;
}

export function currentProvider() {
  const main = ui.providerMain?.value;
  if (main === 'google' || main === 'openrouter') return main;
  const dlg = ui.provider?.value;
  if (dlg === 'google' || dlg === 'openrouter') return dlg;
  const s = getSettings();
  return s.provider === 'openrouter' ? 'openrouter' : 'google';
}

export function refreshMainModelSelect(providerOverride) {
  const s = getSettings();
  const provider = providerOverride || currentProvider();
  const list = provider === 'openrouter' ? DEFAULT_OPENROUTER_MODELS : DEFAULT_GOOGLE_MODELS;
  const current = provider === 'openrouter' ? s.openrouterModel : s.googleModel;
  fillModelSelect(ui.model, list, current);
  if (ui.modelProviderTag) ui.modelProviderTag.textContent = provider === 'openrouter' ? 'OpenRouter' : 'Google';
}

export function initSettings() {
  const s = getSettings();
  ui.provider.value = s.provider;
  if (ui.providerMain) ui.providerMain.value = s.provider;
  ui.googleKey.value = s.googleKey;
  ui.openrouterKey.value = s.openrouterKey;
  fillModelSelect(ui.googleModelSel, DEFAULT_GOOGLE_MODELS, s.googleModel);
  fillModelSelect(ui.openrouterModelSel, DEFAULT_OPENROUTER_MODELS, s.openrouterModel);
  if (s.googleModel && !DEFAULT_GOOGLE_MODELS.includes(s.googleModel)) {
    ui.googleModelCustom.value = s.googleModel;
  }
  if (s.openrouterModel && !DEFAULT_OPENROUTER_MODELS.includes(s.openrouterModel)) {
    ui.openrouterModelCustom.value = s.openrouterModel;
  }
  ui.fps.value = s.fps;
  refreshMainModelSelect(s.provider);

  document.querySelectorAll('.password-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.classList.toggle('is-visible', show);
      button.setAttribute('aria-label', `${show ? '隐藏' : '显示'} ${input.id === 'googleKey' ? 'Google' : 'OpenRouter'} API 密钥`);
      button.title = show ? '隐藏密钥' : '显示密钥';
    });
  });

  [ui.googleKey, ui.openrouterKey].forEach(input => {
    input?.addEventListener('blur', () => { input.value = input.value.trim(); });
  });

  ui.settingsBtn.addEventListener('click', () => {
    if (typeof ui.settingsDlg.showModal === 'function') ui.settingsDlg.showModal();
    else ui.settingsDlg.setAttribute('open', '');
  });

  document.getElementById('btnSettingsSave').addEventListener('click', () => {
    const googleModel = (ui.googleModelCustom.value.trim()) || ui.googleModelSel.value;
    const openrouterModel = (ui.openrouterModelCustom.value.trim()) || ui.openrouterModelSel.value;
    const provider = ui.providerMain?.value || ui.provider.value;
    const openrouterKey = ui.openrouterKey.value.trim();
    if (openrouterKey && !looksLikeOpenRouterApiKey(openrouterKey)) {
      log('OpenRouter API Key 格式不正确，应类似 sk-or-...；已保留输入但不会用于请求。', 'warn');
    }
    const next = {
      ...loadSettings(),
      provider,
      googleKey: ui.googleKey.value.trim(),
      openrouterKey,
      googleModel,
      openrouterModel,
    };
    saveSettings(next);
    if (ui.providerMain) ui.providerMain.value = provider;
    ui.provider.value = provider;
    refreshMainModelSelect(provider);
    log('设置已保存。', 'ok');
  });

  document.getElementById('btnSettingsClose').addEventListener('click', () => {
    if (typeof ui.settingsDlg.close === 'function') ui.settingsDlg.close();
    else ui.settingsDlg.removeAttribute('open');
  });

  ui.settingsClear.addEventListener('click', () => {
    ui.googleKey.value = '';
    ui.openrouterKey.value = '';
    const next = { ...loadSettings(), googleKey: '', openrouterKey: '' };
    saveSettings(next);
    log('API 密钥已清除。', 'warn');
  });

  ui.provider.addEventListener('change', () => {
    const provider = ui.provider.value;
    if (ui.providerMain) ui.providerMain.value = provider;
    const ss = loadSettings();
    ss.provider = provider;
    saveSettings(ss);
    refreshMainModelSelect(provider);
  });

  if (ui.providerMain) {
    ui.providerMain.addEventListener('change', () => {
      const provider = ui.providerMain.value;
      ui.provider.value = provider;
      const ss = loadSettings();
      ss.provider = provider;
      saveSettings(ss);
      refreshMainModelSelect(provider);
    });
  }

  ui.model.addEventListener('change', () => {
    const ss = loadSettings();
    if (currentProvider() === 'openrouter') ss.openrouterModel = ui.model.value;
    else ss.googleModel = ui.model.value;
    saveSettings(ss);
  });

  ui.fps.addEventListener('change', () => {
    const ss = loadSettings();
    ss.fps = clampFps(ui.fps.value);
    ui.fps.value = ss.fps;
    saveSettings(ss);
  });
}
