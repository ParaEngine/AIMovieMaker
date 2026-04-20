// ============ Plot & Settings Detail View ============

import { CONFIG, getPromptPresetOptions } from './config.js';
import { state } from './state.js';
import { escapeHtml, $, showToast } from './utils.js';
import { saveProject } from './storage.js';
import VoiceTypeSelector from './VoiceTypeSelector.js';

/**
 * Render the plot (script) and settings panel into the detail panel.
 * @param {HTMLElement} panel - the #detailPanel element
 * @param {Object} proj - current project
 * @param {Object} callbacks - { onAnalyze, onSave }
 */
export function renderPlotSettings(panel, proj, { onAnalyze, onSave }) {
    const promptPresetOptions = getPromptPresetOptions();
    const currentPromptPreset = proj.settings.promptPreset || '';

    panel.innerHTML = `
        <div class="card-flat p-4 fade-in">
            <h3 class="text-base font-semibold mb-3">📄 剧本 & 设置</h3>
            <div class="space-y-3">
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">剧本 / 故事大纲</label>
                    <textarea id="scriptInputInline" class="modal-input mt-1" style="min-height:160px;font-size:12px;line-height:1.5;resize:vertical" placeholder="在这里输入或粘贴你的剧本、故事大纲...">${escapeHtml(proj.script || '')}</textarea>
                </div>

                <!-- Row: Duration, Episodes, Ratio, Segment -->
                <div class="flex flex-wrap gap-2 items-end">
                    <div>
                        <span class="text-xs" style="color:var(--text-muted)">时长 (分钟)</span>
                        <input id="settingTotalDurationInline" type="number" class="modal-input mt-1" style="width:60px;text-align:center;font-size:11px;padding:4px" min="${CONFIG.MIN_DURATION}" max="${CONFIG.MAX_DURATION}" value="${proj.totalDuration || CONFIG.DEFAULT_TOTAL_DURATION}">
                    </div>
                    <div>
                        <span class="text-xs" style="color:var(--text-muted)">集数</span>
                        <input id="settingEpisodeCountInline" type="number" class="modal-input mt-1" style="width:60px;text-align:center;font-size:11px;padding:4px" min="1" max="99" value="${proj.episodeCount || 1}">
                    </div>
                    <div>
                        <span class="text-xs" style="color:var(--text-muted)">分辨率</span>
                        <select id="settingResolutionInline" class="modal-input mt-1" style="width:80px;font-size:11px;padding:4px">
                            ${CONFIG.RESOLUTIONS.map(r => `<option value="${r}" ${r === (proj.settings.resolution || '720p') ? 'selected' : ''}>${r}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <span class="text-xs" style="color:var(--text-muted)">比例</span>
                        <select id="settingRatioInline" class="modal-input mt-1" style="width:80px;font-size:11px;padding:4px">
                            ${CONFIG.RATIOS.map(r => `<option value="${r}" ${r === proj.settings.ratio ? 'selected' : ''}>${r}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <span class="text-xs" style="color:var(--text-muted)">片段时长</span>
                        <select id="settingDurationInline" class="modal-input mt-1" style="width:65px;font-size:11px;padding:4px">
                            ${CONFIG.CLIP_DURATIONS.map(d => `<option value="${d}" ${d === proj.settings.defaultDuration ? 'selected' : ''}>${d === -1 ? '自动' : d + 's'}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- Row: Model, Style, Audio -->
                <div class="flex flex-wrap gap-2 items-end">
                    <div>
                        <span class="text-xs" style="color:var(--text-muted)">模型</span>
                        <select id="settingModelInline" class="modal-input mt-1" style="width:140px;font-size:11px;padding:4px">
                            <option value="seedance-2.0" ${proj.settings.model === 'seedance-2.0' ? 'selected' : ''}>Seedance 2.0</option>
                            <option value="seedance-2.0-fast" ${proj.settings.model === 'seedance-2.0-fast' ? 'selected' : ''}>Seedance 2.0 Fast</option>
                        </select>
                    </div>
                    <div>
                        <span class="text-xs" style="color:var(--text-muted)">风格</span>
                        <select id="settingStylePresetInline" class="modal-input mt-1" style="width:130px;font-size:11px;padding:4px">
                            ${CONFIG.STYLE_PRESETS.map(p => `<option value="${p.value}" ${p.value === (proj.settings.stylePreset || '3d-semirealistic') ? 'selected' : ''}>${p.label}</option>`).join('')}
                        </select>
                    </div>
                    <label class="flex items-center gap-1 text-xs pb-1" style="color:var(--text-muted)">
                        <input id="audioToggleInline" type="checkbox" ${proj.settings.generateAudio ? 'checked' : ''} style="accent-color:var(--accent)">
                        音效
                    </label>
                </div>

                <!-- Custom style row -->
                <div id="customStyleRow" class="${(proj.settings.stylePreset === 'custom') ? '' : 'hidden'}">
                    <input id="settingCustomStyleInline" class="modal-input" style="font-size:11px;padding:4px" placeholder="输入自定义风格关键词，如: watercolor, soft pastel tones, dreamy" value="${escapeHtml(proj.settings.customStyleSuffix || '')}">
                </div>

                <!-- Row: Era/Env, Race -->
                <div class="flex flex-wrap gap-2 items-end">
                    <div>
                        <span class="text-xs" style="color:var(--text-muted)">时代环境</span>
                        <select id="settingEnvPresetInline" class="modal-input mt-1" style="width:110px;font-size:11px;padding:4px">
                            ${CONFIG.ENV_PRESETS.map(p => `<option value="${p.value}" ${p.value === (proj.settings.envPreset || '') ? 'selected' : ''}>${p.label}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <span class="text-xs" style="color:var(--text-muted)">人物族裔</span>
                        <select id="settingRacePresetInline" class="modal-input mt-1" style="width:110px;font-size:11px;padding:4px">
                            ${CONFIG.RACE_PRESETS.map(p => `<option value="${p.value}" ${p.value === (proj.settings.racePreset || '') ? 'selected' : ''}>${p.label}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- Custom env / race rows -->
                <div id="customEnvRow" class="${(proj.settings.envPreset === 'custom') ? '' : 'hidden'}">
                    <input id="settingCustomEnvInline" class="modal-input" style="font-size:11px;padding:4px" placeholder="输入自定义时代环境，如: 唐朝盛世、赛博朋克2077" value="${escapeHtml(proj.settings.customEnvSuffix || '')}">
                </div>
                <div id="customRaceRow" class="${(proj.settings.racePreset === 'custom') ? '' : 'hidden'}">
                    <input id="settingCustomRaceInline" class="modal-input" style="font-size:11px;padding:4px" placeholder="输入自定义族裔描述" value="${escapeHtml(proj.settings.customRaceSuffix || '')}">
                </div>

                <!-- Narration language & voice -->
                <div class="flex flex-wrap gap-2 items-center">
                    <span class="text-xs" style="color:var(--text-muted)">旁白语言</span>
                    <select id="settingNarrationLanguageInline" class="modal-input" style="width:100px;font-size:11px;padding:4px">
                        ${CONFIG.LANGUAGES.map(l => `<option value="${l.value}" ${l.value === (proj.settings.narrationLanguage || 'zh') ? 'selected' : ''}>${l.label}</option>`).join('')}
                    </select>
                </div>
                <div class="flex flex-wrap gap-2 items-center">
                    <span class="text-xs" style="color:var(--text-muted)">旁白音色</span>
                    <span id="narrationVoiceLabel" class="text-xs font-medium" style="color:var(--accent-light)">${escapeHtml(proj.settings.narrationVoiceName || '未选择')}</span>
                    <button id="selectVoiceBtn" class="btn-secondary text-xs" style="padding:4px 10px">🎙 选择音色</button>
                </div>

                <!-- Per-project prompt preset -->
                <div class="flex flex-wrap gap-2 items-center">
                    <span class="text-xs" style="color:var(--text-muted)">提示词版本</span>
                    <select id="settingPromptPresetInline" class="modal-input" style="width:160px;font-size:11px;padding:4px">
                        <option value="" ${!currentPromptPreset ? 'selected' : ''}>使用全局默认</option>
                        ${promptPresetOptions.map(o => `<option value="${o.value}" ${currentPromptPreset === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                    </select>
                    <span class="text-xs" style="color:var(--text-faint)">(覆盖全局设置)</span>
                </div>

                <!-- Subtitle generation options for AI script analysis -->
                <div class="flex flex-wrap gap-3 items-center">
                    <span class="text-xs" style="color:var(--text-muted)">分析时同步生成字幕</span>
                    <label class="flex items-center gap-1 text-xs" style="color:var(--text-muted)">
                        <input id="settingIncludeNarrationInline" type="checkbox" ${proj.settings.includeNarration ? 'checked' : ''} style="accent-color:var(--accent)">
                        旁白
                    </label>
                    <label class="flex items-center gap-1 text-xs" style="color:var(--text-muted)">
                        <input id="settingIncludeDialogueInline" type="checkbox" ${proj.settings.includeDialogue ? 'checked' : ''} style="accent-color:var(--accent)">
                        角色台词
                    </label>
                </div>

                <!-- Action buttons -->
                <div class="flex gap-2 mt-1">
                    <button id="analyzeBtn" class="btn-primary text-xs" style="padding:6px 12px">
                        ✨ AI 分析剧本
                    </button>
                    <button class="btn-secondary text-xs" id="saveDraftBtn" style="padding:6px 12px">保存</button>
                </div>
                <div id="streamPreview" class="hidden" style="max-height:150px;overflow-y:auto;padding:8px;font-size:10px;line-height:1.4;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace;background:var(--bg-pill);border-radius:6px"></div>
            </div>
        </div>`;

    // Attach events
    if ($('settingStylePresetInline')) $('settingStylePresetInline').onchange = () => {
        const row = $('customStyleRow');
        if (row) row.classList.toggle('hidden', $('settingStylePresetInline').value !== 'custom');
    };
    if ($('settingEnvPresetInline')) $('settingEnvPresetInline').onchange = () => {
        const row = $('customEnvRow');
        if (row) row.classList.toggle('hidden', $('settingEnvPresetInline').value !== 'custom');
    };
    if ($('settingRacePresetInline')) $('settingRacePresetInline').onchange = () => {
        const row = $('customRaceRow');
        if (row) row.classList.toggle('hidden', $('settingRacePresetInline').value !== 'custom');
    };
    if ($('selectVoiceBtn')) $('selectVoiceBtn').onclick = () => {
        const selector = new VoiceTypeSelector({
            initialVoiceType: proj.settings.narrationVoice || '',
            initialSpeed: proj.settings.narrationSpeed || 0,
            onSelect: async (result) => {
                proj.settings.narrationVoice = result.voiceType;
                proj.settings.narrationVoiceName = result.voiceName;
                proj.settings.narrationSpeed = result.speechRate;
                const label = $('narrationVoiceLabel');
                if (label) label.textContent = result.voiceName;
                await saveProject(proj);
                showToast(`已选择音色: ${result.voiceName}`, 'success');
            },
        });
        selector.open();
    };
    if ($('analyzeBtn')) $('analyzeBtn').onclick = () => { if (onAnalyze) onAnalyze(); };
    if ($('saveDraftBtn')) $('saveDraftBtn').onclick = async () => { if (onSave) onSave(); };
}
