// ============ New Project Dialog ============

import { state, createProject, resetTreeExpanded } from './state.js';
import { saveProject, clearUndoRedo } from './storage.js';
import { navigateTo } from './views.js';
import { showToast, $ } from './utils.js';
import { CONFIG } from './config.js';
import { getPromptPresetOptions } from './prompts.js';
import { getGlobalPromptPreset } from './global_settings.js';



let modalEl = null;

function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'newProjectModal';
    modalEl.className = 'hidden';
    modalEl.style.cssText = 'position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);';
    modalEl.innerHTML = `
        <div class="card-flat fade-in" style="width:480px;max-width:90vw;max-height:85vh;overflow-y:auto;padding:24px" onclick="event.stopPropagation()">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <h3 style="font-size:16px;font-weight:700;color:var(--text-primary)">新建项目</h3>
                <button id="newProjClose" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:20px;line-height:1">&times;</button>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px">
                <!-- Title -->
                <div>
                    <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">项目名称</label>
                    <input id="newProjTitle" class="modal-input" placeholder="未命名项目" autocomplete="off">
                </div>

                <!-- Plot / Script -->
                <div>
                    <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">剧情简介 / 初始剧本 <span style="color:var(--text-faint)">(可选)</span></label>
                    <textarea id="newProjScript" class="modal-input" rows="4" placeholder="输入故事梗概或完整剧本，AI 将据此拆分分镜…"></textarea>
                </div>

                <!-- Two-column row -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <!-- Style Preset -->
                    <div>
                        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">美术风格</label>
                        <select id="newProjStylePreset" class="modal-input" style="cursor:pointer">
                            ${CONFIG.STYLE_PRESETS.map(p => `<option value="${p.value}" ${p.value === '3d-semirealistic' ? 'selected' : ''}>${p.label}</option>`).join('')}
                        </select>
                        <input id="newProjCustomStyle" class="modal-input hidden" style="margin-top:6px;font-size:12px" placeholder="输入自定义风格关键词，如: watercolor, soft pastel tones">
                    </div>
                    <!-- Ratio -->
                    <div>
                        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">画面比例</label>
                        <select id="newProjRatio" class="modal-input" style="cursor:pointer">
                            ${CONFIG.RATIOS.map(r => `<option value="${r}" ${r === '16:9' ? 'selected' : ''}>${r}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- Resolution row -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div>
                        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">分辨率</label>
                        <select id="newProjResolution" class="modal-input" style="cursor:pointer">
                            ${CONFIG.RESOLUTIONS.map(r => `<option value="${r}" ${r === '720p' ? 'selected' : ''}>${r}</option>`).join('')}
                        </select>
                    </div>
                    <div></div>
                </div>

                <!-- Env & Race row -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div>
                        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">时代环境</label>
                        <select id="newProjEnvPreset" class="modal-input" style="cursor:pointer">
                            ${CONFIG.ENV_PRESETS.map(p => `<option value="${p.value}">${p.label}</option>`).join('')}
                        </select>
                        <input id="newProjCustomEnv" class="modal-input hidden" style="margin-top:6px;font-size:12px" placeholder="输入自定义时代环境，如: 唐朝盛世、赛博朋克2077">
                    </div>
                    <div>
                        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">人物族裔</label>
                        <select id="newProjRacePreset" class="modal-input" style="cursor:pointer">
                            ${CONFIG.RACE_PRESETS.map(p => `<option value="${p.value}">${p.label}</option>`).join('')}
                        </select>
                        <input id="newProjCustomRace" class="modal-input hidden" style="margin-top:6px;font-size:12px" placeholder="输入自定义族裔描述">
                    </div>
                </div>

                <!-- Two-column row -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <!-- Episodes -->
                    <div>
                        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">总集数</label>
                        <input id="newProjEpisodes" class="modal-input" type="number" min="1" max="100" value="1">
                    </div>
                    <!-- Duration -->
                    <div>
                        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">目标时长 (分钟)</label>
                        <input id="newProjDuration" class="modal-input" type="number" min="1" max="60" value="3">
                    </div>
                </div>

                <!-- Language -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div>
                        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">语言</label>
                        <select id="newProjLang" class="modal-input" style="cursor:pointer">
                            ${CONFIG.LANGUAGES.map(l => `<option value="${l.value}" ${l.value === 'zh' ? 'selected' : ''}>${l.label}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px">提示词预设</label>
                        <select id="newProjPromptPreset" class="modal-input" style="cursor:pointer">
                            ${getPromptPresetOptions().map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:24px">
                <button id="newProjCancel" class="btn-secondary" style="padding:8px 18px;font-size:13px">取消</button>
                <button id="newProjCreate" class="btn-primary" style="padding:8px 22px;font-size:13px">创建项目</button>
            </div>
        </div>
    `;
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) hideNewProjectModal(); });
    document.body.appendChild(modalEl);

    modalEl.querySelector('#newProjClose').onclick = hideNewProjectModal;
    modalEl.querySelector('#newProjCancel').onclick = hideNewProjectModal;
    modalEl.querySelector('#newProjCreate').onclick = handleCreate;
    modalEl.querySelector('#newProjStylePreset').onchange = () => {
        const custom = modalEl.querySelector('#newProjCustomStyle');
        custom.classList.toggle('hidden', modalEl.querySelector('#newProjStylePreset').value !== 'custom');
    };
    modalEl.querySelector('#newProjEnvPreset').onchange = () => {
        const custom = modalEl.querySelector('#newProjCustomEnv');
        custom.classList.toggle('hidden', modalEl.querySelector('#newProjEnvPreset').value !== 'custom');
    };
    modalEl.querySelector('#newProjRacePreset').onchange = () => {
        const custom = modalEl.querySelector('#newProjCustomRace');
        custom.classList.toggle('hidden', modalEl.querySelector('#newProjRacePreset').value !== 'custom');
    };

    return modalEl;
}

async function handleCreate() {
    if (!state.token) { showToast('请先登录', 'error'); return; }

    const title = modalEl.querySelector('#newProjTitle').value.trim() || undefined;
    const script = modalEl.querySelector('#newProjScript').value.trim();
    const stylePreset = modalEl.querySelector('#newProjStylePreset').value;
    const customStyle = modalEl.querySelector('#newProjCustomStyle').value.trim();
    const envPreset = modalEl.querySelector('#newProjEnvPreset').value;
    const customEnv = modalEl.querySelector('#newProjCustomEnv').value.trim();
    const racePreset = modalEl.querySelector('#newProjRacePreset').value;
    const customRace = modalEl.querySelector('#newProjCustomRace').value.trim();
    const ratio = modalEl.querySelector('#newProjRatio').value;
    const resolution = modalEl.querySelector('#newProjResolution').value;
    const episodes = Math.max(1, parseInt(modalEl.querySelector('#newProjEpisodes').value) || 1);
    const duration = Math.max(1, parseInt(modalEl.querySelector('#newProjDuration').value) || 3);
    const language = modalEl.querySelector('#newProjLang').value;
    const promptPreset = modalEl.querySelector('#newProjPromptPreset').value;

    const proj = createProject(title, episodes);
    proj.script = script;
    proj.totalDuration = duration;
    proj.settings.ratio = ratio;
    proj.settings.resolution = resolution;
    proj.settings.narrationLanguage = language;
    proj.settings.promptPreset = promptPreset;
    proj.settings.stylePreset = stylePreset;
    if (stylePreset === 'custom') {
        proj.settings.customStyleSuffix = customStyle;
    }
    proj.settings.envPreset = envPreset;
    if (envPreset === 'custom') {
        proj.settings.customEnvSuffix = customEnv;
    }
    proj.settings.racePreset = racePreset;
    if (racePreset === 'custom') {
        proj.settings.customRaceSuffix = customRace;
    }

    state.currentProject = proj;
    clearUndoRedo();
    resetTreeExpanded();
    await saveProject(proj);
    hideNewProjectModal();
    navigateTo('breakdown');
}

export function showNewProjectModal() {
    const modal = ensureModal();
    // Reset fields
    modal.querySelector('#newProjTitle').value = '';
    modal.querySelector('#newProjScript').value = '';
    modal.querySelector('#newProjStylePreset').value = '3d-semirealistic';
    modal.querySelector('#newProjCustomStyle').value = '';
    modal.querySelector('#newProjCustomStyle').classList.add('hidden');
    modal.querySelector('#newProjEnvPreset').value = '';
    modal.querySelector('#newProjCustomEnv').value = '';
    modal.querySelector('#newProjCustomEnv').classList.add('hidden');
    modal.querySelector('#newProjRacePreset').value = '';
    modal.querySelector('#newProjCustomRace').value = '';
    modal.querySelector('#newProjCustomRace').classList.add('hidden');
    modal.querySelector('#newProjRatio').value = '16:9';
    modal.querySelector('#newProjEpisodes').value = '1';
    modal.querySelector('#newProjDuration').value = '3';
    modal.querySelector('#newProjLang').value = 'zh';
    modal.querySelector('#newProjPromptPreset').value = getGlobalPromptPreset();
    modal.style.display = 'flex';
    // Auto-focus title
    setTimeout(() => modal.querySelector('#newProjTitle').focus(), 100);
}

export function hideNewProjectModal() {
    if (modalEl) modalEl.style.display = 'none';
}
