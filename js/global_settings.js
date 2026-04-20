// ============ Global Settings ============

import { $ } from './utils.js';
import { getPromptPresetOptions } from './prompts.js';

const SETTINGS_KEY = 'aimm_global_settings';

export const LLM_OPTIONS = [
    { value: 'keepwork-flash', label: 'Keepwork Flash (快速)' },
    { value: 'keepwork-pro', label: 'Keepwork Pro (强力)' },
    { value: 'keepwork-r1', label: 'Keepwork R1 (推理)' },
    { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
];

const DEFAULTS = {
    llmModel: 'keepwork-flash',
    llmApiKey: '',
    imageApiKey: '',
    videoApiKey: '',
    promptPreset: 'zh',
};

let _settings = null;

export function loadGlobalSettings() {
    if (_settings) return _settings;
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) { _settings = { ...DEFAULTS, ...JSON.parse(saved) }; return _settings; }
    } catch (_) {}
    _settings = { ...DEFAULTS };
    return _settings;
}

export function saveGlobalSettings(settings) {
    _settings = { ...settings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(_settings));
}

export function getGlobalLLM() {
    return loadGlobalSettings().llmModel;
}

export function getGlobalLLMApiKey() {
    return loadGlobalSettings().llmApiKey || '';
}

export function getGlobalImageApiKey() {
    return loadGlobalSettings().imageApiKey || '';
}

export function getGlobalVideoApiKey() {
    return loadGlobalSettings().videoApiKey || '';
}

export function getGlobalPromptPreset() {
    return loadGlobalSettings().promptPreset || 'zh';
}

// ============ Settings Modal ============

let modalEl = null;

function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'globalSettingsModal';
    modalEl.className = 'hidden';
    modalEl.style.cssText = 'position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);';
    modalEl.innerHTML = `
        <div style="background:var(--bg-card);border:1px solid var(--border-card);border-radius:14px;padding:24px;width:340px;max-width:90vw" onclick="event.stopPropagation()">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 style="font-size:15px;font-weight:600;color:var(--text-primary)">全局设置</h3>
                <button id="globalSettingsClose" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1">&times;</button>
            </div>
            <div style="margin-bottom:16px">
                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">LLM 模型</label>
                <select id="globalLLMSelect" class="modal-input" style="cursor:pointer">
                    ${LLM_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
                </select>
            </div>
            <div style="margin-bottom:16px">
                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">提示词版本 <span style="color:var(--text-muted);font-size:11px">(Prompt Preset)</span></label>
                <select id="globalPromptPresetSelect" class="modal-input" style="cursor:pointer">
                    ${getPromptPresetOptions().map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
                </select>
            </div>
            <div style="margin-bottom:16px">
                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">LLM API Key <span style="color:var(--text-muted);font-size:11px">(可选，文本模型)</span></label>
                <input id="globalLLMApiKeyInput" type="password" class="modal-input" placeholder="留空则使用默认" style="width:100%;box-sizing:border-box" />
            </div>
            <div style="margin-bottom:16px">
                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">Image API Key <span style="color:var(--text-muted);font-size:11px">(可选，图片生成)</span></label>
                <input id="globalImageApiKeyInput" type="password" class="modal-input" placeholder="留空则使用默认" style="width:100%;box-sizing:border-box" />
            </div>
            <div style="margin-bottom:16px">
                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">Video API Key <span style="color:var(--text-muted);font-size:11px">(可选，视频生成)</span></label>
                <input id="globalVideoApiKeyInput" type="password" class="modal-input" placeholder="留空则使用默认" style="width:100%;box-sizing:border-box" />
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px">
                <button id="globalSettingsSave" class="btn-primary" style="padding:6px 16px;font-size:13px">保存</button>
            </div>
        </div>
    `;
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) hideSettingsModal(); });
    document.body.appendChild(modalEl);

    modalEl.querySelector('#globalSettingsClose').onclick = hideSettingsModal;
    modalEl.querySelector('#globalSettingsSave').onclick = () => {
        const newModel = modalEl.querySelector('#globalLLMSelect').value;
        const newLLMApiKey = modalEl.querySelector('#globalLLMApiKeyInput').value.trim();
        const newImageApiKey = modalEl.querySelector('#globalImageApiKeyInput').value.trim();
        const newVideoApiKey = modalEl.querySelector('#globalVideoApiKeyInput').value.trim();
        const newPromptPreset = modalEl.querySelector('#globalPromptPresetSelect').value;
        saveGlobalSettings({ ...loadGlobalSettings(), llmModel: newModel, llmApiKey: newLLMApiKey, imageApiKey: newImageApiKey, videoApiKey: newVideoApiKey, promptPreset: newPromptPreset });
        hideSettingsModal();
    };

    return modalEl;
}

export function showSettingsModal() {
    const modal = ensureModal();
    const settings = loadGlobalSettings();
    modal.querySelector('#globalLLMSelect').value = settings.llmModel;
    modal.querySelector('#globalPromptPresetSelect').value = settings.promptPreset || 'zh';
    modal.querySelector('#globalLLMApiKeyInput').value = settings.llmApiKey || '';
    modal.querySelector('#globalImageApiKeyInput').value = settings.imageApiKey || '';
    modal.querySelector('#globalVideoApiKeyInput').value = settings.videoApiKey || '';
    modal.style.display = 'flex';
}

export function hideSettingsModal() {
    if (modalEl) modalEl.style.display = 'none';
}
