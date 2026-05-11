// ============ AI Image Generation Modal ============

import { escapeHtml, showToast, $, resolveUrl } from './utils.js';
import { CONFIG, getStylePreset, getEnvPreset, getRacePreset } from './config.js';
import { uploadTempImage } from './api.js';

/**
 * Aspect ratio definitions with labels and icons.
 */
const ASPECT_RATIOS = [
    { value: 'auto',  label: '智能', icon: '🔲' },
    { value: '21:9',  label: '21:9', icon: '▬' },
    { value: '16:9',  label: '16:9', icon: '▬' },
    { value: '3:2',   label: '3:2',  icon: '▭' },
    { value: '4:3',   label: '4:3',  icon: '▭' },
    { value: '1:1',   label: '1:1',  icon: '□' },
    { value: '3:4',   label: '3:4',  icon: '▯' },
    { value: '2:3',   label: '2:3',  icon: '▯' },
    { value: '9:16',  label: '9:16', icon: '▯' },
];

/**
 * Resolution presets.
 */
const RESOLUTIONS = [
    { value: '2k', label: '高清 2K', maxDim: 2048 },
    { value: '4k', label: '超清 4K', maxDim: 4096 },
];

// Seedream requires at least 3,686,400 pixels (1920²).
const MIN_PIXELS = 3686400;

/**
 * Calculate width and height from aspect ratio and resolution.
 * Ensures the total pixel count meets the provider minimum.
 */
function calcDimensions(ratioValue, resValue) {
    const res = RESOLUTIONS.find(r => r.value === resValue) || RESOLUTIONS[0];
    const maxDim = res.maxDim;

    let w, h;
    if (ratioValue === 'auto' || ratioValue === '1:1') {
        w = maxDim; h = maxDim;
    } else {
        const parts = ratioValue.split(':');
        const rw = parseInt(parts[0]);
        const rh = parseInt(parts[1]);
        if (rw >= rh) {
            w = maxDim;
            h = Math.round(maxDim * rh / rw);
        } else {
            h = maxDim;
            w = Math.round(maxDim * rw / rh);
        }
    }

    // Scale up if total pixels are below the provider minimum
    const pixels = w * h;
    if (pixels < MIN_PIXELS) {
        const scale = Math.sqrt(MIN_PIXELS / pixels);
        w = Math.ceil(w * scale);
        h = Math.ceil(h * scale);
    }

    return { width: w, height: h };
}

/**
 * Build the style instruction string from project settings (mirrors api.js getImageStyleInstruction).
 */
function buildStyleInstruction(project) {
    const preset = getStylePreset(project?.settings?.stylePreset);
    let style = preset.value === 'custom'
        ? (project?.settings?.customStyleSuffix || '')
        : (preset.promptSuffix || '');

    const envPreset = getEnvPreset(project?.settings?.envPreset);
    const envHint = envPreset.value === 'custom'
        ? (project?.settings?.customEnvSuffix || '')
        : (envPreset.promptHint || '');
    const racePreset = getRacePreset(project?.settings?.racePreset);
    const raceHint = racePreset.value === 'custom'
        ? (project?.settings?.customRaceSuffix || '')
        : (racePreset.promptHint || '');

    if (envHint) style += (style ? ', ' : '') + envHint;
    if (raceHint) style += (style ? ', ' : '') + raceHint;
    return style;
}

/**
 * Build the default prompt for a given node type and description.
 * @param {'character'|'scene'|'prop'} nodeType
 * @param {string} description
 * @param {Object} project
 * @returns {string}
 */
function buildDefaultPrompt(nodeType, description, project) {
    const style = buildStyleInstruction(project);
    switch (nodeType) {
        case 'character':
            return style
                ? `生成精致的人物形象,${style},人物尽量占满,除了角色外背景为纯白色,生成完整的半身像(腰以上)。角色描述：${description}`
                : `生成写实的,精致的,2D动漫风格的人物形象,人物尽量占满,除了角色外背景为纯白色,生成完整的半身像(腰以上)。角色描述：${description}`;
        case 'scene':
            return style
                ? `生成场景图片,${style},镜头尽量在适合拍照打卡的角度,不要有人物,Image should NOT include human, just scene。场景描述：${description}`
                : `生成著名场景的图片：使用超级写实风格，镜头尽量在适合拍照打卡的角度，*不要*有人物， Image should NOT include human, just scene。场景描述：${description}`;
        case 'prop':
            return style
                ? `生成精致的道具物品图片,${style},物品尽量占满画面,背景为纯白色,展示完整的物品细节。道具描述：${description}`
                : `生成精致的道具物品图片,物品尽量占满画面,背景为纯白色,展示完整的物品细节。道具描述：${description}`;
        default:
            return description;
    }
}

/**
 * Show the AI image generation modal.
 *
 * @param {Object} options
 * @param {'character'|'scene'|'prop'|'picturebook'|string} options.nodeType - Type of the node
 * @param {string} options.description - The node's current description text
 * @param {Object} options.project - The current project
 * @param {Function} options.onGenerate - async callback(prompt, { width, height, referenceImages }) => called when user clicks generate
 * @param {Function} [options.onSave] - async callback(description) => called to auto-save node info before generating
 * @param {string[]} [options.initialReferenceImages] - URLs to pre-populate the reference image list
 * @param {Function} [options.onReferencesChange] - async callback(referenceImages: string[]) => fired whenever the reference list changes (add/remove); use to persist refs on the node
 * @param {Function} [options.customBuildPrompt] - (description) => string. Override the default prompt builder (used by picturebook etc.)
 * @param {string} [options.typeLabel] - Override the modal title type label (e.g. '绘本插画')
 * @param {string} [options.descriptionLabel] - Override the description textarea label (e.g. '画面描述')
 * @param {string} [options.defaultRatio] - Override the default aspect ratio (e.g. '16:9')
 * @param {string} [options.defaultRes] - Override the default resolution ('2k' | '4k')
 */
export function showGenImageModal({ nodeType, description, project, onGenerate, onSave, initialReferenceImages, onReferencesChange, customBuildPrompt, typeLabel: typeLabelOverride, descriptionLabel, defaultRatio: defaultRatioOverride, defaultRes: defaultResOverride }) {
    // Remove any existing modal
    const existing = $('genImageModal');
    if (existing) existing.remove();

    const defaultRatio = defaultRatioOverride || 'auto';
    const defaultRes = defaultResOverride || '2k';
    const buildPrompt = (typeof customBuildPrompt === 'function')
        ? customBuildPrompt
        : (desc) => buildDefaultPrompt(nodeType, desc, project);
    const defaultPrompt = buildPrompt(description);
    const dims = calcDimensions(defaultRatio, defaultRes);

    const typeLabels = { character: '角色', scene: '场景', prop: '道具', picturebook: '绘本插画' };
    const typeLabel = typeLabelOverride || typeLabels[nodeType] || '图片';
    const descLabel = descriptionLabel || '外观描述';

    const overlay = document.createElement('div');
    overlay.id = 'genImageModal';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center';
    overlay.innerHTML = `
        <div class="card-flat fade-in" style="width:600px;max-width:calc(100vw - 24px);max-height:85vh;overflow-y:auto;padding:24px">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-base font-semibold">🎨 AI生成${escapeHtml(typeLabel)}图片</h3>
                <span id="genImgModalClose" class="cursor-pointer text-xl" style="color:var(--text-muted)">&times;</span>
            </div>

            <!-- Description / Prompt -->
            <div class="mb-4">
                <label class="text-xs" style="color:var(--text-muted)">${escapeHtml(descLabel)}</label>
                <textarea id="genImgDesc" class="modal-input mt-1" style="min-height:80px">${escapeHtml(description)}</textarea>
            </div>

            <div class="mb-4">
                <label class="text-xs" style="color:var(--text-muted)">完整提示词 <span style="color:var(--text-faint)">(可编辑)</span></label>
                <textarea id="genImgPrompt" class="modal-input mt-1" style="min-height:100px;font-size:12px;font-family:monospace">${escapeHtml(defaultPrompt)}</textarea>
            </div>

            <!-- Reference Images -->
            <div class="mb-4" data-img-paste="genimg-ref">
                <label class="text-xs" style="color:var(--accent-blue)">参考图片 <span style="color:var(--text-faint)">(可选，可粘贴或上传，最多 4 张)</span></label>
                <div class="mt-2 flex flex-wrap items-center gap-2" id="genImgRefList"></div>
                <div class="mt-2 flex items-center gap-2">
                    <label class="upload-zone" style="width:60px;height:60px;flex-shrink:0;cursor:pointer" title="上传参考图片">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <input type="file" accept="image/*" multiple class="hidden" id="genImgRefInput">
                    </label>
                    <span class="text-xs" style="color:var(--text-faint)" id="genImgRefHint">尚未添加参考图片</span>
                </div>
            </div>

            <!-- Aspect Ratio -->
            <div class="mb-4">
                <label class="text-xs" style="color:var(--accent-blue)">选择比例</label>
                <div class="flex flex-wrap gap-1 mt-2" id="genImgRatioGroup">
                    ${ASPECT_RATIOS.map(r => `
                        <button class="genimg-ratio-btn${r.value === defaultRatio ? ' active' : ''}" data-ratio="${r.value}" title="${r.label}">
                            <span class="genimg-ratio-icon">${r.icon}</span>
                            <span class="genimg-ratio-label">${r.label}</span>
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- Resolution -->
            <div class="mb-4">
                <label class="text-xs" style="color:var(--accent-blue)">选择分辨率</label>
                <div class="flex gap-2 mt-2" id="genImgResGroup">
                    ${RESOLUTIONS.map(r => `
                        <button class="genimg-res-btn${r.value === defaultRes ? ' active' : ''}" data-res="${r.value}">
                            ${escapeHtml(r.label)}${r.value === '4k' ? ' <span style="color:var(--accent-blue)">✨</span>' : ''}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- Dimensions Display -->
            <div class="mb-4">
                <label class="text-xs" style="color:var(--text-muted)">尺寸</label>
                <div class="flex items-center gap-3 mt-2">
                    <div class="flex items-center gap-2">
                        <span class="text-xs" style="color:var(--text-muted)">W</span>
                        <span id="genImgWidth" class="genimg-dim-value">${dims.width}</span>
                    </div>
                    <span style="color:var(--text-faint)">🔗</span>
                    <div class="flex items-center gap-2">
                        <span class="text-xs" style="color:var(--text-muted)">H</span>
                        <span id="genImgHeight" class="genimg-dim-value">${dims.height}</span>
                    </div>
                    <span class="text-xs" style="color:var(--text-muted)">PX</span>
                </div>
            </div>

            <!-- Summary Bar -->
            <div class="flex items-center gap-3 mb-4 px-3 py-2 rounded-lg" style="background:var(--bg-pill)">
                <span id="genImgSummaryRatio" class="text-xs" style="color:var(--text-secondary)">${defaultRatio === 'auto' ? '智能' : defaultRatio}</span>
                <span class="text-xs" style="color:var(--text-faint)">|</span>
                <span id="genImgSummaryRes" class="text-xs" style="color:var(--text-secondary)">高清 2K</span>
            </div>

            <!-- Actions -->
            <div class="flex gap-2">
                <button class="btn-primary flex-1" id="genImgStartBtn">🎨 生成</button>
                <button class="btn-secondary" id="genImgCancelBtn">取消</button>
            </div>

            <!-- Progress indicator (hidden initially) -->
            <div id="genImgProgress" class="hidden mt-3 flex items-center gap-2" style="color:var(--text-muted)">
                <div class="spinner"></div>
                <span class="text-xs">生成中，请稍候...</span>
            </div>

            <!-- Last error message (hidden initially) -->
            <div id="genImgError" class="hidden mt-3 p-3 rounded-lg text-xs" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#fca5a5;word-break:break-all;white-space:pre-wrap"></div>
        </div>
    `;

    document.body.appendChild(overlay);

    // --- State ---
    let selectedRatio = defaultRatio;
    let selectedRes = defaultRes;
    const MAX_REFS = 4;
    /** @type {string[]} */
    const referenceImages = Array.isArray(initialReferenceImages)
        ? initialReferenceImages.filter(u => typeof u === 'string' && u).slice(0, MAX_REFS)
        : [];

    function renderRefList() {
        const list = $('genImgRefList');
        const hint = $('genImgRefHint');
        if (!list) return;
        list.innerHTML = referenceImages.map((url, idx) => `
            <div class="relative" style="position:relative;display:inline-block">
                <img src="${escapeHtml(resolveUrl(url))}" class="img-thumb" title="${escapeHtml(url)}">
                <button class="genimg-ref-remove" data-idx="${idx}" title="移除"
                    style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:none;background:#ef4444;color:#fff;font-size:11px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center">×</button>
            </div>
        `).join('');
        if (hint) {
            hint.textContent = referenceImages.length
                ? `已添加 ${referenceImages.length}/${MAX_REFS} 张参考图片`
                : '尚未添加参考图片';
        }
        list.querySelectorAll('.genimg-ref-remove').forEach(btn => {
            btn.onclick = () => {
                const i = parseInt(btn.dataset.idx, 10);
                if (!isNaN(i)) {
                    referenceImages.splice(i, 1);
                    renderRefList();
                    notifyRefsChanged();
                }
            };
        });
    }

    function notifyRefsChanged() {
        if (typeof onReferencesChange !== 'function') return;
        try {
            const result = onReferencesChange(referenceImages.slice());
            if (result && typeof result.then === 'function') {
                result.catch(err => console.warn('onReferencesChange failed:', err));
            }
        } catch (err) {
            console.warn('onReferencesChange failed:', err);
        }
    }

    async function addReferenceFile(file) {
        if (!file || !file.type?.startsWith('image/')) return;
        if (referenceImages.length >= MAX_REFS) {
            showToast(`最多只能添加 ${MAX_REFS} 张参考图片`, 'error');
            return;
        }
        const hint = $('genImgRefHint');
        if (hint) hint.textContent = '上传中...';
        const url = await uploadTempImage(file);
        if (url) {
            referenceImages.push(url);
            renderRefList();
            notifyRefsChanged();
        } else if (hint) {
            renderRefList();
        }
    }

    renderRefList();

    function updateDimensions() {
        const d = calcDimensions(selectedRatio, selectedRes);
        $('genImgWidth').textContent = d.width;
        $('genImgHeight').textContent = d.height;
        const ratioLabel = ASPECT_RATIOS.find(r => r.value === selectedRatio)?.label || selectedRatio;
        $('genImgSummaryRatio').textContent = ratioLabel;
        const resLabel = RESOLUTIONS.find(r => r.value === selectedRes)?.label || selectedRes;
        $('genImgSummaryRes').textContent = resLabel;
    }

    function updatePrompt() {
        const desc = $('genImgDesc')?.value?.trim() || description;
        const prompt = buildPrompt(desc);
        $('genImgPrompt').value = prompt;
    }

    // --- Events ---
    // Close
    $('genImgModalClose').onclick = () => overlay.remove();
    $('genImgCancelBtn').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    // Ratio buttons
    overlay.querySelectorAll('.genimg-ratio-btn').forEach(btn => {
        btn.onclick = () => {
            overlay.querySelectorAll('.genimg-ratio-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedRatio = btn.dataset.ratio;
            updateDimensions();
        };
    });

    // Resolution buttons
    overlay.querySelectorAll('.genimg-res-btn').forEach(btn => {
        btn.onclick = () => {
            overlay.querySelectorAll('.genimg-res-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedRes = btn.dataset.res;
            updateDimensions();
        };
    });

    // Description change → rebuild prompt
    $('genImgDesc').addEventListener('input', updatePrompt);

    // Reference image upload
    const refInput = $('genImgRefInput');
    if (refInput) {
        refInput.onchange = async (e) => {
            const files = Array.from(e.target.files || []);
            for (const f of files) await addReferenceFile(f);
            refInput.value = '';
        };
    }

    // Paste image into modal as reference (active while modal is open)
    const onPaste = async (e) => {
        if (!document.body.contains(overlay)) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        let consumed = false;
        for (const item of items) {
            if (item.type?.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) { await addReferenceFile(file); consumed = true; }
            }
        }
        if (consumed) e.preventDefault();
    };
    document.addEventListener('paste', onPaste);
    const cleanupPaste = () => document.removeEventListener('paste', onPaste);
    overlay.addEventListener('remove', cleanupPaste);
    // Also clean up via MutationObserver fallback
    const mo = new MutationObserver(() => {
        if (!document.body.contains(overlay)) { cleanupPaste(); mo.disconnect(); }
    });
    mo.observe(document.body, { childList: true, subtree: false });

    // Generate
    $('genImgStartBtn').onclick = async () => {
        const prompt = $('genImgPrompt')?.value?.trim();
        if (!prompt) { showToast('提示词不能为空', 'error'); return; }

        const updatedDesc = $('genImgDesc')?.value?.trim();
        // Auto-save node description before generating
        if (onSave && updatedDesc) {
            try {
                await onSave(updatedDesc);
            } catch (e) {
                console.warn('Auto-save before generate failed:', e);
            }
        }

        const d = calcDimensions(selectedRatio, selectedRes);
        const startBtn = $('genImgStartBtn');
        startBtn.disabled = true;
        startBtn.textContent = '⏳ 生成中...';
        $('genImgProgress').classList.remove('hidden');

        try {
            await onGenerate(prompt, { width: d.width, height: d.height, referenceImages: referenceImages.slice() });
            overlay.remove();
        } catch (err) {
            showToast(`生成失败: ${err.message}`, 'error');
            // Show error details in the modal
            const errEl = $('genImgError');
            if (errEl) {
                errEl.textContent = `❌ 上次错误: ${err.message}`;
                errEl.classList.remove('hidden');
            }
            startBtn.disabled = false;
            startBtn.textContent = '🎨 生成';
            $('genImgProgress').classList.add('hidden');
        }
    };
}
