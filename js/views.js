// ============ View Renderers ============

import { CONFIG } from './config.js';
import { state, sdk, createProject, linkBreakdown, PIPELINE_STAGES, runPreflight, getFolders, normalizeProject, resetTreeExpanded } from './state.js';
import { escapeHtml, showToast, $, truncate, resolveUrl } from './utils.js';
import { saveProject, saveProjectSilent, loadProjectList, loadProject, deleteProjectRemote, saveProjectList, backupProject, listBackups, loadBackup, clearBackups, clearUndoRedo, loadTaskLog, saveAssetToLocal, syncProjectFileToLocal, reattachLocalDir } from './storage.js';
import { analyzeScript, getAnalyzeScriptPrompt, saveProjectImageAsset, uploadTempVideo, uploadTempAudio, uploadTempImage, submitGenVideo, startPolling, stopPolling, getRegeneratePrompt, regenerateNode, generateCharacterImage, generateSceneImage, generatePropImage, enhanceCharacters, getEnhanceCharactersPrompt, enhanceScenes, getEnhanceScenesPrompt, enhanceShots, getEnhanceShotsPrompt, runPreflightAI, runConsistencyReview, generateShotPicturebookImage, generateSubtitles, genImage as genImageDirect } from './api.js';
import { ensurePresetLoaded } from './prompts.js';
import { getGlobalPromptPreset } from './global_settings.js';
import { buildTree, renderTreeHTML, attachTreeEvents, isFolder, getCategoryFromType, getItemType } from './tree.js';
import ClipEditor from './clipeditor.js';
import Mp4ToWebp from './mp4ToWebp.js';
import { showNewProjectModal } from './newproject.js';
import { renderCharactersGallery } from './view_chars.js';
import { renderPropsGallery } from './view_props.js';
import { renderScenesGallery } from './view_scenes.js';
import { renderShortsGallery } from './view_shorts.js';
import { renderPlotSettings } from './view_plot_settings.js';
import { renderGeneration, onGenerationUpdate, onStartGeneration, tryGenerateNext } from './generate.js';
import { renderPreview } from './preview.js';
import PRESETS from './presets.js';
import { saveStatsToProject, loadStatsFromProject } from './stats.js';
import { showGenImageModal } from './genImage.js';

let _clipEditorInstance = null;
let _mp4ToWebpInstance = null;

function isMobile() { return window.innerWidth <= 768; }

function isAssetLibraryUrl(url) {
    return typeof url === 'string' && url.trim().startsWith('asset://');
}

function normalizeVirtualPortraitRef(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return '';
    if (raw.startsWith('asset://')) {
        const id = raw.slice('asset://'.length).trim();
        return /^asset-[a-zA-Z0-9-]+$/.test(id) ? `asset://${id}` : '';
    }
    return /^asset-[a-zA-Z0-9-]+$/.test(raw) ? `asset://${raw}` : '';
}

function updateMobileBottomBar(view) {
    const mapping = { breakdown: 'mobTabBreakdown', generation: 'mobTabGenerate', preview: 'mobTabPreview' };
    document.querySelectorAll('.mob-tab').forEach(t => t.classList.remove('active'));
    const activeId = mapping[view];
    if (activeId) {
        const el = document.getElementById(activeId);
        if (el) el.classList.add('active');
    }
}

/** Build a preset-combo HTML: input with a dropdown button listing preset options. */
function presetComboHTML(id, value, placeholder, presetKey) {
    const items = PRESETS[presetKey] || [];
    const arrow = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>`;
    const opts = items.map(i => `<div class="preset-dropdown-item" data-value="${escapeHtml(i.value)}">${escapeHtml(i.label)}</div>`).join('');
    return `<div class="preset-combo">
        <input id="${id}" class="modal-input" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
        <button type="button" class="preset-combo-btn" data-dropdown="${id}_dd">${arrow}</button>
        <div id="${id}_dd" class="preset-dropdown">${opts}</div>
    </div>`;
}

/** Attach click handlers for all preset-combo dropdowns currently in the DOM. */
function initPresetCombos() {
    document.querySelectorAll('.preset-combo-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const ddId = btn.getAttribute('data-dropdown');
            const dd = document.getElementById(ddId);
            if (!dd) return;
            // close others
            document.querySelectorAll('.preset-dropdown.open').forEach(d => { if (d !== dd) d.classList.remove('open'); });
            dd.classList.toggle('open');
        });
    });
    document.querySelectorAll('.preset-dropdown-item').forEach(item => {
        item.addEventListener('click', e => {
            e.stopPropagation();
            const dd = item.closest('.preset-dropdown');
            const combo = item.closest('.preset-combo');
            const input = combo?.querySelector('.modal-input');
            if (input) { input.value = item.getAttribute('data-value'); input.dispatchEvent(new Event('input', { bubbles: true })); }
            if (dd) dd.classList.remove('open');
        });
    });
    // close on outside click
    const closeAll = () => document.querySelectorAll('.preset-dropdown.open').forEach(d => d.classList.remove('open'));
    document.addEventListener('click', closeAll, { once: false });
}

export function renderClipEditorView() {
    const proj = state.currentProject;
    if (!proj || !proj.shorts || proj.shorts.length === 0) {
        showToast('没有短片可预览', 'error');
        navigateTo('breakdown');
        return;
    }
    const container = $('viewContainer');
    setViewContainerPadding('compact');
    if (_clipEditorInstance) { _clipEditorInstance.destroy(); _clipEditorInstance = null; }
    container.innerHTML = `<div class="flex flex-col h-full"><div class="flex items-center justify-between mb-2"><h3 class="text-base font-semibold" style="color:var(--text-primary)">🎬 剪辑编辑器</h3></div><div id="clipEditorHost" class="flex-1" style="min-height:0"></div></div>`;
    const sorted = [...proj.shorts].sort((a, b) => a.order - b.order);
    _clipEditorInstance = new ClipEditor({
        container: $('clipEditorHost'),
        project: proj,
        shorts: sorted,
        transition: 'cut',
        defaultDuration: proj.settings?.defaultDuration || 5,
        onProjectChange: () => { saveProjectSilent(proj).catch(() => {}); },
        generateSubtitles,
    });
}

export function renderMp4ToWebpView() {
    const proj = state.currentProject;
    if (!proj || !proj.shorts || proj.shorts.length === 0) {
        showToast('没有短片可转换', 'error');
        navigateTo('breakdown');
        return;
    }
    const hasVideo = proj.shorts.some(s => s.videoUrl && s.status === 'succeeded');
    if (!hasVideo) {
        showToast('没有已生成的视频可转换', 'error');
        navigateTo('generation');
        return;
    }
    const container = $('viewContainer');
    setViewContainerPadding('compact');
    if (_mp4ToWebpInstance) { _mp4ToWebpInstance.destroy(); _mp4ToWebpInstance = null; }
    container.innerHTML = `<div class="flex flex-col h-full"><div class="flex items-center justify-between mb-2"><h3 class="text-base font-semibold" style="color:var(--text-primary)">🎬 MP4 → WebP / 帧序列</h3></div><div id="mp4ToWebpHost" class="flex-1" style="min-height:0"></div></div>`;
    const sorted = [...proj.shorts].sort((a, b) => a.order - b.order);
    _mp4ToWebpInstance = new Mp4ToWebp({
        container: $('mp4ToWebpHost'),
        shorts: sorted,
    });
}

function destroyToolInstances() {
    if (_clipEditorInstance) { _clipEditorInstance.destroy(); _clipEditorInstance = null; }
    if (_mp4ToWebpInstance) { _mp4ToWebpInstance.destroy(); _mp4ToWebpInstance = null; }
}

export function openClipEditor() { navigateTo('clipEditor'); }
export function openMp4ToWebp() { navigateTo('mp4ToWebp'); }

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 520;

export function setViewContainerPadding(mode = 'default') {
    const container = $('viewContainer');
    if (!container) return;
    // Base padding; mobile bottom padding is handled via CSS media query
    container.style.padding = mode === 'compact' ? '10px 12px 12px' : '24px';
}

// ============ Navigation ============
export function navigateTo(view) {
    // Destroy tool instances when navigating away
    if (state.currentView === 'clipEditor' || state.currentView === 'mp4ToWebp') {
        destroyToolInstances();
    }
    // Reset mobile detail state
    document.body.classList.remove('mobile-detail-open');
    state.currentView = view;
    const labels = { projectList: '项目列表', breakdown: '剧情编排', generation: '视频生成', preview: '影片预览', clipEditor: '剪辑编辑器', mp4ToWebp: 'MP4→WebP' };
    $('viewBadge').textContent = labels[view] || view;
    updateTopbar(view);
    updateSidebarHighlight(view);
    updateMobileBottomBar(view);
    const renderers = { projectList: renderProjectList, breakdown: renderBreakdown, generation: renderGeneration, preview: renderPreview, clipEditor: renderClipEditorView, mp4ToWebp: renderMp4ToWebpView };
    if (renderers[view]) renderers[view]();
}

export function updateSidebarHighlight(view) {
    const mapping = {
        breakdown: 'sidebarBreakdownBtn',
        generation: 'sidebarGenerateBtn',
        preview: 'sidebarPreviewBtn',
        clipEditor: 'sidebarClipEditorBtn',
        mp4ToWebp: 'sidebarMp4ToWebpBtn',
    };
    Object.values(mapping).forEach(id => {
        const el = $(id);
        if (el) {
            el.style.background = '';
            el.style.color = 'var(--text-muted)';
        }
    });
    const activeId = mapping[view];
    if (activeId) {
        const el = $(activeId);
        if (el) {
            el.style.background = 'var(--bg-pill)';
            el.style.color = 'var(--accent-light)';
        }
    }
}

function updateTopbar(view) {
    const context = $('topbarContext');
    const titleHost = $('topbarProjectTitleHost');
    const loadBtn = $('topbarLoadProjectBtn');
    const proj = state.currentProject;

    if (!context || !titleHost || !loadBtn) return;

    if (!proj || view === 'projectList') {
        context.classList.add('hidden');
        titleHost.innerHTML = '';
        if ($('menuBackupBtn')) $('menuBackupBtn').classList.add('disabled');
        if ($('menuRollbackBtn')) $('menuRollbackBtn').classList.add('disabled');
        if ($('menuExportLocalBtn')) $('menuExportLocalBtn').classList.add('disabled');
        if ($('menuLocalModeBtn')) $('menuLocalModeBtn').classList.add('disabled');
        return;
    }

    context.classList.remove('hidden');

    // Show backup/rollback buttons when a project is open
    if ($('menuBackupBtn')) {
        $('menuBackupBtn').classList.remove('disabled');
        $('menuBackupBtn').onclick = async () => {
            $('fileMenuDropdown').classList.remove('open');
            collectSettingsInline();
            const name = await backupProject(proj, { force: true });
            if (name) showToast(`已备份: ${name.split('/').pop()}`, 'success');
            else showToast('备份失败', 'error');
        };
    }
    if ($('menuRollbackBtn')) {
        $('menuRollbackBtn').classList.remove('disabled');
        $('menuRollbackBtn').onclick = () => { $('fileMenuDropdown').classList.remove('open'); onShowRollbackModal(); };
    }
    if ($('menuExportLocalBtn')) {
        $('menuExportLocalBtn').classList.remove('disabled');
    }
    if ($('menuLocalModeBtn')) {
        $('menuLocalModeBtn').classList.remove('disabled');
        $('menuLocalModeBtn').textContent = proj.localMode ? '📍 关闭本地模式' : '📍 本地模式';
    }
    loadBtn.onclick = async () => {
        if (state.currentView === 'breakdown') {
            collectSettingsInline();
            await saveProject(state.currentProject);
        }
        navigateTo('projectList');
    };

    if (view === 'breakdown') {
        const localBadge = proj.localMode ? '<span class="status-badge" style="background:rgba(16,185,129,0.15);color:#6ee7b7;font-size:10px;margin-left:6px;flex-shrink:0">📍 本地</span>' : '';
        titleHost.innerHTML = `<input id="topbarProjectTitleInput" class="topbar-project-input" value="${escapeHtml(proj.title)}" placeholder="项目标题" size="1">${localBadge}`;
        const input = $('topbarProjectTitleInput');
        const autoSize = () => {
            const len = [...input.value].reduce((n, c) => n + (c.charCodeAt(0) > 0x7f ? 2 : 1), 0);
            input.style.width = Math.max(4, len + 2) + 'ch';
        };
        autoSize();
        input.oninput = () => {
            proj.title = input.value.trim() || '未命名项目';
            autoSize();
        };
        input.onchange = async () => {
            proj.title = input.value.trim() || '未命名项目';
            await saveProject(proj);
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') input.blur();
        };
    } else {
        const localBadgeAlt = proj.localMode ? '<span class="status-badge" style="background:rgba(16,185,129,0.15);color:#6ee7b7;font-size:10px;margin-left:6px;flex-shrink:0">📍 本地</span>' : '';
        titleHost.innerHTML = `<div class="topbar-project-title">${escapeHtml(proj.title)}</div>${localBadgeAlt}`;
    }

    // Pipeline stage badge + dropdown
    const stageHost = document.getElementById('topbarContext');
    const existingBar = document.getElementById('pipelineStageBar');
    if (existingBar) existingBar.remove();
    if (stageHost && proj.pipelineStage) {
        const stageIdx = PIPELINE_STAGES.findIndex(s => s.key === proj.pipelineStage);
        const current = PIPELINE_STAGES[stageIdx] || PIPELINE_STAGES[0];
        // Badge colors per stage type
        const badgeColors = {
            draft: 'background:var(--bg-pill);color:var(--text-muted)',
            parsed: 'background:rgba(99,102,241,0.15);color:#818cf8',
            enhanced: 'background:rgba(99,102,241,0.15);color:#818cf8',
            preflight_passed: 'background:rgba(16,185,129,0.15);color:#6ee7b7',
            generating: 'background:rgba(251,191,36,0.15);color:#fcd34d',
            reviewing: 'background:rgba(251,191,36,0.15);color:#fcd34d',
            completed: 'background:rgba(16,185,129,0.15);color:#6ee7b7',
        };
        const badgeStyle = badgeColors[current.key] || badgeColors.draft;
        const dropdownItems = PIPELINE_STAGES.map((s, i) => {
            const cls = i < stageIdx ? 'done' : i === stageIdx ? 'active' : '';
            return `<div class="pipeline-dropdown-item ${cls}"><span class="pip-dot"></span>${s.icon} ${s.label}</div>`;
        }).join('');
        const wrap = document.createElement('div');
        wrap.id = 'pipelineStageBar';
        wrap.className = 'pipeline-badge-wrap';
        wrap.innerHTML = `<button class="pipeline-badge-btn" style="${badgeStyle}" id="pipelineBadgeBtn">${current.icon} ${current.label} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m6 9 6 6 6-6"/></svg></button>`;
        // Append dropdown to body so it escapes all stacking contexts (backdrop-filter etc.)
        const existingDropdown = document.getElementById('pipelineDropdown');
        if (existingDropdown) existingDropdown.remove();
        const dropdown = document.createElement('div');
        dropdown.id = 'pipelineDropdown';
        dropdown.className = 'pipeline-dropdown';
        dropdown.innerHTML = dropdownItems;
        document.body.appendChild(dropdown);
        stageHost.appendChild(wrap);
        const btn = document.getElementById('pipelineBadgeBtn');
        const closeDropdown = (e) => { if (!wrap.contains(e.target) && !dropdown.contains(e.target)) { dropdown.classList.remove('open'); document.removeEventListener('click', closeDropdown); } };
        btn.onclick = (e) => {
            e.stopPropagation();
            const opening = !dropdown.classList.contains('open');
            if (opening) {
                const rect = btn.getBoundingClientRect();
                dropdown.style.top = (rect.bottom + 4) + 'px';
                dropdown.style.left = rect.left + 'px';
                dropdown.classList.add('open');
                document.addEventListener('click', closeDropdown);
            } else {
                dropdown.classList.remove('open');
                document.removeEventListener('click', closeDropdown);
            }
        };
    }
}

// ============ Project List ============
async function renderProjectList() {
    const container = $('viewContainer');
    setViewContainerPadding('default');
    container.innerHTML = `
        <div class="max-w-4xl mx-auto">
            <div class="flex items-center justify-between mb-6">
                <div><h2 class="text-xl font-bold">我的影片项目</h2><p class="text-sm mt-1" style="color:var(--text-muted)">用 AI 将剧本变成短视频</p></div>
                <button class="btn-primary" id="newProjBtn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>新建项目</button>
            </div>
            <div id="projectGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div class="flex items-center justify-center py-12" style="color:var(--text-muted)"><div class="spinner mr-3"></div>加载中...</div>
            </div>
            <div class="mt-10 mb-6">
                <h3 class="text-lg font-bold mb-1">模板</h3>
                <p class="text-xs" style="color:var(--text-muted)">从预设模板快速创建项目</p>
            </div>
            <div id="templateGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div class="flex items-center justify-center py-8" style="color:var(--text-muted)"><div class="spinner mr-3"></div>加载模板...</div>
            </div>
        </div>`;

    $('newProjBtn').onclick = () => {
        if (!state.token) { showToast('请先登录', 'error'); return; }
        showNewProjectModal();
    };

    if (!state.token) {
        const grid = $('projectGrid');
        grid.innerHTML = `<div class="col-span-full flex flex-col items-center py-20">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <p class="mt-4 mb-6 text-sm" style="color:var(--text-muted)">登录后即可创建和管理影片项目</p>
            <button id="bigLoginBtn" class="btn-primary" style="padding:14px 48px;font-size:16px;border-radius:12px">请先登录</button>
        </div>`;
        const tplGrid = $('templateGrid');
        if (tplGrid) tplGrid.innerHTML = '';
        $('bigLoginBtn').onclick = async () => {
            try {
                await sdk.showLoginWindow({ title: 'Keepwork 登录' });
                if (state.token) {
                    navigateTo('projectList');
                    showToast('登录成功', 'success');
                }
            } catch (e) { console.error('Login error:', e); }
        };
        return;
    }

    const summaries = await loadProjectList();
    state.projects = summaries;
    const grid = $('projectGrid');
    if (!summaries.length) {
        grid.innerHTML = `<div class="col-span-full flex flex-col items-center py-16"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M2 12h5"/><path d="m15 8 4 4-4 4"/></svg><p class="mt-4 text-sm" style="color:var(--text-muted)">还没有项目，点击上方按钮创建</p></div>`;
        return;
    }
    grid.innerHTML = summaries.map(p => {
        const date = new Date(p.createdAt || Date.now()).toLocaleDateString('zh-CN');
        const statusLabel = { idle: '草稿', analyzing: '分析中', editing: '编辑中', generating: '生成中', completed: '已完成' }[p.status] || '草稿';
        return `<div class="card cursor-pointer" data-open-file="${escapeHtml(p.projectFileName || '')}">
            <div class="flex items-center justify-between mb-2">
                <h3 class="font-semibold text-sm truncate flex-1">${escapeHtml(p.title)}${p.localMode ? ' <span style="color:#6ee7b7;font-size:10px;font-weight:600">📍本地</span>' : ''}</h3>
                <span class="status-badge status-${p.status || 'idle'}">${statusLabel}</span>
            </div>
            <p class="text-xs mb-3" style="color:var(--text-muted)">${date} · ${p.shortCount || 0} 个短片${p.episodeCount > 1 ? ` · ${p.episodeCount} 集` : ''}${p.totalDuration ? ` · ${p.totalDuration}分钟` : ''}</p>
            <div class="flex gap-2"><button class="btn-secondary text-xs" data-clone-file="${escapeHtml(p.projectFileName || '')}">克隆</button><button class="btn-secondary text-xs" data-del-file="${escapeHtml(p.projectFileName || '')}">删除</button></div>
        </div>`;
    }).join('');

    grid.addEventListener('click', async (e) => {
        const cloneBtn = e.target.closest('[data-clone-file]');
        if (cloneBtn) {
            e.stopPropagation();
            const projectFileName = cloneBtn.dataset.cloneFile;
            const srcProj = await loadProject(projectFileName);
            if (!srcProj) { showToast('项目加载失败', 'error'); return; }
            const cloned = createProject(srcProj.title + ' (副本)');
            cloned.script = srcProj.script || '';
            cloned.synopsis = srcProj.synopsis || '';
            cloned.totalDuration = srcProj.totalDuration;
            cloned.settings = { ...srcProj.settings };
            cloned.characters = (srcProj.characters || []).map(c => ({ ...c }));
            cloned.props = (srcProj.props || []).map(p => ({ ...p }));
            cloned.scenes = (srcProj.scenes || []).map(s => ({ ...s }));
            cloned.folders = (srcProj.folders || []).map(f => ({ ...f }));
            cloned.shorts = (srcProj.shorts || []).map((s, i) => ({
                ...s,
                taskId: null, status: 'pending', videoUrl: null, videoPath: null,
                sourceVideoUrl: null, referenceVideoUrl: null, firstFrameUrl: null, lastFrameUrl: null, audioUrls: [], modelOverride: null, generateAudioOverride: null, watermark: false, error: null, order: i + 1,
            }));
            await saveProject(cloned);
            showToast('项目已克隆', 'success');
            renderProjectList();
            return;
        }
        const delBtn = e.target.closest('[data-del-file]');
        if (delBtn) {
            e.stopPropagation();
            if (!confirm('确定删除此项目？')) return;
            const projectFileName = delBtn.dataset.delFile;
            state.projects = state.projects.filter(p => p.projectFileName !== projectFileName);
            await deleteProjectRemote(projectFileName);
            await saveProjectList();
            renderProjectList();
            showToast('项目已删除', 'info');
            return;
        }
        const card = e.target.closest('[data-open-file]');
        if (card) {
            const proj = await loadProject(card.dataset.openFile);
            if (!proj) { showToast('项目加载失败', 'error'); return; }
            state.currentProject = proj;
            clearUndoRedo();
            resetTreeExpanded();
            loadStatsFromProject(proj);
            // Re-attach local directory if project is in local mode
            if (proj.localMode) {
                try {
                    const hint = proj.localDirName ? `\n上次使用的文件夹: ${proj.localDirName}` : '';
                    const doAttach = confirm(`此项目处于本地模式。${hint}\n\n请选择本地存储目录以加载离线资源。\n点击"取消"可继续使用 CDN 资源。`);
                    if (doAttach) {
                        await reattachLocalDir(proj, (done, total, msg) => {
                            if (total > 0 && done % 10 === 0) showToast(`加载本地资源: ${done}/${total}`, 'info');
                        });
                        showToast('本地资源已加载', 'success');
                    }
                } catch (e) {
                    console.warn('[AIMM] Reattach local dir failed:', e.message);
                }
            }
            // Recover running tasks from task log that may not be in shorts
            const taskLog = await loadTaskLog(proj);
            const runningLogEntries = taskLog.filter(e => e.status === 'running' && e.taskId);
            for (const entry of runningLogEntries) {
                const short = proj.shorts.find(s => s.id === entry.shortId);
                if (short && !short.taskId && short.status !== 'succeeded') {
                    short.taskId = entry.taskId;
                    short.status = 'running';
                }
            }
            const runningShorts = proj.shorts?.filter(s => (s.status === 'running' || s.status === 'pending') && s.taskId) || [];
            if (runningShorts.length > 0) {
                const resume = confirm(`该项目有 ${runningShorts.length} 个短片正在生成中。\n\n点击"确定"继续跟踪生成进度，点击"取消"停止所有生成任务。`);
                if (resume) {
                    proj.status = 'generating';
                    // Rebuild the generation queue so the progress bar renders correctly
                    state.generationQueue = runningShorts.map(s => s.id);
                    await saveProject(proj);
                    runningShorts.filter(s => s.taskId).forEach(s => startPolling(s.taskId, proj.id, onGenerationUpdate));
                } else {
                    runningShorts.forEach(s => {
                        s.status = 'failed';
                        s.error = '页面重载后已手动停止';
                        s.taskId = null;
                    });
                    if (proj.status === 'generating') proj.status = 'editing';
                    await saveProject(proj);
                    showToast('已停止所有生成任务', 'info');
                }
            }
            if (proj.status === 'generating') navigateTo('breakdown');
            else if (proj.status === 'completed') navigateTo('preview');
            else navigateTo('breakdown');
        }
    });

    // Load templates
    loadMovieTemplates();
}

async function loadMovieTemplates() {
    const tplGrid = $('templateGrid');
    if (!tplGrid) return;
    try {
        const basePath = import.meta.url ? new URL('../movie_templates/', import.meta.url).href : 'movie_templates/';
        const indexResp = await fetch(basePath + 'index.json');
        if (!indexResp.ok) throw new Error('Failed to load template index');
        const fileList = await indexResp.json();
        const templates = await Promise.all(fileList.map(async f => {
            const r = await fetch(basePath + f);
            return r.ok ? r.json() : null;
        }));
        const valid = templates.filter(Boolean);
        if (!valid.length) {
            tplGrid.innerHTML = `<p class="text-xs col-span-full" style="color:var(--text-muted)">暂无模板</p>`;
            return;
        }
        tplGrid.innerHTML = valid.map(tpl => `
            <div class="card cursor-pointer" data-tpl-id="${escapeHtml(tpl.id)}">
                <div class="flex gap-3 items-start mb-2">
                    ${tpl.thumbnail ? `<img src="${escapeHtml(tpl.thumbnail)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;background:var(--bg-pill)">` : ''}
                    <div class="flex-1 min-w-0">
                        <h3 class="font-semibold text-sm truncate">${escapeHtml(tpl.title)}</h3>
                        <p class="text-xs mt-1" style="color:var(--text-muted)">${escapeHtml(tpl.description || '')}</p>
                    </div>
                </div>
                <div class="flex flex-wrap gap-1 mt-2">
                    ${(tpl.shorts || []).map(s => `<span class="text-xs px-2 py-0.5 rounded-full" style="background:var(--bg-pill);color:var(--text-secondary)">${escapeHtml(s.prompt)}</span>`).join('')}
                </div>
                <div class="mt-3"><button class="btn-secondary text-xs" data-use-tpl="${escapeHtml(tpl.id)}">使用模板</button></div>
            </div>
        `).join('');
        // Cache templates for click handler
        tplGrid._templates = valid;
        tplGrid.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-use-tpl]');
            const card = btn || e.target.closest('[data-tpl-id]');
            if (!card) return;
            const tplId = card.dataset.useTpl || card.dataset.tplId;
            const tpl = tplGrid._templates.find(t => t.id === tplId);
            if (!tpl) return;
            if (!state.token) { showToast('请先登录', 'error'); return; }
            const proj = createProject(tpl.title);
            if (tpl.settings) proj.settings = { ...proj.settings, ...tpl.settings };
            proj.characters = (tpl.characters || []).map(c => ({ id: crypto.randomUUID(), name: c.name, description: c.description || '' }));
            proj.props = (tpl.props || []).map(p => ({ id: crypto.randomUUID(), name: p.name, description: p.description || '' }));
            proj.scenes = (tpl.scenes || []).map(s => ({ id: crypto.randomUUID(), name: s.name, description: s.description || '' }));
            proj.shorts = (tpl.shorts || []).map((s, i) => {
                const scene = proj.scenes.find(sc => sc.name === s.sceneName);
                const charIds = (s.characterNames || []).map(cn => {
                    const ch = proj.characters.find(c => c.name === cn);
                    return ch?.id;
                }).filter(Boolean);
                return {
                    id: crypto.randomUUID(),
                    order: s.order || (i + 1),
                    folderId: null,
                    prompt: s.prompt || '',
                    duration: s.duration || proj.settings.defaultDuration,
                    ratio: proj.settings.ratio,
                    sceneId: scene?.id || null,
                    characterIds: charIds,
                    imageUrls: s.imageUrls || [],
                    imagePaths: [],
                    taskId: null,
                    status: 'pending',
                    videoUrl: null,
                    videoPath: null,
                    sourceVideoUrl: null,
                    referenceVideoUrl: null,
                    firstFrameUrl: null,
                    lastFrameUrl: null,
                    audioUrls: [],
                    modelOverride: null,
                    generateAudioOverride: null,
                    watermark: false,
                    error: null,
                };
            });
            state.currentProject = proj;
            clearUndoRedo();
            resetTreeExpanded();
            loadStatsFromProject(proj);
            await saveProject(proj);
            navigateTo('breakdown');
        });
    } catch (err) {
        console.warn('Failed to load movie templates:', err);
        tplGrid.innerHTML = `<p class="text-xs col-span-full" style="color:var(--text-muted)">模板加载失败</p>`;
    }
}

// ============ Settings ============
function collectSettingsInline() {
    const proj = state.currentProject;
    if ($('topbarProjectTitleInput')) proj.title = $('topbarProjectTitleInput').value.trim() || '未命名项目';
    if ($('projTitleInline')) proj.title = $('projTitleInline').value.trim() || '未命名项目';
    if ($('scriptInputInline')) proj.script = $('scriptInputInline').value;
    if ($('settingTotalDurationInline')) proj.totalDuration = parseInt($('settingTotalDurationInline').value) || CONFIG.DEFAULT_TOTAL_DURATION;
    if ($('settingEpisodeCountInline')) proj.episodeCount = Math.max(1, parseInt($('settingEpisodeCountInline').value) || 1);
    if ($('settingResolutionInline')) proj.settings.resolution = $('settingResolutionInline').value;
    if ($('settingRatioInline')) proj.settings.ratio = $('settingRatioInline').value;
    if ($('settingDurationInline')) proj.settings.defaultDuration = parseInt($('settingDurationInline').value);
    if ($('settingModelInline')) proj.settings.model = $('settingModelInline').value;
    if ($('settingStylePresetInline')) proj.settings.stylePreset = $('settingStylePresetInline').value;
    if ($('settingCustomStyleInline')) proj.settings.customStyleSuffix = $('settingCustomStyleInline').value;
    if ($('settingEnvPresetInline')) proj.settings.envPreset = $('settingEnvPresetInline').value;
    if ($('settingCustomEnvInline')) proj.settings.customEnvSuffix = $('settingCustomEnvInline').value;
    if ($('settingRacePresetInline')) proj.settings.racePreset = $('settingRacePresetInline').value;
    if ($('settingCustomRaceInline')) proj.settings.customRaceSuffix = $('settingCustomRaceInline').value;
    if ($('audioToggleInline')) proj.settings.generateAudio = $('audioToggleInline').checked;
    if ($('settingNarrationLanguageInline')) proj.settings.narrationLanguage = $('settingNarrationLanguageInline').value;
    if ($('settingPromptPresetInline')) proj.settings.promptPreset = $('settingPromptPresetInline').value;
    if ($('settingIncludeNarrationInline')) proj.settings.includeNarration = $('settingIncludeNarrationInline').checked;
    if ($('settingIncludeDialogueInline')) proj.settings.includeDialogue = $('settingIncludeDialogueInline').checked;
}

async function onShowRollbackModal() {
    const proj = state.currentProject;
    if (!proj) return;
    const modal = $('editModal');
    $('editModalTitle').textContent = '⏪ 回滚到备份版本';
    $('editModalBody').innerHTML = `<div class="flex items-center justify-center py-8" style="color:var(--text-muted)"><div class="spinner mr-3"></div>加载备份列表...</div>`;
    modal.classList.remove('hidden');
    $('editModalClose').onclick = () => modal.classList.add('hidden');

    const backups = await listBackups(proj);
    if (!backups.length) {
        $('editModalBody').innerHTML = `<p class="text-sm" style="color:var(--text-muted)">暂无备份。点击顶部"💾 备份"按钮创建备份。</p><div class="flex gap-2 mt-4"><button class="btn-secondary" id="rollbackCloseBtn">关闭</button></div>`;
        $('rollbackCloseBtn').onclick = () => modal.classList.add('hidden');
        return;
    }

    const listHTML = backups.map((f, i) => {
        const name = f.split('/').pop().replace(/\.md$/i, '');
        const match = name.match(/_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
        const timeLabel = match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}` : name;
        return `<div class="flex items-center justify-between py-2 px-3 rounded-lg" style="background:var(--bg-pill);margin-bottom:6px">
            <span class="text-xs" style="color:var(--text-primary)">${escapeHtml(timeLabel)}</span>
            <button class="btn-secondary text-xs rollback-item-btn" data-idx="${i}" style="padding:4px 10px">回滚</button>
        </div>`;
    }).join('');

    $('editModalBody').innerHTML = `
        <p class="text-xs mb-3" style="color:var(--text-muted)">选择一个备份版本回滚。回滚前会自动备份当前版本。</p>
        <div style="max-height:400px;overflow-y:auto">${listHTML}</div>
        <div class="flex gap-2 mt-4"><button class="btn-secondary" id="rollbackCloseBtn">关闭</button><button class="btn-danger" id="clearBackupsBtn">🗑 清空所有备份</button></div>`;

    $('rollbackCloseBtn').onclick = () => modal.classList.add('hidden');
    $('clearBackupsBtn').onclick = async () => {
        if (!confirm(`确认清空所有 ${backups.length} 个备份？此操作不可恢复。`)) return;
        $('clearBackupsBtn').disabled = true;
        $('clearBackupsBtn').textContent = '清空中...';
        const count = await clearBackups(proj);
        modal.classList.add('hidden');
        showToast(`已清空 ${count} 个备份`, 'success');
    };
    $('editModalBody').querySelectorAll('.rollback-item-btn').forEach(btn => {
        btn.onclick = async () => {
            const idx = parseInt(btn.dataset.idx);
            const backupFile = backups[idx];
            if (!confirm('确认回滚？当前项目将自动备份后替换为所选版本。')) return;
            btn.disabled = true;
            btn.textContent = '回滚中...';
            // Auto-backup current version first
            await backupProject(proj);
            const restored = await loadBackup(proj, backupFile);
            if (!restored) {
                showToast('回滚失败：无法读取备份文件', 'error');
                btn.disabled = false;
                btn.textContent = '回滚';
                return;
            }
            // Apply restored data to current project
            const normalized = normalizeProject(restored);
            Object.assign(proj, normalized);
            proj.updatedAt = Date.now();
            await saveProject(proj);
            modal.classList.add('hidden');
            showToast('已回滚到备份版本', 'success');
            renderBreakdown();
        };
    });
}

async function onAnalyzeScript() {
    collectSettingsInline();
    const proj = state.currentProject;
    if (!proj.script.trim()) { showToast('请输入剧本内容', 'error'); return; }
    if (!state.token) { showToast('请先登录', 'error'); return; }

    // Check if analysis will overwrite existing content
    const hasExisting = proj.characters.length > 0 || proj.scenes.length > 0 || proj.shorts.length > 0 || proj.props.length > 0;

    // Build the prompt and show it to user for review/editing
    const subtitleOptions = {
        includeNarration: !!proj.settings?.includeNarration,
        includeDialogue: !!proj.settings?.includeDialogue,
    };
    await ensurePresetLoaded(proj.settings?.promptPreset || getGlobalPromptPreset());
    const { systemPrompt } = getAnalyzeScriptPrompt(proj.script, proj.totalDuration, proj.settings.narrationLanguage, proj.episodeCount || 1, proj.settings?.promptPreset, subtitleOptions);

    const modal = $('editModal');
    $('editModalTitle').textContent = '📝 AI 分析剧本 — 查看/编辑提示词';
    $('editModalBody').innerHTML = `
        <div class="space-y-3">
            <div>
                <label class="text-xs" style="color:var(--text-muted)">AI 提示词 (可修改以自定义分析效果)</label>
                <textarea id="analyzePromptInput" class="modal-input mt-1" style="min-height:200px;font-size:12px;line-height:1.5">${escapeHtml(systemPrompt)}</textarea>
            </div>
            ${hasExisting ? '<p class="text-xs" style="color:#fca5a5">⚠️ AI分析将覆盖当前分镜数据（角色、场景、镜头等），系统将自动备份当前版本。</p>' : ''}
            <div id="analyzeStreamPreview" class="card-flat hidden" style="max-height:200px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace"></div>
            <div class="flex gap-2">
                <button class="btn-primary" id="doAnalyzeBtn">🔍 开始分析</button>
                <button class="btn-secondary" id="cancelAnalyzeBtn">取消</button>
            </div>
        </div>`;
    modal.classList.remove('hidden');

    $('cancelAnalyzeBtn').onclick = () => modal.classList.add('hidden');
    $('doAnalyzeBtn').onclick = async () => {
        if (hasExisting) {
            const backupName = await backupProject(proj);
            if (backupName) {
                showToast(`已自动备份: ${backupName.split('/').pop()}`, 'info');
            }
        }

        const customPrompt = $('analyzePromptInput').value.trim();
        proj.status = 'analyzing';

        const btn2 = $('doAnalyzeBtn');
        btn2.disabled = true;
        btn2.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.3);border-top-color:white"></div> 分析中...';

        const analyzeBtn = $('analyzeBtn');
        if (analyzeBtn) {
            analyzeBtn.disabled = true;
            analyzeBtn.innerHTML = '<div class="spinner" style="width:12px;height:12px;border-width:2px;border-color:rgba(255,255,255,0.3);border-top-color:white"></div> 分析中...';
        }

        const streamPreview = $('analyzeStreamPreview');
        streamPreview.classList.remove('hidden');
        streamPreview.textContent = '正在分析剧本...';

        try {
            const breakdown = await analyzeScript(proj.script, proj.totalDuration, (text) => {
                streamPreview.textContent = text;
                streamPreview.scrollTop = streamPreview.scrollHeight;
            }, proj.settings.narrationLanguage, proj.episodeCount || 1, customPrompt !== systemPrompt ? customPrompt : undefined, proj.settings?.promptPreset, subtitleOptions);
            linkBreakdown(proj, breakdown);
            if (breakdown.synopsis) proj.synopsis = breakdown.synopsis;
            await saveProject(proj);
            modal.classList.add('hidden');
            showToast(`分析完成：${proj.characters.length} 个角色，${proj.props.length} 个道具，${proj.scenes.length} 个场景，${proj.shorts.length} 个短片${(proj.episodeCount || 1) > 1 ? `，${proj.episodeCount} 集` : ''}`, 'success');
            renderBreakdown();
        } catch (err) {
            proj.status = 'idle';
            showToast(`分析失败: ${err.message}`, 'error');
            streamPreview.classList.remove('hidden');
            streamPreview.style.maxHeight = '300px';
            streamPreview.textContent = `❌ 分析失败: ${err.message}\n\n--- LLM 原始返回 ---\n${streamPreview.textContent}`;
            streamPreview.scrollTop = 0;
            btn2.disabled = false;
            btn2.innerHTML = '🔍 开始分析';
        }
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> AI 分析剧本';
        }
    };
}

// ============ Breakdown View (Tree + Detail) ============

// ---- Pipeline: Enhance Characters ----
async function onEnhanceCharacters() {
    const proj = state.currentProject;
    if (!proj.characters.length) { showToast('没有角色可增强', 'error'); return; }
    if (!state.token) { showToast('请先登录', 'error'); return; }

    await ensurePresetLoaded(proj.settings?.promptPreset || getGlobalPromptPreset());
    const defaultPrompt = getEnhanceCharactersPrompt(proj);
    const modal = $('editModal');
    $('editModalTitle').textContent = '🎭 增强角色 — 丰富视觉描述';
    $('editModalBody').innerHTML = `
        <div class="space-y-3">
            <p class="text-xs" style="color:var(--text-muted)">AI 将为每个角色添加详细的外观描述（服装、体型、配饰、色彩等），提升视频生成一致性。</p>
            <div>
                <label class="text-xs" style="color:var(--text-muted)">AI 提示词 (可修改以自定义增强效果)</label>
                <textarea id="enhanceCharsPromptInput" class="modal-input mt-1" style="min-height:180px;font-size:12px;line-height:1.5">${escapeHtml(defaultPrompt)}</textarea>
            </div>
            <div id="enhanceCharStreamPreview" class="card-flat hidden" style="max-height:200px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace"></div>
            <div class="flex gap-2">
                <button class="btn-primary" id="doEnhanceCharsBtn">🎭 开始增强</button>
                <button class="btn-secondary" id="cancelEnhanceCharsBtn">取消</button>
            </div>
        </div>`;
    modal.classList.remove('hidden');

    $('cancelEnhanceCharsBtn').onclick = () => modal.classList.add('hidden');
    $('doEnhanceCharsBtn').onclick = async () => {
        const customPrompt = $('enhanceCharsPromptInput').value.trim();
        const btn = $('doEnhanceCharsBtn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.3);border-top-color:white"></div> 增强中...';
        const preview = $('enhanceCharStreamPreview');
        preview.classList.remove('hidden');
        preview.textContent = `正在分析 ${proj.characters.length} 个角色的视觉特征（每10个一批）...`;

        try {
            const result = await enhanceCharacters(proj, (text) => {
                preview.textContent = text;
                preview.scrollTop = preview.scrollHeight;
            }, customPrompt !== defaultPrompt ? customPrompt : undefined);

            if (result.characters) {
                let updated = 0;
                result.characters.forEach(enhanced => {
                    const ch = proj.characters.find(c => c.name === enhanced.name);
                    if (!ch) return;
                    if (enhanced.description) { ch.description = enhanced.description; updated++; }
                });
                await saveProject(proj);
                modal.classList.add('hidden');
                showToast(`已增强 ${updated} 个角色描述`, 'success');
                renderBreakdown();
            } else {
                showToast('增强结果格式异常', 'error');
                btn.disabled = false;
                btn.innerHTML = '🎭 开始增强';
            }
        } catch (err) {
            showToast(`增强失败: ${err.message}`, 'error');
            btn.disabled = false;
            btn.innerHTML = '🎭 开始增强';
        }
    };
}

// ---- Pipeline: Enhance Scenes ----
async function onEnhanceScenes() {
    const proj = state.currentProject;
    if (!proj.scenes.length) { showToast('没有场景可增强', 'error'); return; }
    if (!state.token) { showToast('请先登录', 'error'); return; }

    await ensurePresetLoaded(proj.settings?.promptPreset || getGlobalPromptPreset());
    const defaultPrompt = getEnhanceScenesPrompt(proj);
    const modal = $('editModal');
    $('editModalTitle').textContent = '🏔️ 增强场景 — 丰富环境描述';
    $('editModalBody').innerHTML = `
        <div class="space-y-3">
            <p class="text-xs" style="color:var(--text-muted)">AI 将为每个场景添加详细的环境描述（光照、天气、建筑细节、氛围等），提升视频生成一致性。</p>
            <div>
                <label class="text-xs" style="color:var(--text-muted)">AI 提示词 (可修改以自定义增强效果)</label>
                <textarea id="enhanceScenesPromptInput" class="modal-input mt-1" style="min-height:180px;font-size:12px;line-height:1.5">${escapeHtml(defaultPrompt)}</textarea>
            </div>
            <div id="enhanceSceneStreamPreview" class="card-flat hidden" style="max-height:200px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace"></div>
            <div class="flex gap-2">
                <button class="btn-primary" id="doEnhanceScenesBtn">🏔️ 开始增强</button>
                <button class="btn-secondary" id="cancelEnhanceScenesBtn">取消</button>
            </div>
        </div>`;
    modal.classList.remove('hidden');

    $('cancelEnhanceScenesBtn').onclick = () => modal.classList.add('hidden');
    $('doEnhanceScenesBtn').onclick = async () => {
        const customPrompt = $('enhanceScenesPromptInput').value.trim();
        const btn = $('doEnhanceScenesBtn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.3);border-top-color:white"></div> 增强中...';
        const preview = $('enhanceSceneStreamPreview');
        preview.classList.remove('hidden');
        preview.textContent = `正在分析 ${proj.scenes.length} 个场景的视觉环境（每10个一批）...`;

        try {
            const result = await enhanceScenes(proj, (text) => {
                preview.textContent = text;
                preview.scrollTop = preview.scrollHeight;
            }, customPrompt !== defaultPrompt ? customPrompt : undefined);

            if (result.scenes) {
                let updated = 0;
                result.scenes.forEach(enhanced => {
                    const sc = proj.scenes.find(s => s.name === enhanced.name);
                    if (!sc) return;
                    if (enhanced.description) { sc.description = enhanced.description; updated++; }
                });
                await saveProject(proj);
                modal.classList.add('hidden');
                showToast(`已增强 ${updated} 个场景描述`, 'success');
                renderBreakdown();
            } else {
                showToast('增强结果格式异常', 'error');
                btn.disabled = false;
                btn.innerHTML = '🏔️ 开始增强';
            }
        } catch (err) {
            showToast(`增强失败: ${err.message}`, 'error');
            btn.disabled = false;
            btn.innerHTML = '🏔️ 开始增强';
        }
    };
}

// ---- Pipeline: Enhance Shots ----
async function onEnhanceShots() {
    const proj = state.currentProject;
    if (!proj.shorts.length) { showToast('没有分镜可增强', 'error'); return; }
    if (!state.token) { showToast('请先登录', 'error'); return; }

    await ensurePresetLoaded(proj.settings?.promptPreset || getGlobalPromptPreset());
    const defaultPrompt = getEnhanceShotsPrompt(proj);
    const modal = $('editModal');
    $('editModalTitle').textContent = '🎬 增强分镜 — 添加镜头语言';
    $('editModalBody').innerHTML = `
        <div class="space-y-3">
            <p class="text-xs" style="color:var(--text-muted)">AI 将为每个短片添加运镜、灯光、情绪、稳定变量等专业电影参数。</p>
            <div>
                <label class="text-xs" style="color:var(--text-muted)">AI 提示词 (可修改以自定义增强效果)</label>
                <textarea id="enhanceShotsPromptInput" class="modal-input mt-1" style="min-height:180px;font-size:12px;line-height:1.5">${escapeHtml(defaultPrompt)}</textarea>
            </div>
            <div id="enhanceStreamPreview" class="card-flat hidden" style="max-height:200px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace"></div>
            <div class="flex gap-2">
                <button class="btn-primary" id="doEnhanceBtn">🎬 开始增强</button>
                <button class="btn-secondary" id="cancelEnhanceBtn">取消</button>
            </div>
        </div>`;
    modal.classList.remove('hidden');

    $('cancelEnhanceBtn').onclick = () => modal.classList.add('hidden');
    $('doEnhanceBtn').onclick = async () => {
        const customPrompt = $('enhanceShotsPromptInput').value.trim();
        const btn = $('doEnhanceBtn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.3);border-top-color:white"></div> 增强中...';
        const preview = $('enhanceStreamPreview');
        preview.classList.remove('hidden');
        preview.textContent = `正在分析 ${proj.shorts.length} 个镜头的情绪和运镜（每10个一批）...`;

        try {
            const result = await enhanceShots(proj, (text) => {
                preview.textContent = text;
                preview.scrollTop = preview.scrollHeight;
            }, customPrompt !== defaultPrompt ? customPrompt : undefined);

            if (result.shorts) {
                result.shorts.forEach(enhanced => {
                    const sh = proj.shorts.find(s => s.order === enhanced.order);
                    if (!sh) return;
                    if (enhanced.shotType) sh.shotType = enhanced.shotType;
                    if (enhanced.cameraMovement) sh.cameraMovement = enhanced.cameraMovement;
                    if (enhanced.cameraAngle) sh.cameraAngle = enhanced.cameraAngle;
                    if (enhanced.lighting) sh.lighting = enhanced.lighting;
                    if (enhanced.emotion) sh.emotion = enhanced.emotion;
                    if (enhanced.stableVariables) sh.stableVariables = enhanced.stableVariables;
                    if (enhanced.prompt) sh.prompt = enhanced.prompt;
                    sh.enhanced = true;
                });
                proj.pipelineStage = 'enhanced';
                await saveProject(proj);
                modal.classList.add('hidden');
                showToast(`已增强 ${result.shorts.length} 个分镜`, 'success');
                renderBreakdown();
            } else {
                showToast('增强结果格式异常', 'error');
                btn.disabled = false;
                btn.innerHTML = '🎬 开始增强';
            }
        } catch (err) {
            showToast(`增强失败: ${err.message}`, 'error');
            btn.disabled = false;
            btn.innerHTML = '🎬 开始增强';
        }
    };
}

// ---- Pipeline: Preflight ----
function onShowPreflight() {
    const proj = state.currentProject;
    const result = runPreflight(proj);

    const modal = $('editModal');
    $('editModalTitle').textContent = result.passed ? '✅ 预检通过' : '⚠️ 预检发现问题';
    const issuesHTML = result.issues.length === 0
        ? '<p class="text-sm" style="color:#6ee7b7">所有检查通过，可以开始生成。</p>'
        : result.issues.map(i => `
            <div class="preflight-issue ${i.severity.toLowerCase()}">
                <span class="preflight-badge ${i.severity.toLowerCase()}">${i.severity}</span>
                <div class="flex-1">
                    <div class="font-semibold text-xs">${escapeHtml(i.target)}</div>
                    <div class="text-xs" style="color:var(--text-secondary)">${escapeHtml(i.message)}</div>
                    <div class="text-xs mt-1" style="color:var(--text-faint)">💡 ${escapeHtml(i.fix)}</div>
                </div>
            </div>`).join('');

    $('editModalBody').innerHTML = `
        <div class="mb-3">
            <span class="text-xs" style="color:var(--text-muted)">P0: ${result.p0Count} · P1: ${result.p1Count} · P2: ${result.p2Count}</span>
        </div>
        <div style="max-height:400px;overflow-y:auto">${issuesHTML}</div>
        <div class="flex gap-2 mt-4">
            ${result.passed ? '<button class="btn-primary" id="preflightProceedBtn">开始生成视频</button>' : '<button class="btn-secondary" id="preflightProceedBtn" title="有P0问题，建议先修复">⚠️ 强制生成</button>'}
            <button class="btn-secondary" id="preflightCloseBtn">返回修改</button>
        </div>`;
    modal.classList.remove('hidden');

    $('preflightCloseBtn').onclick = () => modal.classList.add('hidden');
    $('preflightProceedBtn').onclick = () => {
        if (!result.passed && !confirm('存在 P0 级问题（缺少角色参考图等），可能导致生成质量低。确定继续？')) return;
        modal.classList.add('hidden');
        if (result.passed) proj.pipelineStage = 'preflight_passed';
        saveProject(proj);
        onStartGeneration();
    };
}

function onStartGenerationWithPreflight() {
    const proj = state.currentProject;
    if (!proj.shorts.length) { showToast('没有短片可生成', 'error'); return; }
    onShowPreflight();
}

export function renderBreakdown() {
    const proj = state.currentProject;
    const container = $('viewContainer');
    const hasContent = proj.shorts.length > 0 || proj.characters.length > 0 || proj.props.length > 0 || proj.scenes.length > 0;
    const sidebarWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, state.sidebarWidth || 280));
    state.sidebarWidth = sidebarWidth;
    setViewContainerPadding('compact');

    const missingCharImgs = proj.characters.filter(c => !c.imageUrl && c.description).length;
    const missingPropImgs = proj.props.filter(p => !p.imageUrl && p.description).length;
    const missingSceneImgs = proj.scenes.filter(s => !s.imageUrl && s.description).length;
    const totalMissingImgs = missingCharImgs + missingPropImgs + missingSceneImgs;
    const hasMissingImages = totalMissingImgs > 0;

    container.innerHTML = `
        <div class="flex flex-col h-full">
            ${hasContent ? `
            <div class="flex items-center justify-between mb-2 px-1 breakdown-toolbar">
                <div id="genProgressBar" class="flex-1 min-w-0" style="position:relative">
                    ${(() => {
                        const queue = state.generationQueue;
                        const queuedShorts = queue.map(id => proj.shorts.find(s => s.id === id)).filter(Boolean);
                        const isGen = queuedShorts.some(s => s.status === 'running' || s.status === 'pending');
                        if (!isGen || queue.length === 0) return '';
                        const done = queuedShorts.filter(s => s.status === 'succeeded' || s.status === 'failed').length;
                        const total = queuedShorts.length;
                        const pct = total ? (done / total * 100) : 0;
                        return `
                        <div class="flex items-center gap-3" id="genProgressBarInner" style="cursor:pointer" title="点击查看/编辑生成队列">
                            <span class="spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0"></span>
                            <span class="text-sm font-semibold" style="color:var(--accent-light);white-space:nowrap">处理中 ${done}/${total}...</span>
                            <div class="flex-1 h-2 rounded-full" style="background:var(--bg-pill);min-width:80px">
                                <div class="h-2 rounded-full transition-all" style="width:${pct}%;background:linear-gradient(90deg,#6366f1,#818cf8)"></div>
                            </div>
                        </div>
                        <div id="genQueueDropdown" class="gen-queue-dropdown" style="display:none"></div>`;
                    })()}
                </div>
                <div class="flex gap-2 flex-shrink-0">
                    <button class="btn-secondary" id="reAnalyzeBtn">重新分析</button>
                    ${proj.pipelineStage === 'parsed' ? `<button class="btn-secondary" id="enhanceCharsBtn" style="border-color:var(--accent);color:var(--accent-light)">🎭 增强角色</button><button class="btn-secondary" id="enhanceScenesBtn" style="border-color:var(--accent);color:var(--accent-light)">🏔️ 增强场景</button><button class="btn-secondary" id="enhanceShotsBtn" style="border-color:var(--accent);color:var(--accent-light)">🎬 增强分镜</button>` : ''}
                    <button class="btn-secondary" id="preflightBtn">✅ 预检</button>
                    ${(() => {
                        const isGenerating = state.generationQueue.length > 0 && proj.shorts.some(s => s.status === 'running' || s.status === 'pending');
                        if (isGenerating) {
                            return `<button class="btn-danger" id="stopGenBtn">⏹ 停止生成</button>`;
                        }
                        if (hasMissingImages) {
                            return `<button class="btn-primary" id="genAllMissingBtn">🎨 生成缺失图片 (${totalMissingImgs})</button>`;
                        }
                        return `<button class="btn-primary" id="startGenBtn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            开始生成视频
                        </button>`;
                    })()}
                </div>
            </div>` : ''}
            <div class="flex flex-1 gap-3 overflow-hidden breakdown-main-split" style="min-height:0">
                <div id="breakdownSidebar" class="sidebar-tree flex flex-col" style="width:${sidebarWidth}px;min-width:${MIN_SIDEBAR_WIDTH}px;max-width:${MAX_SIDEBAR_WIDTH}px;border-right:1px solid var(--border);padding-right:8px;flex:0 0 auto;overflow:hidden">
                    <!-- Tree -->
                    <div id="treeContainer" class="flex-1" style="overflow-y:auto"></div>
                </div>
                <div id="treeResizeHandle" title="拖动调整左侧宽度" style="width:10px;cursor:col-resize;flex:0 0 10px;position:relative;align-self:stretch;margin-left:-10px;margin-right:-4px;z-index:2">
                    <div style="position:absolute;left:4px;top:0;bottom:0;width:2px;background:var(--border);border-radius:999px"></div>
                </div>
                <div id="detailPanelWrap" class="flex-1 flex flex-col overflow-hidden pl-2" style="min-width:0">
                    <button id="mobileTreeBackBtn" class="mobile-tree-back btn-secondary text-xs mb-2" style="align-items:center;gap:4px;flex-shrink:0" onclick="document.body.classList.remove('mobile-detail-open')">← 返回列表</button>
                    <div id="detailPanel" class="flex-1 overflow-y-auto" style="min-width:0">
                        <div class="flex items-center justify-center h-full" style="color:var(--text-faint)">
                            <p>${hasContent ? '← 点击左侧节点查看详情' : '输入剧本后点击 "AI 分析剧本" 生成结构'}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;

    if ($('reAnalyzeBtn')) $('reAnalyzeBtn').onclick = () => onAnalyzeScript();
    if ($('startGenBtn')) $('startGenBtn').onclick = () => onStartGenerationWithPreflight();
    if ($('genAllMissingBtn')) $('genAllMissingBtn').onclick = () => generateAllMissingImages(proj);
    if ($('stopGenBtn')) $('stopGenBtn').onclick = async () => {
        Object.keys(state.pollingIntervals).forEach(id => stopPolling(id));
        // Only stop queued shots, not others
        const queueSet = new Set(state.generationQueue);
        proj.shorts.forEach(s => {
            if (queueSet.has(s.id) && (s.status === 'running' || s.status === 'pending')) {
                s.taskId = null;
                // Restore latest candidate video if available
                const lastCandidate = (s.videoCandidates || []).at(-1);
                if (lastCandidate) {
                    s.videoUrl = lastCandidate.url;
                    s.videoPath = lastCandidate.path || null;
                    s.sourceVideoUrl = lastCandidate.sourceUrl || lastCandidate.url;
                    s.status = 'succeeded';
                    s.error = null;
                } else {
                    s.status = 'failed';
                    s.error = '已手动停止';
                }
            }
        });
        state.generationQueue = [];
        if (!proj.shorts.some(s => s.status === 'running' || s.status === 'pending')) {
            proj.status = 'editing';
        }
        await saveProject(proj);
        showToast('已停止生成任务', 'info');
        renderBreakdown();
    };
    // Queue dropdown toggle
    if ($('genProgressBarInner')) {
        $('genProgressBarInner').onclick = () => {
            const dd = $('genQueueDropdown');
            if (!dd) return;
            if (dd.style.display === 'none') {
                renderQueueDropdown();
                dd.style.display = 'block';
            } else {
                dd.style.display = 'none';
            }
        };
    }
    if ($('enhanceCharsBtn')) $('enhanceCharsBtn').onclick = () => onEnhanceCharacters();
    if ($('enhanceScenesBtn')) $('enhanceScenesBtn').onclick = () => onEnhanceScenes();
    if ($('enhanceShotsBtn')) $('enhanceShotsBtn').onclick = () => onEnhanceShots();
    if ($('preflightBtn')) $('preflightBtn').onclick = () => onShowPreflight();

    renderTreePanel();
    attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
    setupSidebarResize();

    // Auto-select script-section by default when no node is selected
    if (!state.selectedNodeId) {
        state.selectedNodeId = 'script-section';
        state.selectedNodeType = 'script-section';
        document.querySelectorAll('#breakdownSidebar .tree-node').forEach(n => n.classList.remove('tree-node-selected'));
        $('scriptSectionToggle')?.classList.add('tree-node-selected');
    }
    if (state.selectedNodeId) {
        renderDetailPanel(state.selectedNodeId, state.selectedNodeType);
    }
}

function setupSidebarResize() {
    const sidebar = $('breakdownSidebar');
    const handle = $('treeResizeHandle');
    const container = $('viewContainer');

    if (!sidebar || !handle || !container) return;

    handle.onpointerdown = (event) => {
        event.preventDefault();
        const containerRect = container.getBoundingClientRect();

        handle.setPointerCapture(event.pointerId);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';

        const onPointerMove = (moveEvent) => {
            const nextWidth = moveEvent.clientX - containerRect.left - 24;
            const clamped = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, nextWidth));
            state.sidebarWidth = clamped;
            sidebar.style.width = `${clamped}px`;
        };

        const onPointerUp = () => {
            localStorage.setItem('aimm_sidebar_width', String(state.sidebarWidth));
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            handle.removeEventListener('pointermove', onPointerMove);
            handle.removeEventListener('pointerup', onPointerUp);
            handle.removeEventListener('pointercancel', onPointerUp);
        };

        handle.addEventListener('pointermove', onPointerMove);
        handle.addEventListener('pointerup', onPointerUp);
        handle.addEventListener('pointercancel', onPointerUp);
    };
}

function renderTreePanel() {
    const proj = state.currentProject;
    const nodes = buildTree(proj);
    $('treeContainer').innerHTML = renderTreeHTML(nodes);
}

/** Expand the parent group and folder for a given node so it becomes visible in the tree */
function expandParentsForNode(nodeId, nodeType) {
    const category = getCategoryFromType(nodeType);
    if (!category) return;
    const groupId = category + '-group';
    state.treeExpanded[groupId] = true;
    // If the item belongs to a folder, expand that folder too
    const proj = state.currentProject;
    if (proj) {
        const item = (proj[category] || []).find(x => x.id === nodeId);
        if (item && item.folderId) {
            state.treeExpanded[item.folderId] = true;
        }
    }
}

function onTreeSelect(nodeId, nodeType, isToggle) {
    if (isToggle) {
        renderTreePanel();
        attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
        return;
    }
    expandParentsForNode(nodeId, nodeType);
    renderTreePanel(); // re-render to update selection highlight
    attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
    if (nodeId) {
        renderDetailPanel(nodeId, nodeType);
        // On mobile, show detail panel full-screen
        if (isMobile()) document.body.classList.add('mobile-detail-open');
    }
}

function onTreeRegenerate(nodeId, nodeType) {
    const proj = state.currentProject;
    (async () => {
        await ensurePresetLoaded(proj.settings?.promptPreset || getGlobalPromptPreset());
        const prompt = getRegeneratePrompt(nodeType, proj, nodeId);
        showRegenModal(nodeId, nodeType, prompt);
    })().catch(err => {
        console.warn('[views] onTreeRegenerate failed:', err);
        showToast(`准备提示词失败: ${err.message || err}`, 'error');
    });
}

// ============ Context Menu & Folder Operations ============
function onTreeContextMenu(e, nodeId, nodeType, dropInfo) {
    if (nodeType === 'drop') {
        handleItemDrop(nodeId, dropInfo);
        return;
    }
    if (nodeType === 'hover-action') {
        handleHoverAction(dropInfo);
        return;
    }
    showTreeContextMenu(e, nodeId, nodeType);
}

// ============ Generalized item/folder helpers ============
const CATEGORY_LABELS = { characters: '角色', props: '道具', scenes: '场景', shorts: '分镜' };

function getItemList(proj, category) {
    return proj[category] || [];
}

function findItemInCategory(proj, category, id) {
    return (proj[category] || []).find(x => x.id === id);
}

function createNewItem(proj, category, folderId) {
    if (category === 'characters') {
        return { id: crypto.randomUUID(), name: '新角色', description: '', imageUrl: null, imagePath: null, anchorImageUrl: null, anchorVerified: false, designPrompt: null, visualTraits: null, folderId: folderId || null, imageCandidates: [] };
    } else if (category === 'props') {
        return { id: crypto.randomUUID(), name: '新道具', description: '', imageUrl: null, imagePath: null, anchorImageUrl: null, anchorVerified: false, designPrompt: null, folderId: folderId || null, imageCandidates: [] };
    } else if (category === 'scenes') {
        return { id: crypto.randomUUID(), name: '新场景', description: '', imageUrl: null, imagePath: null, lighting: null, timeOfDay: null, weather: null, mood: null, folderId: folderId || null, imageCandidates: [] };
    } else if (category === 'shorts') {
        const order = proj.shorts.length + 1;
        return { id: crypto.randomUUID(), order, folderId: folderId || null, sceneId: null, characterIds: [], prompt: '', duration: proj.settings.defaultDuration, ratio: proj.settings.ratio, imageUrls: [], imagePaths: [], taskId: null, status: 'pending', videoUrl: null, videoPath: null, sourceVideoUrl: null, referenceVideoUrl: null, firstFrameUrl: null, lastFrameUrl: null, audioUrls: [], modelOverride: null, generateAudioOverride: null, watermark: false, error: null, shotType: null, cameraMovement: null, cameraAngle: null, lighting: null, emotion: null, stableVariables: null, enhanced: false, picturebook: false, picturebookUrl: null, picturebookPath: null, picturebookStatus: null, picturebookTaskId: null, picturebookError: null, videoCandidates: [] };
    }
}

// ============ Hover Action Handler ============
async function handleHoverAction({ action, category, folderId, actionId, actionType }) {
    const proj = state.currentProject;
    if (action === 'add-item') {
        const item = createNewItem(proj, category, folderId);
        proj[category].push(item);
        state.selectedNodeId = item.id;
        state.selectedNodeType = getItemType(category);
        await saveProject(proj);
        renderBreakdown();
    } else if (action === 'add-folder') {
        await createFolderForCategory(category);
    } else if (action === 'delete' && actionId) {
        if (isFolder(actionType)) {
            await deleteFolderGeneric(actionId, category);
        } else {
            deleteItem(actionId, category);
        }
    }
}

// ============ Drop Handler (generalized) ============
function handleItemDrop(draggedId, { targetId, targetType, draggedType, dropBefore }) {
    const proj = state.currentProject;
    const category = getCategoryFromType(draggedType || targetType);
    if (!category) return;
    const list = proj[category];
    const item = list.find(x => x.id === draggedId);
    if (!item) return;

    if (isFolder(targetType)) {
        // Drop into a folder
        item.folderId = targetId;
    } else if (targetType.endsWith('-group')) {
        // Drop on the group header — remove from folder
        item.folderId = null;
    } else {
        // Drop on a sibling item — reorder
        const targetItem = list.find(x => x.id === targetId);
        if (!targetItem) return;
        // Move into the same folder as the target
        item.folderId = targetItem.folderId || null;
        // Reorder within the list
        const dragIdx = list.indexOf(item);
        list.splice(dragIdx, 1);
        let targetIdx = list.indexOf(targetItem);
        if (!dropBefore) targetIdx += 1;
        list.splice(targetIdx, 0, item);
        // Re-number if shorts (they have an order field)
        if (category === 'shorts') {
            list.forEach((s, i) => s.order = i + 1);
        }
    }
    saveProject(proj);
    renderBreakdown();
}

// ============ Context Menu ============
function showTreeContextMenu(e, nodeId, nodeType) {
    document.getElementById('treeContextMenu')?.remove();

    const proj = state.currentProject;
    const items = [];
    const category = getCategoryFromType(nodeType);
    const catLabel = CATEGORY_LABELS[category] || '';
    const folderType = category ? `${getItemType(category)}-folder` : null;

    if (category && !isFolder(nodeType) && !nodeType.endsWith('-group')) {
        // It's a leaf item (character, prop, scene, short)
        items.push({ label: `📋 克隆${catLabel}`, action: () => cloneItem(nodeId, category) });
        const folders = getFolders(proj, category);
        const item = findItemInCategory(proj, category, nodeId);
        if (item?.folderId) {
            items.push({ label: '📤 移出文件夹', action: () => moveItemToFolder(nodeId, category, null) });
        }
        folders.forEach(f => {
            if (f.id !== item?.folderId) {
                items.push({ label: `📁 移到 ${f.name}`, action: () => moveItemToFolder(nodeId, category, f.id) });
            }
        });
        items.push({ label: '🗑️ 删除', action: () => deleteItem(nodeId, category), danger: true });
    } else if (isFolder(nodeType)) {
        items.push({ label: '✏️ 重命名文件夹', action: () => renameFolderGeneric(nodeId) });
        items.push({ label: '📋 克隆文件夹', action: () => cloneFolderGeneric(nodeId, category) });
        items.push({ label: '🗑️ 删除文件夹', action: () => deleteFolderGeneric(nodeId, category), danger: true });
    } else if (nodeType.endsWith('-group') && category) {
        items.push({ label: `📁 新建文件夹`, action: () => createFolderForCategory(category) });
        items.push({ label: `+ 添加${catLabel}`, action: () => addItemToCategory(category) });
    }

    if (items.length === 0) return;

    const menu = document.createElement('div');
    menu.id = 'treeContextMenu';
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:300;background:var(--bg-card);border:1px solid var(--border-card);border-radius:10px;padding:6px 0;min-width:180px;box-shadow:0 8px 30px rgba(0,0,0,0.3)`;
    menu.innerHTML = items.map(item =>
        `<div class="tree-context-item${item.danger ? ' tree-context-danger' : ''}" style="padding:7px 14px;font-size:13px;cursor:pointer;color:${item.danger ? '#fca5a5' : 'var(--text-secondary)'};transition:background 0.15s">${item.label}</div>`
    ).join('');

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;

    const menuItems = menu.querySelectorAll('.tree-context-item');
    menuItems.forEach((el, i) => {
        el.onmouseenter = () => el.style.background = 'var(--bg-pill)';
        el.onmouseleave = () => el.style.background = 'transparent';
        el.onclick = () => { menu.remove(); items[i].action(); };
    });

    const dismiss = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', dismiss); } };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
}

// ============ Generalized Item Operations ============
function cloneItem(itemId, category) {
    const proj = state.currentProject;
    const list = proj[category];
    const item = list.find(x => x.id === itemId);
    if (!item) return;
    const cloned = { ...JSON.parse(JSON.stringify(item)), id: crypto.randomUUID() };
    if (category === 'shorts') {
        cloned.order = list.length + 1;
        cloned.taskId = null; cloned.status = 'pending'; cloned.videoUrl = null; cloned.videoPath = null; cloned.sourceVideoUrl = null; cloned.referenceVideoUrl = null; cloned.error = null;
    }
    const idx = list.indexOf(item);
    list.splice(idx + 1, 0, cloned);
    if (category === 'shorts') list.forEach((s, i) => s.order = i + 1);
    state.selectedNodeId = cloned.id;
    state.selectedNodeType = getItemType(category);
    saveProject(proj);
    showToast(`已克隆`, 'success');
    renderBreakdown();
}

function moveItemToFolder(itemId, category, folderId) {
    const proj = state.currentProject;
    const item = findItemInCategory(proj, category, itemId);
    if (!item) return;
    item.folderId = folderId;
    saveProject(proj);
    renderBreakdown();
    if (state.selectedNodeId === itemId) renderDetailPanel(itemId, getItemType(category));
}

function deleteItem(itemId, category) {
    if (!confirm('确定删除？')) return;
    const proj = state.currentProject;
    proj[category] = proj[category].filter(x => x.id !== itemId);
    if (category === 'shorts') proj.shorts.forEach((s, i) => s.order = i + 1);
    if (state.selectedNodeId === itemId) state.selectedNodeId = null;
    saveProject(proj);
    renderBreakdown();
}

async function addItemToCategory(category, folderId) {
    const proj = state.currentProject;
    const item = createNewItem(proj, category, folderId);
    proj[category].push(item);
    state.selectedNodeId = item.id;
    state.selectedNodeType = getItemType(category);
    await saveProject(proj);
    renderBreakdown();
}

// ============ Generalized Folder Operations ============
async function createFolderForCategory(category) {
    const name = prompt('文件夹名称:', 'Act 1');
    if (!name) return;
    const proj = state.currentProject;
    proj.folders = proj.folders || [];
    const catFolders = getFolders(proj, category);
    const folder = { id: crypto.randomUUID(), name: name.trim(), order: catFolders.length, category };
    proj.folders.push(folder);
    state.treeExpanded[folder.id] = true;
    await saveProject(proj);
    state.selectedNodeId = folder.id;
    state.selectedNodeType = `${getItemType(category)}-folder`;
    renderBreakdown();
}

async function renameFolderGeneric(folderId) {
    const proj = state.currentProject;
    const folder = (proj.folders || []).find(f => f.id === folderId);
    if (!folder) return;
    const name = prompt('重命名文件夹:', folder.name);
    if (!name) return;
    folder.name = name.trim();
    await saveProject(proj);
    renderBreakdown();
    if (state.selectedNodeId === folderId) renderDetailPanel(folderId, `${getItemType(folder.category)}-folder`);
}

function cloneFolderGeneric(folderId, category) {
    const proj = state.currentProject;
    const folder = (proj.folders || []).find(f => f.id === folderId);
    if (!folder) return;
    const newFolderId = crypto.randomUUID();
    const catFolders = getFolders(proj, category);
    const newFolder = { ...folder, id: newFolderId, name: `${folder.name} (副本)`, order: catFolders.length };
    proj.folders.push(newFolder);
    // Clone all items in this folder
    const folderItems = proj[category].filter(x => x.folderId === folderId);
    const clonedItems = folderItems.map(item => {
        const cloned = { ...JSON.parse(JSON.stringify(item)), id: crypto.randomUUID(), folderId: newFolderId };
        if (category === 'shorts') {
            cloned.taskId = null; cloned.status = 'pending'; cloned.videoUrl = null; cloned.videoPath = null; cloned.sourceVideoUrl = null; cloned.referenceVideoUrl = null; cloned.error = null;
        }
        return cloned;
    });
    proj[category].push(...clonedItems);
    if (category === 'shorts') proj.shorts.forEach((s, i) => s.order = i + 1);
    state.treeExpanded[newFolderId] = true;
    saveProject(proj);
    showToast(`已克隆文件夹 "${folder.name}"`, 'success');
    renderBreakdown();
}

async function deleteFolderGeneric(folderId, category) {
    const proj = state.currentProject;
    const folder = (proj.folders || []).find(f => f.id === folderId);
    if (!folder) return;
    const folderItems = proj[category].filter(x => x.folderId === folderId);
    const action = folderItems.length > 0
        ? confirm(`文件夹 "${folder.name}" 包含 ${folderItems.length} 个项目。\n\n确定 → 删除文件夹并移出项目\n取消 → 不操作`)
        : confirm(`确定删除空文件夹 "${folder.name}"？`);
    if (!action) return;
    folderItems.forEach(x => x.folderId = null);
    proj.folders = proj.folders.filter(f => f.id !== folderId);
    if (state.selectedNodeId === folderId) state.selectedNodeId = null;
    await saveProject(proj);
    renderBreakdown();
}

// ============ Gallery Callbacks ============
function galleryCallbacks(category, nodeId, nodeType) {
    return {
        onSelectItem: (id, type) => {
            state.selectedNodeId = id;
            state.selectedNodeType = type;
            expandParentsForNode(id, type);
            renderTreePanel();
            attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
            renderDetailPanel(id, type);
        },
        onAddItem: () => addItemToCategory(category),
        onAddFolder: (cat) => createFolderForCategory(cat),
        onRegenGroup: () => onTreeRegenerate(nodeId, nodeType),
        onGenMissing: () => generateMissingImages(nodeType, state.currentProject),
    };
}

/** Navigate back to a category gallery view */
function navigateToGallery(groupId, groupType) {
    state.selectedNodeId = groupId;
    state.selectedNodeType = groupType;
    renderTreePanel();
    attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
    renderDetailPanel(groupId, groupType);
}

const DETAIL_BREADCRUMBS = {
    character: { groupId: 'characters-group', groupType: 'characters-group', icon: '👤', label: '角色' },
    prop:      { groupId: 'props-group',      groupType: 'props-group',      icon: '🎒', label: '道具' },
    scene:     { groupId: 'scenes-group',      groupType: 'scenes-group',      icon: '🎬', label: '场景' },
    short:     { groupId: 'shorts-group',      groupType: 'shorts-group',      icon: '📋', label: '分镜' },
};

function breadcrumbHTML(nodeType, itemName, folder) {
    const bc = DETAIL_BREADCRUMBS[nodeType];
    if (!bc) return '';
    const sep = '<span style="color:var(--text-faint)">›</span>';
    let html = `<h3 class="text-base font-semibold mb-3 flex items-center gap-1">
        <span class="detail-breadcrumb-back" data-bc-group="${bc.groupId}" data-bc-type="${bc.groupType}">全部</span>
        ${sep}`;
    if (folder) {
        const folderType = `${nodeType}-folder`;
        html += `<span class="detail-breadcrumb-back" data-bc-group="${escapeHtml(folder.id)}" data-bc-type="${escapeHtml(folderType)}">📁 ${escapeHtml(folder.name)}</span>${sep}`;
    }
    html += `<span>${bc.icon} ${escapeHtml(itemName)}</span></h3>`;
    return html;
}

function attachBreadcrumbEvents(panel) {
    panel.querySelectorAll('.detail-breadcrumb-back').forEach(el => {
        el.onclick = () => {
            const groupId = el.dataset.bcGroup;
            const groupType = el.dataset.bcType;
            state.selectedNodeId = groupId;
            state.selectedNodeType = groupType;
            renderTreePanel();
            attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
            renderDetailPanel(groupId, groupType);
        };
    });
}

// ============ Detail Panel ============
async function handleDetailImgPaste(e) {
    const proj = state.currentProject;
    if (!proj) return;
    const { url, key } = e.detail || {};
    if (!url || !key) return;
    const id = state.selectedNodeId;
    try {
        switch (key) {
            case 'character': {
                const c = proj.characters.find(x => x.id === id);
                if (!c) return;
                preserveImageCandidate(c);
                addImageCandidate(c, url, null);
                await saveProject(proj);
                showToast('已粘贴图片链接', 'success');
                renderDetailPanel(id, 'character');
                break;
            }
            case 'prop': {
                const p = proj.props.find(x => x.id === id);
                if (!p) return;
                preserveImageCandidate(p);
                addImageCandidate(p, url, null);
                await saveProject(proj);
                showToast('已粘贴图片链接', 'success');
                renderDetailPanel(id, 'prop');
                break;
            }
            case 'scene': {
                const s = proj.scenes.find(x => x.id === id);
                if (!s) return;
                preserveImageCandidate(s);
                addImageCandidate(s, url, null);
                await saveProject(proj);
                showToast('已粘贴图片链接', 'success');
                renderDetailPanel(id, 'scene');
                break;
            }
            case 'firstFrame': {
                const sh = proj.shorts.find(x => x.id === id);
                if (!sh) return;
                sh.firstFrameUrl = url;
                await saveProject(proj);
                showToast('已粘贴首帧链接', 'success');
                renderDetailPanel(id, 'short');
                break;
            }
            case 'lastFrame': {
                const sh = proj.shorts.find(x => x.id === id);
                if (!sh) return;
                sh.lastFrameUrl = url;
                await saveProject(proj);
                showToast('已粘贴尾帧链接', 'success');
                renderDetailPanel(id, 'short');
                break;
            }
            case 'picturebook': {
                const sh = proj.shorts.find(x => x.id === id);
                if (!sh) return;
                sh.picturebookUrl = url;
                sh.picturebookStatus = 'succeeded';
                await saveProject(proj);
                showToast('已粘贴绘本图片链接', 'success');
                renderDetailPanel(id, 'short');
                break;
            }
            case 'extraRef': {
                const sh = proj.shorts.find(x => x.id === id);
                if (!sh) return;
                if (!Array.isArray(sh.imageUrls)) sh.imageUrls = [];
                const idxAttr = e.detail.slotEl && e.detail.slotEl.getAttribute('data-img-paste-idx');
                const idx = idxAttr !== null && idxAttr !== undefined && idxAttr !== '' ? parseInt(idxAttr, 10) : -1;
                if (Number.isInteger(idx) && idx >= 0 && idx < sh.imageUrls.length) {
                    sh.imageUrls[idx] = url;
                } else {
                    sh.imageUrls.push(url);
                }
                await saveProject(proj);
                showToast('已粘贴参考图链接', 'success');
                renderDetailPanel(id, 'short');
                break;
            }
            default:
                return;
        }
    } catch (err) {
        console.warn('[detail paste]', err);
        showToast('粘贴失败: ' + (err && err.message || err), 'error');
    }
}

function ensureDetailPanelImgPaste(panel) {
    if (!panel || panel._imgPasteInstalled) return;
    panel._imgPasteInstalled = true;
    panel.addEventListener('imgslot:paste', handleDetailImgPaste);
}

function renderDetailPanel(nodeId, nodeType) {
    const proj = state.currentProject;
    const panel = $('detailPanel');
    ensureDetailPanelImgPaste(panel);

    switch (nodeType) {
        case 'script-section': renderPlotSettingsDetail(panel, proj); break;
        case 'synopsis': renderSynopsisDetail(panel, proj); break;
        case 'character': renderCharacterDetail(panel, proj, nodeId); break;
        case 'prop': renderPropDetail(panel, proj, nodeId); break;
        case 'scene': renderSceneDetail(panel, proj, nodeId); break;
        case 'short': renderShortDetail(panel, proj, nodeId); break;
        case 'characters-group': renderCharactersGallery(panel, proj, galleryCallbacks('characters', nodeId, nodeType)); break;
        case 'props-group': renderPropsGallery(panel, proj, galleryCallbacks('props', nodeId, nodeType)); break;
        case 'scenes-group': renderScenesGallery(panel, proj, galleryCallbacks('scenes', nodeId, nodeType)); break;
        case 'shorts-group': renderShortsGallery(panel, proj, galleryCallbacks('shorts', nodeId, nodeType)); break;
        case 'trash-group': renderTrashView(panel, proj); break;
        default:
            if (isFolder(nodeType)) {
                renderFolderDetail(panel, proj, nodeId, nodeType);
            } else {
                panel.innerHTML = '<div class="flex items-center justify-center h-full" style="color:var(--text-faint)">选择一个节点</div>';
            }
    }
}

function renderPlotSettingsDetail(panel, proj) {
    renderPlotSettings(panel, proj, {
        onAnalyze: () => onAnalyzeScript(),
        onSave: async () => {
            collectSettingsInline();
            await saveProject(proj);
            showToast('已保存', 'success');
        },
    });
}

function renderSynopsisDetail(panel, proj) {
    panel.innerHTML = `
        <div class="card-flat p-4 fade-in">
            <h3 class="text-base font-semibold mb-3">📝 影片概要</h3>
            <textarea id="detailSynopsis" class="modal-input" style="min-height:120px">${escapeHtml(proj.synopsis || '')}</textarea>
            <div id="synopsisStreamPreview" class="card-flat hidden mt-2" style="max-height:200px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace"></div>
            <div class="flex gap-2 mt-3">
                <button class="btn-primary" id="saveSynopsisBtn">保存</button>
                <button class="btn-secondary" id="regenSynopsisBtn">🔄 重新生成</button>
            </div>
        </div>`;
    $('saveSynopsisBtn').onclick = async () => {
        proj.synopsis = $('detailSynopsis').value.trim();
        await saveProject(proj);
        showToast('已保存', 'success');
        renderTreePanel();
        attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
    };
    $('regenSynopsisBtn').onclick = () => onTreeRegenerate('synopsis', 'synopsis');
}

function renderCharacterDetail(panel, proj, id) {
    const c = proj.characters.find(x => x.id === id);
    if (!c) return;
    const cFolder = c.folderId && (proj.folders || []).find(f => f.id === c.folderId) || null;
    const isAssetRef = isAssetLibraryUrl(c.imageUrl);
    const assetRefId = isAssetRef ? c.imageUrl.replace(/^asset:\/\//, '') : '';
    const needsDetail = !c.description || c.description.length < 80;
    const traitsHTML = c.visualTraits ? `
        <div>
            <label class="text-xs" style="color:var(--text-muted)">视觉特征</label>
            <div class="flex flex-wrap gap-1 mt-1">
                ${(Array.isArray(c.visualTraits) ? c.visualTraits : Object.entries(c.visualTraits).map(([k,v]) => `${k}: ${v}`)).map(t => `<span class="shot-meta-tag">${escapeHtml(String(t))}</span>`).join('')}
            </div>
        </div>` : '';
    panel.innerHTML = `
        <div class="card-flat p-4 fade-in">
            ${breadcrumbHTML('character', c.name, cFolder)}
            ${needsDetail ? '<div class="mb-3 p-2 rounded-lg text-xs" style="background:rgba(251,191,36,0.1);color:#fcd34d;border:1px solid rgba(251,191,36,0.2)">💡 此角色仅有简要描述，点击下方"🔄 生成详细描述"获取完整外观描述</div>' : ''}
            <div class="space-y-3">
                <div><label class="text-xs" style="color:var(--text-muted)">名称</label><input id="detailName" class="modal-input mt-1" value="${escapeHtml(c.name)}"></div>
                <div><label class="text-xs" style="color:var(--text-muted)">外观描述</label><textarea id="detailDesc" class="modal-input mt-1" style="min-height:100px">${escapeHtml(c.description)}</textarea></div>
                ${traitsHTML}
                <div id="charStreamPreview" class="card-flat hidden" style="max-height:200px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace"></div>
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">参考图片 (锚点)</label>
                    <div class="mt-1 flex items-center gap-3" data-img-paste="character">
                        ${c.imageUrl
                            ? (isAssetRef
                                ? `<div class="img-thumb${c.anchorVerified ? ' anchor-verified' : ''}" style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:3px;background:var(--bg-panel)"><span style="font-size:10px;color:var(--text-muted)">虚拟人像</span><span style="font-size:9px;color:var(--text-faint);max-width:56px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(assetRefId)}">${escapeHtml(assetRefId)}</span></div>`
                                : `<img src="${escapeHtml(resolveUrl(c.imageUrl))}" class="img-thumb${c.anchorVerified ? ' anchor-verified' : ''}" onclick="document.getElementById('imgPreviewSrc').src='${escapeHtml(resolveUrl(c.imageUrl))}';document.getElementById('imgPreview').classList.remove('hidden')">`)
                            : ''}
                        <label class="upload-zone" style="width:60px;height:60px;flex-shrink:0;cursor:pointer">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            <input type="file" accept="image/*" class="hidden" id="charImageInput">
                        </label>
                        ${c.imageUrl ? `<button class="btn-danger" id="removeCharImg">移除</button>` : ''}
                        <button class="btn-secondary" id="aiGenCharImgBtn" title="根据描述AI生成角色图片">🎨 AI生成</button>
                    </div>
                    <div class="mt-2 card-flat" style="padding:10px">
                        <div class="text-xs mb-2" style="color:var(--text-muted)">导入虚拟人像 (Doubao)</div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <input id="charVirtualAssetIdInput" class="modal-input" style="max-width:360px" placeholder="asset-20260224202240-qn6zg 或 asset://asset-..." value="${escapeHtml(assetRefId)}">
                            <button class="btn-secondary" id="importCharVirtualAssetBtn">导入ID</button>
                            <button class="btn-secondary" id="openVirtualAssetHelpBtn" title="打开文档获取虚拟人像ID">帮助</button>
                        </div>
                        <div class="text-xs mt-1" style="color:var(--text-faint)">提交时将使用 asset://ID 作为 reference_image。</div>
                    </div>
                    ${renderImageCandidatesHTML(c)}
                    ${c.imageUrl ? `
                    <label class="flex items-center gap-2 mt-2 text-xs cursor-pointer" style="color:var(--text-muted)">
                        <input type="checkbox" id="anchorVerifyCheck" ${c.anchorVerified ? 'checked' : ''} style="accent-color:#10b981">
                        <span>锚点已验证 — 此图作为角色一致性基准</span>
                    </label>` : ''}
                </div>
                <div class="flex gap-2 pt-2">
                    <button class="btn-primary" id="saveCharBtn">保存</button>
                    <button class="btn-secondary" id="regenCharBtn">🔄 重新生成</button>
                    <button class="btn-danger" id="deleteCharBtn">删除</button>
                </div>
            </div>
        </div>`;

    $('saveCharBtn').onclick = async () => {
        c.name = $('detailName').value.trim() || c.name;
        c.description = $('detailDesc').value.trim();
        if ($('anchorVerifyCheck')) c.anchorVerified = $('anchorVerifyCheck').checked;
        await saveProject(proj);
        showToast('已保存', 'success');
        renderTreePanel();
        attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
    };
    $('regenCharBtn').onclick = () => onTreeRegenerate(id, 'character');
    $('deleteCharBtn').onclick = async () => {
        if (!confirm('确定删除此角色？')) return;
        proj.characters = proj.characters.filter(x => x.id !== id);
        proj.shorts.forEach(s => { s.characterIds = s.characterIds.filter(cid => cid !== id); });
        state.selectedNodeId = null;
        await saveProject(proj);
        renderBreakdown();
    };
    $('charImageInput').onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        showToast('上传中...', 'info');
        const asset = await saveProjectImageAsset(proj, file, 'characters', c.id);
        if (asset) {
            preserveImageCandidate(c);
            addImageCandidate(c, asset.url, asset.path);
            await saveProject(proj);
            renderDetailPanel(id, 'character');
        }
    };
    $('importCharVirtualAssetBtn').onclick = async () => {
        const raw = $('charVirtualAssetIdInput')?.value || '';
        const normalized = normalizeVirtualPortraitRef(raw);
        if (!normalized) {
            showToast('请输入有效ID，例如 asset-20260224202240-qn6zg', 'error');
            return;
        }
        preserveImageCandidate(c);
        addImageCandidate(c, normalized, null);
        await saveProject(proj);
        showToast('已导入虚拟人像ID', 'success');
        renderDetailPanel(id, 'character');
    };
    $('openVirtualAssetHelpBtn').onclick = () => {
        window.open('https://www.volcengine.com/docs/82379/2223965?lang=zh', '_blank', 'noopener,noreferrer');
    };
    if ($('removeCharImg')) $('removeCharImg').onclick = async () => {
        c.imageUrl = null;
        c.imagePath = null;
        await saveProject(proj);
        renderDetailPanel(id, 'character');
    };
    $('aiGenCharImgBtn').onclick = () => {
        const desc = $('detailDesc')?.value?.trim() || c.description;
        if (!desc) { showToast('请先填写角色外观描述', 'error'); return; }
        showGenImageModal({
            nodeType: 'character',
            description: desc,
            project: proj,
            onSave: async (updatedDesc) => {
                c.name = $('detailName')?.value?.trim() || c.name;
                c.description = updatedDesc;
                if ($('anchorVerifyCheck')) c.anchorVerified = $('anchorVerifyCheck').checked;
                await saveProject(proj);
                renderTreePanel();
                attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
            },
            onGenerate: async (prompt, { width, height }) => {
                preserveImageCandidate(c);
                const url = await genImageDirect(prompt, { width, height });
                if (url) {
                    addImageCandidate(c, url);
                    await saveProject(proj);
                    showToast('角色图片已生成', 'success');
                    renderDetailPanel(id, 'character');
                } else {
                    showToast('图片生成未返回结果', 'error');
                }
            },
        });
    };
    attachImageCandidateEvents(c, proj, id, 'character');
    attachBreadcrumbEvents(panel);
}

function renderPropDetail(panel, proj, id) {
    const p = proj.props.find(x => x.id === id);
    if (!p) return;
    const pFolder = p.folderId && (proj.folders || []).find(f => f.id === p.folderId) || null;
    if (!p) return;
    panel.innerHTML = `
        <div class="card-flat p-4 fade-in">
            ${breadcrumbHTML('prop', p.name, pFolder)}
            <div class="space-y-3">
                <div><label class="text-xs" style="color:var(--text-muted)">名称</label><input id="detailName" class="modal-input mt-1" value="${escapeHtml(p.name)}"></div>
                <div><label class="text-xs" style="color:var(--text-muted)">外观描述</label><textarea id="detailDesc" class="modal-input mt-1" style="min-height:100px">${escapeHtml(p.description || '')}</textarea></div>
                <div id="propStreamPreview" class="card-flat hidden" style="max-height:200px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace"></div>
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">参考图片</label>
                    <div class="mt-1 flex items-center gap-3" data-img-paste="prop">
                        ${p.imageUrl ? `<img src="${escapeHtml(resolveUrl(p.imageUrl))}" class="img-thumb${p.anchorVerified ? ' anchor-verified' : ''}" onclick="document.getElementById('imgPreviewSrc').src='${escapeHtml(resolveUrl(p.imageUrl))}';document.getElementById('imgPreview').classList.remove('hidden')">` : ''}
                        <label class="upload-zone" style="width:60px;height:60px;flex-shrink:0;cursor:pointer">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            <input type="file" accept="image/*" class="hidden" id="propImageInput">
                        </label>
                        ${p.imageUrl ? `<button class="btn-danger" id="removePropImg">移除</button>` : ''}
                        <button class="btn-secondary" id="aiGenPropImgBtn" title="根据描述AI生成道具图片">🎨 AI生成</button>
                    </div>
                    ${renderImageCandidatesHTML(p)}
                    ${p.imageUrl ? `
                    <label class="flex items-center gap-2 mt-2 text-xs cursor-pointer" style="color:var(--text-muted)">
                        <input type="checkbox" id="anchorVerifyCheck" ${p.anchorVerified ? 'checked' : ''} style="accent-color:#10b981">
                        <span>锚点已验证 — 此图作为道具一致性基准</span>
                    </label>` : ''}
                </div>
                <div class="flex gap-2 pt-2">
                    <button class="btn-primary" id="savePropBtn">保存</button>
                    <button class="btn-secondary" id="regenPropBtn">🔄 重新生成</button>
                    <button class="btn-danger" id="deletePropBtn">删除</button>
                </div>
            </div>
        </div>`;

    $('savePropBtn').onclick = async () => {
        p.name = $('detailName').value.trim() || p.name;
        p.description = $('detailDesc').value.trim();
        if ($('anchorVerifyCheck')) p.anchorVerified = $('anchorVerifyCheck').checked;
        await saveProject(proj);
        showToast('已保存', 'success');
        renderTreePanel();
        attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
    };
    $('regenPropBtn').onclick = () => onTreeRegenerate(id, 'prop');
    $('deletePropBtn').onclick = async () => {
        if (!confirm('确定删除此道具？')) return;
        proj.props = proj.props.filter(x => x.id !== id);
        proj.shorts.forEach(s => { s.propIds = (s.propIds || []).filter(pid => pid !== id); });
        state.selectedNodeId = null;
        await saveProject(proj);
        renderBreakdown();
    };
    $('propImageInput').onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        showToast('上传中...', 'info');
        const asset = await saveProjectImageAsset(proj, file, 'props', p.id);
        if (asset) {
            preserveImageCandidate(p);
            addImageCandidate(p, asset.url, asset.path);
            await saveProject(proj);
            renderDetailPanel(id, 'prop');
        }
    };
    if ($('removePropImg')) $('removePropImg').onclick = async () => {
        p.imageUrl = null;
        p.imagePath = null;
        await saveProject(proj);
        renderDetailPanel(id, 'prop');
    };
    $('aiGenPropImgBtn').onclick = () => {
        const desc = $('detailDesc')?.value?.trim() || p.description;
        if (!desc) { showToast('请先填写道具外观描述', 'error'); return; }
        showGenImageModal({
            nodeType: 'prop',
            description: desc,
            project: proj,
            onSave: async (updatedDesc) => {
                p.name = $('detailName')?.value?.trim() || p.name;
                p.description = updatedDesc;
                if ($('anchorVerifyCheck')) p.anchorVerified = $('anchorVerifyCheck').checked;
                await saveProject(proj);
                renderTreePanel();
                attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
            },
            onGenerate: async (prompt, { width, height }) => {
                preserveImageCandidate(p);
                const url = await genImageDirect(prompt, { width, height });
                if (url) {
                    addImageCandidate(p, url);
                    await saveProject(proj);
                    showToast('道具图片已生成', 'success');
                    renderDetailPanel(id, 'prop');
                } else {
                    showToast('图片生成未返回结果', 'error');
                }
            },
        });
    };
    attachImageCandidateEvents(p, proj, id, 'prop');
    attachBreadcrumbEvents(panel);
}

function renderSceneDetail(panel, proj, id) {
    const s = proj.scenes.find(x => x.id === id);
    if (!s) return;
    const sFolder = s.folderId && (proj.folders || []).find(f => f.id === s.folderId) || null;
    if (!s) return;
    const needsDetail = !s.description || s.description.length < 80;
    panel.innerHTML = `
        <div class="card-flat p-4 fade-in">
            ${breadcrumbHTML('scene', s.name, sFolder)}
            ${needsDetail ? '<div class="mb-3 p-2 rounded-lg text-xs" style="background:rgba(251,191,36,0.1);color:#fcd34d;border:1px solid rgba(251,191,36,0.2)">💡 此场景仅有简要描述，点击下方"🔄 生成详细描述"获取完整场景描述</div>' : ''}
            <div class="space-y-3">
                <div><label class="text-xs" style="color:var(--text-muted)">名称</label><input id="detailName" class="modal-input mt-1" value="${escapeHtml(s.name)}"></div>
                <div><label class="text-xs" style="color:var(--text-muted)">场景描述</label><textarea id="detailDesc" class="modal-input mt-1" style="min-height:100px">${escapeHtml(s.description)}</textarea></div>
                <div class="flex gap-3">
                    <div class="flex-1"><label class="text-xs" style="color:var(--text-muted)">光照</label><input id="detailLighting" class="modal-input mt-1" value="${escapeHtml(s.lighting || '')}" placeholder="如: Golden-hour warm"></div>
                    <div class="flex-1"><label class="text-xs" style="color:var(--text-muted)">时间</label><input id="detailTimeOfDay" class="modal-input mt-1" value="${escapeHtml(s.timeOfDay || '')}" placeholder="如: 黄昏"></div>
                </div>
                <div class="flex gap-3">
                    <div class="flex-1"><label class="text-xs" style="color:var(--text-muted)">天气</label><input id="detailWeather" class="modal-input mt-1" value="${escapeHtml(s.weather || '')}" placeholder="如: 阴天"></div>
                    <div class="flex-1"><label class="text-xs" style="color:var(--text-muted)">氛围</label><input id="detailMood" class="modal-input mt-1" value="${escapeHtml(s.mood || '')}" placeholder="如: 神秘、温馨"></div>
                </div>
                <div id="sceneStreamPreview" class="card-flat hidden" style="max-height:200px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace"></div>
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">参考图片</label>
                    <div class="mt-1 flex items-center gap-3" data-img-paste="scene">
                        ${s.imageUrl ? `<img src="${escapeHtml(resolveUrl(s.imageUrl))}" class="img-thumb" onclick="document.getElementById('imgPreviewSrc').src='${escapeHtml(resolveUrl(s.imageUrl))}';document.getElementById('imgPreview').classList.remove('hidden')">` : ''}
                        <label class="upload-zone" style="width:60px;height:60px;flex-shrink:0;cursor:pointer">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            <input type="file" accept="image/*" class="hidden" id="sceneImageInput">
                        </label>
                        ${s.imageUrl ? `<button class="btn-danger" id="removeSceneImg">移除</button>` : ''}
                        <button class="btn-secondary" id="aiGenSceneImgBtn" title="根据描述AI生成场景图片">🎨 AI生成</button>
                    </div>
                    ${renderImageCandidatesHTML(s)}
                </div>
                <div class="flex gap-2 pt-2">
                    <button class="btn-primary" id="saveSceneBtn">保存</button>
                    <button class="btn-secondary" id="regenSceneBtn">🔄 重新生成</button>
                    <button class="btn-danger" id="deleteSceneBtn">删除</button>
                </div>
            </div>
        </div>`;

    $('saveSceneBtn').onclick = async () => {
        s.name = $('detailName').value.trim() || s.name;
        s.description = $('detailDesc').value.trim();
        s.lighting = $('detailLighting').value.trim() || null;
        s.timeOfDay = $('detailTimeOfDay').value.trim() || null;
        s.weather = $('detailWeather').value.trim() || null;
        s.mood = $('detailMood').value.trim() || null;
        await saveProject(proj);
        showToast('已保存', 'success');
        renderTreePanel();
        attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
    };
    $('regenSceneBtn').onclick = () => onTreeRegenerate(id, 'scene');
    $('deleteSceneBtn').onclick = async () => {
        if (!confirm('确定删除此场景？')) return;
        proj.scenes = proj.scenes.filter(x => x.id !== id);
        proj.shorts.forEach(s => { if (s.sceneId === id) s.sceneId = null; });
        state.selectedNodeId = null;
        await saveProject(proj);
        renderBreakdown();
    };
    $('sceneImageInput').onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        showToast('上传中...', 'info');
        const asset = await saveProjectImageAsset(proj, file, 'scenes', s.id);
        if (asset) {
            preserveImageCandidate(s);
            addImageCandidate(s, asset.url, asset.path);
            await saveProject(proj);
            renderDetailPanel(id, 'scene');
        }
    };
    if ($('removeSceneImg')) $('removeSceneImg').onclick = async () => {
        s.imageUrl = null;
        s.imagePath = null;
        await saveProject(proj);
        renderDetailPanel(id, 'scene');
    };
    $('aiGenSceneImgBtn').onclick = () => {
        const desc = $('detailDesc')?.value?.trim() || s.description;
        if (!desc) { showToast('请先填写场景描述', 'error'); return; }
        showGenImageModal({
            nodeType: 'scene',
            description: desc,
            project: proj,
            onSave: async (updatedDesc) => {
                s.name = $('detailName')?.value?.trim() || s.name;
                s.description = updatedDesc;
                await saveProject(proj);
                renderTreePanel();
                attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
            },
            onGenerate: async (prompt, { width, height }) => {
                preserveImageCandidate(s);
                const url = await genImageDirect(prompt, { width, height });
                if (url) {
                    addImageCandidate(s, url);
                    await saveProject(proj);
                    showToast('场景图片已生成', 'success');
                    renderDetailPanel(id, 'scene');
                } else {
                    showToast('图片生成未返回结果', 'error');
                }
            },
        });
    };
    attachImageCandidateEvents(s, proj, id, 'scene');
    attachBreadcrumbEvents(panel);
}

function renderShortDetail(panel, proj, id) {
    const sh = proj.shorts.find(x => x.id === id);
    if (!sh) return;
    const shFolder = sh.folderId && (proj.folders || []).find(f => f.id === sh.folderId) || null;
    const scene = proj.scenes.find(sc => sc.id === sh.sceneId);
    const needsDetail = !sh.prompt || sh.prompt.length < 80;
    const metaTags = [];
    if (sh.shotType) metaTags.push(`<span class="shot-meta-tag"><span class="tag-label">类型:</span> ${escapeHtml(sh.shotType)}</span>`);
    if (sh.emotion) metaTags.push(`<span class="shot-meta-tag"><span class="tag-label">情绪:</span> ${escapeHtml(sh.emotion)}</span>`);
    if (sh.cameraMovement) metaTags.push(`<span class="shot-meta-tag"><span class="tag-label">运镜:</span> ${escapeHtml(sh.cameraMovement)}</span>`);
    if (sh.cameraAngle) metaTags.push(`<span class="shot-meta-tag"><span class="tag-label">角度:</span> ${escapeHtml(sh.cameraAngle)}</span>`);
    if (sh.lighting) metaTags.push(`<span class="shot-meta-tag"><span class="tag-label">灯光:</span> ${escapeHtml(sh.lighting)}</span>`);
    const stableVarsHTML = sh.stableVariables && Array.isArray(sh.stableVariables)
        ? `<div><label class="text-xs" style="color:var(--text-muted)">稳定变量 (跨镜头锁定)</label><div class="flex flex-wrap gap-1 mt-1">${sh.stableVariables.map(v => `<span class="shot-meta-tag">${escapeHtml(v)}</span>`).join('')}</div></div>` : '';
    const hasExtraRefs = (sh.imageUrls && sh.imageUrls.length > 0);
    panel.innerHTML = `
        <div class="card-flat p-4 fade-in">
            <div class="flex items-center justify-between mb-3">
                ${breadcrumbHTML('short', `短片 #${sh.order}`, shFolder)}
                ${sh.enhanced ? '<span class="status-badge status-succeeded">已增强</span>' : '<span class="status-badge status-pending">未增强</span>'}
            </div>
            ${needsDetail ? '<div class="mb-3 p-2 rounded-lg text-xs" style="background:rgba(251,191,36,0.1);color:#fcd34d;border:1px solid rgba(251,191,36,0.2)">💡 此短片仅有简要提示词，点击下方"🔄 重新生成提示词"获取详细视频生成提示词</div>' : ''}
            ${metaTags.length > 0 ? `<div class="flex flex-wrap gap-1 mb-3">${metaTags.join('')}</div>` : ''}
            <div class="space-y-3">
                <div><label class="text-xs" style="color:var(--text-muted)">视频提示词</label><textarea id="detailPrompt" class="modal-input mt-1" style="min-height:140px">${escapeHtml(sh.prompt)}</textarea></div>
                <div class="flex gap-3 flex-wrap">
                    <div class="flex-1" style="min-width:200px">
                        <label class="text-xs" style="color:var(--text-muted)" title="角色台词，会随视频一起生成内嵌音频，并自动同步到剪辑编辑器的台词字幕轨">🗣️ 角色台词 (内嵌音频)</label>
                        <textarea id="detailDialogue" class="modal-input mt-1" style="min-height:60px" placeholder="例: 你好，欢迎来到未来世界。(留空表示无台词)">${escapeHtml(sh.dialogue || '')}</textarea>
                    </div>
                    <div class="flex-1" style="min-width:200px">
                        <label class="text-xs" style="color:var(--text-muted)" title="旁白文字，仅在剪辑编辑器以字幕形式叠加显示">📝 旁白 (后期字幕)</label>
                        <textarea id="detailNarration" class="modal-input mt-1" style="min-height:60px" placeholder="例: 多年以后，他终于明白了那个夏天的意义。">${escapeHtml(sh.narration || '')}</textarea>
                    </div>
                </div>
                <div id="shortStreamPreview" class="card-flat hidden" style="max-height:200px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace"></div>
                <div class="flex gap-4 flex-wrap">
                    <div>
                        <label class="text-xs" style="color:var(--text-muted)">场景</label>
                        <div class="flex items-center gap-2 mt-1">
                            ${scene && scene.imageUrl ? `<img src="${escapeHtml(resolveUrl(scene.imageUrl))}" class="img-thumb" style="width:40px;height:40px;border-radius:6px" onclick="document.getElementById('imgPreviewSrc').src='${escapeHtml(resolveUrl(scene.imageUrl))}';document.getElementById('imgPreview').classList.remove('hidden')">` : ''}
                            <select id="detailScene" class="modal-input">
                                <option value="">无</option>
                                ${proj.scenes.map(sc => `<option value="${sc.id}" ${sc.id === sh.sceneId ? 'selected' : ''}>${escapeHtml(sc.name)}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="text-xs" style="color:var(--text-muted)">时长</label>
                        <select id="detailDuration" class="modal-input mt-1">
                            ${CONFIG.CLIP_DURATIONS.map(d => `<option value="${d}" ${d === sh.duration ? 'selected' : ''}>${d === -1 ? '自动' : d + 's'}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="text-xs" style="color:var(--text-muted)">比例</label>
                        <select id="detailRatio" class="modal-input mt-1">
                            ${CONFIG.RATIOS.map(r => `<option value="${r}" ${r === (sh.ratio || proj.settings.ratio) ? 'selected' : ''}>${r}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="flex gap-3 flex-wrap">
                    <div class="flex-1" style="min-width:120px"><label class="text-xs" style="color:var(--text-muted)">镜头类型</label><div class="mt-1">${presetComboHTML('detailShotType', sh.shotType || '', '如: dialogue, walking', 'shotType')}</div></div>
                    <div class="flex-1" style="min-width:120px"><label class="text-xs" style="color:var(--text-muted)">情绪</label><div class="mt-1">${presetComboHTML('detailEmotion', sh.emotion || '', '如: 神秘/好奇', 'emotion')}</div></div>
                </div>
                <div class="flex gap-3 flex-wrap">
                    <div class="flex-1" style="min-width:120px"><label class="text-xs" style="color:var(--text-muted)">运镜</label><div class="mt-1">${presetComboHTML('detailCameraMovement', sh.cameraMovement || '', '如: Dolly In, slow', 'cameraMovement')}</div></div>
                    <div class="flex-1" style="min-width:120px"><label class="text-xs" style="color:var(--text-muted)">机位角度</label><div class="mt-1">${presetComboHTML('detailCameraAngle', sh.cameraAngle || '', '如: Eye-level', 'cameraAngle')}</div></div>
                </div>
                <div><label class="text-xs" style="color:var(--text-muted)">灯光</label><div class="mt-1">${presetComboHTML('detailLightingShort', sh.lighting || '', '如: Golden-hour warm from camera-left', 'lighting')}</div></div>
                ${stableVarsHTML}
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">角色</label>
                    <div class="flex flex-wrap gap-2 mt-1">
                        ${proj.characters.map(c => `
                            <label class="flex items-center gap-1 text-xs cursor-pointer px-2 py-1 rounded" style="background:var(--bg-pill)">
                                <input type="checkbox" value="${c.id}" ${sh.characterIds.includes(c.id) ? 'checked' : ''} class="shortCharCheck" style="accent-color:var(--accent)">
                                ${c.imageUrl
                                    ? (isAssetLibraryUrl(c.imageUrl)
                                        ? `<span style="width:24px;height:24px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;background:var(--bg-panel);border:1px dashed var(--border-card);font-size:11px;color:var(--text-muted)" title="已知资产: ${escapeHtml(c.imageUrl)}">🖼️</span>`
                                        : `<img src="${escapeHtml(resolveUrl(c.imageUrl))}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;border:1px solid var(--border-card);cursor:pointer" onclick="event.preventDefault();document.getElementById('imgPreviewSrc').src='${escapeHtml(resolveUrl(c.imageUrl))}';document.getElementById('imgPreview').classList.remove('hidden')">`)
                                    : ''}
                                ${escapeHtml(c.name)}
                            </label>`).join('')}
                    </div>
                </div>
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">道具</label>
                    <div class="flex flex-wrap gap-2 mt-1">
                        ${proj.props.map(p => `
                            <label class="flex items-center gap-1 text-xs cursor-pointer px-2 py-1 rounded" style="background:var(--bg-pill)">
                                <input type="checkbox" value="${p.id}" ${(sh.propIds || []).includes(p.id) ? 'checked' : ''} class="shortPropCheck" style="accent-color:var(--accent)">
                                ${p.imageUrl ? `<img src="${escapeHtml(resolveUrl(p.imageUrl))}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;border:1px solid var(--border-card);cursor:pointer" onclick="event.preventDefault();document.getElementById('imgPreviewSrc').src='${escapeHtml(resolveUrl(p.imageUrl))}';document.getElementById('imgPreview').classList.remove('hidden')">` : ''}
                                ${escapeHtml(p.name)}
                            </label>`).join('')}
                    </div>
                </div>
                <div style="${(sh.firstFrameUrl || sh.lastFrameUrl) ? 'opacity:0.4;pointer-events:none' : ''}">
                    <label class="text-xs" style="color:var(--text-muted)">额外参考图${(sh.firstFrameUrl || sh.lastFrameUrl) ? ' <span style="color:var(--text-faint);font-size:10px">(已设首尾帧，参考图不生效)</span>' : ''}</label>
                    <div class="flex gap-2 mt-1 flex-wrap" data-img-paste="extraRef">
                        ${(sh.imageUrls || []).map((u, i) => `<div style="position:relative;display:inline-block" data-img-paste="extraRef" data-img-paste-idx="${i}"><img src="${escapeHtml(resolveUrl(u))}" class="img-thumb" onclick="document.getElementById('imgPreviewSrc').src='${escapeHtml(resolveUrl(u))}';document.getElementById('imgPreview').classList.remove('hidden')"><button class="removeExtraRefBtn" data-idx="${i}" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:#7f1d1d;color:#fca5a5;border:1px solid #ef4444;font-size:11px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;pointer-events:auto">✕</button></div>`).join('')}
                        <label class="upload-zone" style="width:60px;height:60px;flex-shrink:0;cursor:pointer">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                            <input type="file" accept="image/*" class="hidden" id="shortImageInput">
                        </label>
                    </div>
                </div>
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">参考视频 (视频到视频)</label>
                    <div class="flex gap-2 mt-1 items-center">
                        ${sh.referenceVideoUrl ? `
                            <video src="${escapeHtml(resolveUrl(sh.referenceVideoUrl))}" controls class="rounded-lg" style="max-height:100px;max-width:160px" onerror="this.onerror=null;this.removeAttribute('src');this.outerHTML='<span class=\\'text-xs\\' style=\\'color:#fca5a5\\'>视频加载失败</span>'"></video>
                            <button class="btn-danger" id="removeRefVideoBtn" title="移除参考视频">✕</button>
                        ` : `
                            <label class="upload-zone" style="width:120px;height:60px;flex-shrink:0;cursor:pointer;gap:4px">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                                <span style="font-size:11px">上传视频</span>
                                <input type="file" accept="video/mp4,video/quicktime,video/mov,.mp4,.mov" class="hidden" id="shortVideoInput">
                            </label>
                        `}
                    </div>
                </div>
                <div style="${hasExtraRefs ? 'opacity:0.4;pointer-events:none' : ''}">
                    <label class="text-xs" style="color:var(--text-muted)">首帧 / 尾帧 <span style="color:var(--text-faint);font-size:10px">(与参考图互斥)</span>${hasExtraRefs ? ' <span style="color:var(--text-faint);font-size:10px">(已设参考图)</span>' : ''}</label>
                    <div class="flex gap-3 mt-1 items-end">
                        <div>
                            <span class="text-xs" style="color:var(--text-faint)">首帧</span>
                            <div class="flex gap-2 items-center mt-1" data-img-paste="firstFrame">
                                ${sh.firstFrameUrl ? `
                                    <img src="${escapeHtml(resolveUrl(sh.firstFrameUrl))}" class="img-thumb" onclick="document.getElementById('imgPreviewSrc').src='${escapeHtml(resolveUrl(sh.firstFrameUrl))}';document.getElementById('imgPreview').classList.remove('hidden')">
                                    <button class="btn-danger" style="padding:2px 6px;font-size:11px;pointer-events:auto" id="removeFirstFrameBtn">✕</button>
                                ` : `
                                    <label class="upload-zone" style="width:60px;height:60px;flex-shrink:0;cursor:pointer">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                                        <input type="file" accept="image/*" class="hidden" id="firstFrameInput">
                                    </label>
                                `}
                            </div>
                        </div>
                        <span style="color:var(--text-faint);font-size:16px;padding-bottom:20px">→</span>
                        <div>
                            <span class="text-xs" style="color:var(--text-faint)">尾帧</span>
                            <div class="flex gap-2 items-center mt-1" data-img-paste="lastFrame">
                                ${sh.lastFrameUrl ? `
                                    <img src="${escapeHtml(resolveUrl(sh.lastFrameUrl))}" class="img-thumb" onclick="document.getElementById('imgPreviewSrc').src='${escapeHtml(resolveUrl(sh.lastFrameUrl))}';document.getElementById('imgPreview').classList.remove('hidden')">
                                    <button class="btn-danger" style="padding:2px 6px;font-size:11px;pointer-events:auto" id="removeLastFrameBtn">✕</button>
                                ` : `
                                    <label class="upload-zone" style="width:60px;height:60px;flex-shrink:0;cursor:pointer">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                                        <input type="file" accept="image/*" class="hidden" id="lastFrameInput">
                                    </label>
                                `}
                            </div>
                        </div>
                    </div>
                </div>
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">参考音频</label>
                    <div class="flex gap-2 mt-1 items-center flex-wrap">
                        ${(sh.audioUrls || []).map((u, i) => `
                            <div class="flex items-center gap-1 px-2 py-1 rounded text-xs" style="background:var(--bg-pill);color:var(--text-secondary)">
                                🎵 音频${i + 1}
                                <span class="cursor-pointer" style="color:var(--text-faint)" onclick="this.closest('[data-audio-idx]').remove()" data-audio-idx="${i}" id="removeAudio${i}">✕</span>
                            </div>
                        `).join('')}
                        ${(sh.audioUrls || []).length < 3 ? `
                            <label class="upload-zone" style="width:80px;height:32px;flex-shrink:0;cursor:pointer;flex-direction:row;gap:4px;border-radius:8px;font-size:11px">
                                🎵 <span>添加</span>
                                <input type="file" accept="audio/*" class="hidden" id="shortAudioInput">
                            </label>
                        ` : ''}
                    </div>
                </div>
                <div class="flex gap-4 flex-wrap items-end">
                    <div>
                        <label class="text-xs" style="color:var(--text-muted)">模型 (覆盖项目设置)</label>
                        <select id="detailModelOverride" class="modal-input mt-1">
                            <option value="" ${!sh.modelOverride ? 'selected' : ''}>跟随项目 (${escapeHtml(proj.settings.model)})</option>
                            ${Object.keys(CONFIG.MODELS).map(m => `<option value="${m}" ${sh.modelOverride === m ? 'selected' : ''}>${m}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="text-xs" style="color:var(--text-muted)">生成音频</label>
                        <select id="detailGenAudioOverride" class="modal-input mt-1">
                            <option value="" ${sh.generateAudioOverride === null ? 'selected' : ''}>跟随项目 (${proj.settings.generateAudio ? '开启' : '关闭'})</option>
                            <option value="true" ${sh.generateAudioOverride === true ? 'selected' : ''}>开启</option>
                            <option value="false" ${sh.generateAudioOverride === false ? 'selected' : ''}>关闭</option>
                        </select>
                    </div>
                    <label class="flex items-center gap-2 text-xs cursor-pointer px-2 py-2 rounded" style="background:var(--bg-pill)">
                        <input type="checkbox" id="detailWatermark" ${sh.watermark ? 'checked' : ''} style="accent-color:var(--accent)">
                        水印
                    </label>
                </div>
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">📖 绘本插画 <span style="color:var(--text-faint)">(无视频时播放器显示此静帧)</span></label>
                    ${sh.picturebookUrl ? `
                    <div class="flex gap-3 mt-1 items-start" data-img-paste="picturebook">
                        <img src="${escapeHtml(resolveUrl(sh.picturebookUrl))}" class="rounded-lg cursor-pointer" style="max-height:120px;max-width:200px;object-fit:contain;background:#000;border:1px solid var(--border-card)" onclick="document.getElementById('imgPreviewSrc').src='${escapeHtml(resolveUrl(sh.picturebookUrl))}';document.getElementById('imgPreview').classList.remove('hidden')">
                        <div class="flex flex-col gap-1">
                            <button class="btn-secondary text-xs" id="genPicturebookBtn" ${sh.picturebookStatus === 'running' ? 'disabled' : ''}>
                                ${sh.picturebookStatus === 'running' ? '⏳ 生成中...' : '🔄 重新生成'}
                            </button>
                            <button class="btn-danger text-xs" id="removePicturebookBtn">✕ 移除</button>
                        </div>
                    </div>` : `
                    <div class="flex gap-2 mt-1 items-center" data-img-paste="picturebook">
                        ${sh.picturebookStatus === 'running' ? `
                        <div class="flex items-center gap-2">
                            <div class="spinner"></div>
                            <span class="text-xs" style="color:var(--text-muted)">绘本图片生成中...</span>
                        </div>` : `
                        <button class="btn-secondary text-xs" id="genPicturebookBtn">📖 生成绘本插画</button>
                        <label class="btn-secondary text-xs" style="cursor:pointer">
                            📤 上传图片
                            <input type="file" accept="image/*" class="hidden" id="picturebookUploadInput">
                        </label>`}
                    </div>`}
                    ${sh.picturebookStatus === 'failed' && sh.picturebookError ? `
                    <div class="text-xs p-2 rounded-lg mt-1" style="background:rgba(239,68,68,0.1);color:#fca5a5;border:1px solid rgba(239,68,68,0.2)">❌ ${escapeHtml(sh.picturebookError)}</div>` : ''}
                </div>
                ${sh.videoUrl ? `
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">${sh.status === 'succeeded' ? '生成结果' : '当前视频'}</label>
                    <video src="${escapeHtml(resolveUrl(sh.videoUrl))}" controls class="w-full rounded-lg mt-1" style="max-height:200px" onerror="this.onerror=null;this.removeAttribute('src');this.outerHTML='<div class=\'text-xs p-2 rounded-lg\' style=\'color:#fca5a5\'>视频加载失败 (文件不存在)</div>'"></video>
                </div>` : ''}
                ${(sh.videoCandidates || []).length > 1 ? `
                <div>
                    <label class="text-xs" style="color:var(--text-muted)">历史版本 (${sh.videoCandidates.length})</label>
                    <div class="flex gap-2 mt-1 overflow-x-auto pb-1 pt-1" id="candidatesList" style="overflow-y:visible">
                        ${sh.videoCandidates.map((c, i) => {
                            const isActive = c.url === sh.videoUrl;
                            const label = `v${i + 1}`;
                            const date = c.createdAt ? new Date(c.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                            const settingsLabel = c.settings ? `${c.settings.model || ''} ${c.settings.duration || ''}s` : '';
                            return `<div class="flex flex-col items-center gap-1 flex-shrink-0" style="width:100px;position:relative">
                                <div class="relative cursor-pointer rounded-lg overflow-hidden" style="width:100px;height:60px;border:2px solid ${isActive ? 'var(--accent)' : 'var(--border-card)'}" data-candidate-url="${escapeHtml(c.url)}" data-candidate-path="${escapeHtml(c.path || '')}" data-candidate-source="${escapeHtml(c.sourceUrl || c.url)}" title="${escapeHtml(settingsLabel)}">
                                    <video src="${escapeHtml(resolveUrl(c.url))}" muted class="w-full h-full" style="object-fit:cover" preload="metadata" onerror="this.onerror=null;this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;font-size:10px;color:var(--text-faint)\\'>失败</div>'"></video>
                                    ${isActive ? '<div style="position:absolute;top:2px;right:2px;background:var(--accent);color:white;font-size:9px;padding:1px 4px;border-radius:4px;font-weight:700">当前</div>' : ''}
                                    ${c.settings ? '<div style="position:absolute;bottom:2px;left:2px;background:rgba(168,85,247,0.7);color:white;font-size:8px;padding:1px 3px;border-radius:3px">⚡</div>' : ''}
                                </div>
                                <span class="text-xs" style="color:var(--text-faint)">${label} ${date}</span>
                                ${settingsLabel ? `<span class="text-xs" style="color:#c084fc;font-size:9px">${escapeHtml(settingsLabel)}</span>` : ''}
                                ${!isActive ? `<button class="vid-candidate-delete" data-vid-candidate-delete="${escapeHtml(c.url)}" title="移到回收站" style="position:absolute;top:-4px;right:-2px;background:rgba(239,68,68,0.8);color:white;border:none;border-radius:50%;width:16px;height:16px;font-size:10px;line-height:16px;text-align:center;cursor:pointer;display:none;padding:0">✕</button>` : ''}
                            </div>`;
                        }).join('')}
                    </div>
                </div>` : ''}
                ${sh.status === 'running' ? `
                <div class="flex items-center gap-2 py-2">
                    <div class="spinner"></div>
                    <span class="text-xs" style="color:var(--text-muted)">视频生成中...${(sh.parallelTasks || []).filter(t => t.status === 'running').length > 0 ? ` (${(sh.parallelTasks || []).filter(t => t.status === 'running').length + 1} 个任务并行)` : ''}</span>
                </div>` : ''}
                ${sh.status === 'failed' && sh.error ? `
                <div class="text-xs p-2 rounded-lg" style="background:rgba(239,68,68,0.1);color:#fca5a5;border:1px solid rgba(239,68,68,0.2)">❌ ${escapeHtml(sh.error)}</div>` : ''}
                <div class="flex gap-2 pt-2 flex-wrap">
                    <button class="btn-primary" id="saveShortBtn">保存</button>
                    <button class="btn-secondary" id="genShotVideoBtn">
                        ${sh.status === 'running' ? '⚡ 并行生成' : (sh.status === 'succeeded' || sh.videoUrl) ? '🔄 重新生成视频' : '▶ 生成视频'}
                    </button>
                    ${state.selectedNodeIds.size > 0 ? `<button class="btn-secondary" id="genSelectedBtn" style="border-color:var(--accent);color:var(--accent-light)">▶ 生成已选 (${state.selectedNodeIds.size})</button>` : ''}
                    <button class="btn-secondary" id="regenShortBtn">🔄 重新生成提示词</button>
                    <button class="btn-danger" id="deleteShortBtn">删除</button>
                </div>
                ${renderParallelTasksHTML(sh)}
            </div>
        </div>`;

    initPresetCombos();

    $('saveShortBtn').onclick = async () => {
        sh.prompt = $('detailPrompt').value.trim();
        sh.dialogue = $('detailDialogue')?.value?.trim() || '';
        sh.narration = $('detailNarration')?.value?.trim() || '';
        sh.sceneId = $('detailScene').value || null;
        sh.duration = parseInt($('detailDuration').value);
        sh.ratio = $('detailRatio').value;
        sh.characterIds = [...document.querySelectorAll('.shortCharCheck:checked')].map(el => el.value);
        sh.propIds = [...document.querySelectorAll('.shortPropCheck:checked')].map(el => el.value);
        sh.shotType = $('detailShotType')?.value?.trim() || null;
        sh.emotion = $('detailEmotion')?.value?.trim() || null;
        sh.cameraMovement = $('detailCameraMovement')?.value?.trim() || null;
        sh.cameraAngle = $('detailCameraAngle')?.value?.trim() || null;
        sh.lighting = $('detailLightingShort')?.value?.trim() || null;
        // Advanced overrides
        const modelVal = $('detailModelOverride')?.value;
        sh.modelOverride = modelVal || null;
        const genAudioVal = $('detailGenAudioOverride')?.value;
        sh.generateAudioOverride = genAudioVal === '' ? null : genAudioVal === 'true';
        sh.watermark = $('detailWatermark')?.checked || false;
        await saveProject(proj);
        showToast('已保存', 'success');
        renderTreePanel();
        attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
    };
    $('regenShortBtn').onclick = () => onTreeRegenerate(id, 'short');
    $('genShotVideoBtn').onclick = () => onGenerateSingleShot(sh, proj);
    if ($('genSelectedBtn')) $('genSelectedBtn').onclick = () => queueShotsForGeneration([...state.selectedNodeIds], proj);
    // Picturebook mode events
    if ($('genPicturebookBtn')) {
        $('genPicturebookBtn').onclick = async () => {
            sh.picturebook = true;
            sh.picturebookStatus = 'running';
            sh.picturebookError = null;
            await saveProject(proj);
            renderDetailPanel(id, 'short');
            try {
                const imgUrl = await generateShotPicturebookImage(sh, proj);
                if (imgUrl) {
                    sh.picturebookUrl = imgUrl;
                    sh.picturebookStatus = 'succeeded';
                    showToast('绘本插画生成成功', 'success');
                } else {
                    sh.picturebookStatus = 'failed';
                    sh.picturebookError = '未返回图片';
                    showToast('绘本插画生成失败', 'error');
                }
            } catch (err) {
                sh.picturebookStatus = 'failed';
                sh.picturebookError = err.message;
                showToast(`绘本插画生成失败: ${err.message}`, 'error');
            }
            await saveProject(proj);
            renderDetailPanel(id, 'short');
            renderTreePanel();
            attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
        };
    }
    if ($('picturebookUploadInput')) {
        $('picturebookUploadInput').onchange = async (e) => {
            const file = e.target.files[0]; if (!file) return;
            showToast('上传中...', 'info');
            const asset = await saveProjectImageAsset(proj, file, 'picturebook', `${sh.id}-pb-${Date.now()}`);
            if (asset) {
                sh.picturebook = true;
                sh.picturebookUrl = asset.url;
                sh.picturebookPath = asset.path;
                sh.picturebookStatus = 'succeeded';
                await saveProject(proj);
                showToast('绘本插画上传成功', 'success');
                renderDetailPanel(id, 'short');
                renderTreePanel();
                attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
            }
        };
    }
    if ($('removePicturebookBtn')) {
        $('removePicturebookBtn').onclick = async () => {
            sh.picturebook = false;
            sh.picturebookUrl = null;
            sh.picturebookPath = null;
            sh.picturebookStatus = null;
            sh.picturebookError = null;
            await saveProject(proj);
            renderDetailPanel(id, 'short');
            renderTreePanel();
            attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
            showToast('已移除绘本插画', 'success');
        };
    }
    // Candidate selection & deletion
    if ($('candidatesList')) {
        // Show/hide delete button on hover
        $('candidatesList').querySelectorAll('.flex-shrink-0').forEach(wrapper => {
            const delBtn = wrapper.querySelector('.vid-candidate-delete');
            if (delBtn) {
                wrapper.onmouseenter = () => delBtn.style.display = '';
                wrapper.onmouseleave = () => delBtn.style.display = 'none';
            }
        });
        $('candidatesList').querySelectorAll('[data-candidate-url]').forEach(el => {
            el.onclick = async () => {
                selectVideoCandidate(sh, el.dataset.candidateUrl);
                await saveProject(proj);
                renderDetailPanel(id, 'short');
                renderTreePanel();
                attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
                showToast('已切换视频版本', 'success');
            };
        });
        $('candidatesList').querySelectorAll('[data-vid-candidate-delete]').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                deleteVideoCandidate(proj, sh, btn.dataset.vidCandidateDelete);
                await saveProject(proj);
                renderDetailPanel(id, 'short');
                renderTreePanel();
                attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
                showToast('已移到回收站', 'info');
            };
        });
    }
    $('deleteShortBtn').onclick = async () => {
        if (!confirm('确定删除此短片？')) return;
        proj.shorts = proj.shorts.filter(x => x.id !== id);
        proj.shorts.forEach((s, i) => s.order = i + 1);
        state.selectedNodeId = null;
        await saveProject(proj);
        renderBreakdown();
    };
    if ($('clearParallelTasksBtn')) {
        $('clearParallelTasksBtn').onclick = async () => {
            sh.parallelTasks = [];
            await saveProject(proj);
            renderDetailPanel(id, 'short');
            showToast('已清除并行记录', 'info');
        };
    }
    document.querySelectorAll('.removeExtraRefBtn').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            if (sh.imageUrls) sh.imageUrls.splice(idx, 1);
            if (sh.imagePaths) sh.imagePaths.splice(idx, 1);
            await saveProject(proj);
            renderDetailPanel(id, 'short');
        };
    });
    $('shortImageInput').onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        showToast('上传中...', 'info');
        const asset = await saveProjectImageAsset(proj, file, 'shorts', `${sh.id}-${Date.now()}`);
        if (asset) {
            sh.imageUrls = sh.imageUrls || [];
            sh.imagePaths = sh.imagePaths || [];
            sh.imageUrls.push(asset.url);
            sh.imagePaths.push(asset.path);
            // Mutually exclusive: clear keyframes when adding reference images
            if (sh.firstFrameUrl || sh.lastFrameUrl) {
                sh.firstFrameUrl = null;
                sh.lastFrameUrl = null;
                showToast('参考图已添加，首尾帧已清除', 'info');
            }
            await saveProject(proj);
            renderDetailPanel(id, 'short');
        }
    };
    // Reference video upload (video-to-video)
    const shortVideoInput = $('shortVideoInput');
    if (shortVideoInput) {
        shortVideoInput.onchange = async (e) => {
            const file = e.target.files[0]; if (!file) return;
            if (file.size > 50 * 1024 * 1024) { showToast('视频文件不能超过 50MB', 'error'); return; }
            showToast('视频上传中...', 'info');
            const url = await uploadTempVideo(file);
            if (url) {
                sh.referenceVideoUrl = url;
                await saveProject(proj);
                showToast('参考视频上传成功', 'success');
                renderDetailPanel(id, 'short');
            }
        };
    }
    const removeRefVideoBtn = $('removeRefVideoBtn');
    if (removeRefVideoBtn) {
        removeRefVideoBtn.onclick = async () => {
            sh.referenceVideoUrl = null;
            await saveProject(proj);
            renderDetailPanel(id, 'short');
            showToast('已移除参考视频', 'info');
        };
    }
    // First frame upload
    const firstFrameInput = $('firstFrameInput');
    if (firstFrameInput) {
        firstFrameInput.onchange = async (e) => {
            const file = e.target.files[0]; if (!file) return;
            showToast('上传首帧中...', 'info');
            const url = await uploadTempImage(file);
            if (url) {
                sh.firstFrameUrl = url;
                // Mutually exclusive: clear extra reference images
                if (sh.imageUrls && sh.imageUrls.length) {
                    sh.imageUrls = [];
                    sh.imagePaths = [];
                }
                await saveProject(proj);
                showToast('首帧上传成功 (参考图已清除)', 'success');
                renderDetailPanel(id, 'short');
            }
        };
    }
    const removeFirstFrameBtn = $('removeFirstFrameBtn');
    if (removeFirstFrameBtn) {
        removeFirstFrameBtn.onclick = async () => {
            sh.firstFrameUrl = null;
            await saveProject(proj);
            renderDetailPanel(id, 'short');
        };
    }
    // Last frame upload
    const lastFrameInput = $('lastFrameInput');
    if (lastFrameInput) {
        lastFrameInput.onchange = async (e) => {
            const file = e.target.files[0]; if (!file) return;
            showToast('上传尾帧中...', 'info');
            const url = await uploadTempImage(file);
            if (url) {
                sh.lastFrameUrl = url;
                // Mutually exclusive: clear extra reference images
                if (sh.imageUrls && sh.imageUrls.length) {
                    sh.imageUrls = [];
                    sh.imagePaths = [];
                }
                await saveProject(proj);
                showToast('尾帧上传成功 (参考图已清除)', 'success');
                renderDetailPanel(id, 'short');
            }
        };
    }
    const removeLastFrameBtn = $('removeLastFrameBtn');
    if (removeLastFrameBtn) {
        removeLastFrameBtn.onclick = async () => {
            sh.lastFrameUrl = null;
            await saveProject(proj);
            renderDetailPanel(id, 'short');
        };
    }
    // Audio reference upload
    const shortAudioInput = $('shortAudioInput');
    if (shortAudioInput) {
        shortAudioInput.onchange = async (e) => {
            const file = e.target.files[0]; if (!file) return;
            if (!file.type.startsWith('audio/')) { showToast('请上传音频文件', 'error'); return; }
            if (file.size > 15 * 1024 * 1024) { showToast('音频文件不能超过 15MB', 'error'); return; }
            showToast('音频上传中...', 'info');
            const url = await uploadTempAudio(file);
            if (url) {
                sh.audioUrls = sh.audioUrls || [];
                sh.audioUrls.push(url);
                await saveProject(proj);
                showToast('音频上传成功', 'success');
                renderDetailPanel(id, 'short');
            }
        };
    }
    // Audio remove buttons
    (sh.audioUrls || []).forEach((_, i) => {
        const btn = $(`removeAudio${i}`);
        if (btn) {
            btn.onclick = async (e) => {
                e.stopPropagation();
                sh.audioUrls.splice(i, 1);
                await saveProject(proj);
                renderDetailPanel(id, 'short');
            };
        }
    });
    attachBreadcrumbEvents(panel);
}

function renderFolderDetail(panel, proj, folderId, nodeType) {
    const folder = (proj.folders || []).find(f => f.id === folderId);
    if (!folder) return;
    const category = folder.category || getCategoryFromType(nodeType);
    const catLabel = CATEGORY_LABELS[category] || '';
    const folderItems = category === 'shorts'
        ? proj[category].filter(x => x.folderId === folderId).sort((a, b) => a.order - b.order)
        : proj[category].filter(x => x.folderId === folderId);
    const itemType = getItemType(category);
    const groupInfo = {
        characters: { groupId: 'characters-group', groupType: 'characters-group', icon: '👥', label: '角色' },
        props:      { groupId: 'props-group',      groupType: 'props-group',      icon: '🎒', label: '道具' },
        scenes:     { groupId: 'scenes-group',      groupType: 'scenes-group',      icon: '🎬', label: '场景' },
        shorts:     { groupId: 'shorts-group',      groupType: 'shorts-group',      icon: '📋', label: '分镜' },
    }[category];

    const iconMap = { characters: '👤', props: '🎒', scenes: '🎬', shorts: '📋' };
    const icon = iconMap[category] || '📄';
    const isWide = (category === 'scenes' || category === 'shorts');

    function folderItemCard(item) {
        if (category === 'shorts') return shortFolderCard(item, proj);
        const hasImg = !!item.imageUrl;
        return `<div class="asset-card${isWide ? ' asset-card-wide' : ''}" data-folder-item-id="${escapeHtml(item.id)}">
            <div class="asset-card-thumb${isWide ? ' asset-card-thumb-wide' : ''}">
                ${hasImg
                    ? `<img src="${escapeHtml(resolveUrl(item.imageUrl))}" alt="${escapeHtml(item.name || '')}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="asset-card-placeholder" style="display:none">${icon}</div>`
                    : `<div class="asset-card-placeholder">${icon}</div>`}
            </div>
            <div class="asset-card-info">
                <div class="asset-card-name">${escapeHtml(item.name || '(未命名)')}</div>
                ${item.description ? `<div class="asset-card-desc">${escapeHtml(item.description.slice(0, 50))}${item.description.length > 50 ? '…' : ''}</div>` : ''}
            </div>
        </div>`;
    }

    panel.innerHTML = `<div class="asset-gallery fade-in">
        <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-semibold flex items-center gap-1">
                ${groupInfo ? `<span class="detail-breadcrumb-back" data-bc-group="${groupInfo.groupId}" data-bc-type="${groupInfo.groupType}">${groupInfo.icon} ${groupInfo.label}</span><span style="color:var(--text-faint)">›</span>` : ''}
                <span>📁 ${escapeHtml(folder.name)} (${folderItems.length})</span>
            </h3>
            <div class="flex gap-2 flex-wrap items-center">
                <button class="btn-secondary text-xs" id="addItemToFolderBtn">+ 添加${catLabel}</button>
                <button class="btn-secondary text-xs" id="cloneFolderBtn">📋 克隆</button>
                <button class="btn-secondary text-xs" id="renameFolderBtn">✏️ 重命名</button>
                <button class="btn-danger text-xs" id="deleteFolderBtn">删除</button>
            </div>
        </div>
        ${folderItems.length > 0
            ? `<div class="asset-gallery-grid${isWide ? ' asset-gallery-grid-wide' : ''}">${folderItems.map(s => folderItemCard(s)).join('')}</div>`
            : `<div class="flex items-center justify-center py-12" style="color:var(--text-faint)">文件夹为空，点击"+ 添加${catLabel}"</div>`}
    </div>`;

    // Breadcrumb back to group gallery
    if (groupInfo) attachBreadcrumbEvents(panel);

    // Click cards to open item detail
    panel.querySelectorAll('[data-folder-item-id]').forEach(el => {
        el.onclick = () => {
            const id = el.dataset.folderItemId;
            state.selectedNodeId = id;
            state.selectedNodeType = itemType;
            renderTreePanel();
            attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
            renderDetailPanel(id, itemType);
        };
    });

    if ($('addItemToFolderBtn')) $('addItemToFolderBtn').onclick = () => addItemToCategory(category, folderId);
    if ($('cloneFolderBtn')) $('cloneFolderBtn').onclick = () => cloneFolderGeneric(folderId, category);
    if ($('renameFolderBtn')) $('renameFolderBtn').onclick = () => renameFolderGeneric(folderId);
    if ($('deleteFolderBtn')) $('deleteFolderBtn').onclick = () => deleteFolderGeneric(folderId, category);
}

/** Short card used in folder detail view */
function shortFolderCard(sh, proj) {
    const scene = proj.scenes.find(sc => sc.id === sh.sceneId);
    const thumbUrl = sh.videoUrl || sh.picturebookUrl || (sh.imageUrls && sh.imageUrls[0]) || sh.firstFrameUrl || (scene && scene.imageUrl);
    const hasThumb = !!thumbUrl;
    const isVideo = !!sh.videoUrl;
    const statusMap = { pending: { cls: 'status-pending', text: '待处理' }, running: { cls: 'status-running', text: '生成中' }, succeeded: { cls: 'status-succeeded', text: '已完成' }, failed: { cls: 'status-failed', text: '失败' } };
    const statusInfo = statusMap[sh.status] || statusMap.pending;
    const meta = [sh.shotType, sh.emotion, sh.cameraMovement].filter(Boolean);

    return `<div class="asset-card asset-card-wide" data-folder-item-id="${escapeHtml(sh.id)}">
        <div class="asset-card-thumb asset-card-thumb-wide" style="position:relative">
            ${hasThumb
                ? (isVideo
                    ? `<video src="${escapeHtml(resolveUrl(thumbUrl))}" muted preload="metadata" style="width:100%;height:100%;object-fit:cover" onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>`
                    : `<img src="${escapeHtml(resolveUrl(thumbUrl))}" alt="#${sh.order}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="asset-card-placeholder" style="display:none">📋</div>`)
                : `<div class="asset-card-placeholder">📋</div>`}
            <div style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.6);color:white;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px">#${sh.order}</div>
            <div style="position:absolute;top:4px;right:4px"><span class="status-badge ${statusInfo.cls}" style="font-size:10px;padding:1px 6px">${statusInfo.text}</span></div>
            ${sh.duration ? `<div style="position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,0.6);color:white;font-size:10px;padding:1px 5px;border-radius:3px">${sh.duration}s</div>` : ''}
        </div>
        <div class="asset-card-info">
            ${meta.length ? `<div class="asset-card-meta">${meta.map(m => `<span class="shot-meta-tag" style="font-size:10px">${escapeHtml(m)}</span>`).join('')}</div>` : ''}
            ${sh.prompt ? `<div class="asset-card-desc">${escapeHtml(sh.prompt.slice(0, 60))}${sh.prompt.length > 60 ? '…' : ''}</div>` : ''}
        </div>
    </div>`;
}

function renderGroupDetail(panel, groupName, count, unit, nodeId, nodeType) {
    const proj = state.currentProject;
    // Count missing images
    let missingCount = 0;
    if (nodeType === 'characters-group') {
        missingCount = proj.characters.filter(c => !c.imageUrl && c.description).length;
    } else if (nodeType === 'props-group') {
        missingCount = proj.props.filter(p => !p.imageUrl && p.description).length;
    } else if (nodeType === 'scenes-group') {
        missingCount = proj.scenes.filter(s => !s.imageUrl && s.description).length;
    }
    const showGenMissing = (nodeType === 'characters-group' || nodeType === 'props-group' || nodeType === 'scenes-group') && missingCount > 0;

    panel.innerHTML = `
        <div class="card-flat p-4 fade-in">
            <h3 class="text-base font-semibold mb-3">${groupName}</h3>
            <p class="text-sm" style="color:var(--text-muted)">共 ${count} ${unit}${showGenMissing ? `，其中 ${missingCount} 个缺少图片` : ''}</p>
            <div class="flex gap-2 mt-4 flex-wrap">
                <button class="btn-secondary" id="regenGroupBtn">🔄 重新生成全部${groupName}</button>
                ${showGenMissing ? `<button class="btn-secondary" id="genMissingImgBtn">🎨 自动生成缺失图片 (${missingCount})</button>` : ''}
                ${nodeType === 'characters-group' ? '<button class="btn-secondary" id="addItemBtn">+ 添加角色</button>' : ''}
                ${nodeType === 'props-group' ? '<button class="btn-secondary" id="addItemBtn">+ 添加道具</button>' : ''}
                ${nodeType === 'scenes-group' ? '<button class="btn-secondary" id="addItemBtn">+ 添加场景</button>' : ''}
                ${nodeType === 'shorts-group' ? '<button class="btn-secondary" id="addItemBtn">+ 添加短片</button>' : ''}
                <button class="btn-secondary" id="addFolderBtn">📁 新建文件夹</button>
            </div>
            <div id="genMissingProgress" class="hidden mt-3 card-flat" style="padding:10px;font-size:12px;line-height:1.6;color:var(--text-secondary);max-height:200px;overflow-y:auto"></div>
        </div>`;

    $('regenGroupBtn').onclick = () => onTreeRegenerate(nodeId, nodeType);

    if ($('genMissingImgBtn')) {
        $('genMissingImgBtn').onclick = () => generateMissingImages(nodeType, proj);
    }

    if ($('addItemBtn')) $('addItemBtn').onclick = async () => {
        if (nodeType === 'characters-group') {
            const c = { id: crypto.randomUUID(), name: '新角色', description: '', imageUrl: null, imagePath: null, anchorImageUrl: null, anchorVerified: false, designPrompt: null, visualTraits: null };
            proj.characters.push(c);
            state.selectedNodeId = c.id; state.selectedNodeType = 'character';
        } else if (nodeType === 'props-group') {
            const p = { id: crypto.randomUUID(), name: '新道具', description: '', imageUrl: null, imagePath: null, anchorImageUrl: null, anchorVerified: false, designPrompt: null };
            proj.props.push(p);
            state.selectedNodeId = p.id; state.selectedNodeType = 'prop';
        } else if (nodeType === 'scenes-group') {
            const s = { id: crypto.randomUUID(), name: '新场景', description: '', imageUrl: null, imagePath: null, lighting: null, timeOfDay: null, weather: null, mood: null };
            proj.scenes.push(s);
            state.selectedNodeId = s.id; state.selectedNodeType = 'scene';
        } else if (nodeType === 'shorts-group') {
            const order = proj.shorts.length + 1;
            const s = { id: crypto.randomUUID(), order, folderId: null, sceneId: null, characterIds: [], prompt: '', duration: proj.settings.defaultDuration, ratio: proj.settings.ratio, imageUrls: [], imagePaths: [], taskId: null, status: 'pending', videoUrl: null, videoPath: null, sourceVideoUrl: null, referenceVideoUrl: null, firstFrameUrl: null, lastFrameUrl: null, audioUrls: [], modelOverride: null, generateAudioOverride: null, watermark: false, error: null, shotType: null, cameraMovement: null, cameraAngle: null, lighting: null, emotion: null, stableVariables: null, enhanced: false, picturebook: false, picturebookUrl: null, picturebookPath: null, picturebookStatus: null, picturebookTaskId: null, picturebookError: null, videoCandidates: [] };
            proj.shorts.push(s);
            state.selectedNodeId = s.id; state.selectedNodeType = 'short';
        }
        await saveProject(proj);
        renderBreakdown();
    };

    if ($('addFolderBtn')) {
        const category = getCategoryFromType(nodeType);
        $('addFolderBtn').onclick = () => createFolderForCategory(category);
    }
}

// ============ Auto-generate Missing Images ============
async function generateMissingImages(nodeType, proj) {
    const btn = $('genMissingImgBtn');
    const progress = $('genMissingProgress');
    if (!btn || !progress) return;

    let items;
    let genFn;
    let itemLabel;

    if (nodeType === 'characters-group') {
        items = proj.characters.filter(c => !c.imageUrl && c.description);
        genFn = generateCharacterImage;
        itemLabel = '角色';
    } else if (nodeType === 'props-group') {
        items = proj.props.filter(p => !p.imageUrl && p.description);
        genFn = generatePropImage;
        itemLabel = '道具';
    } else if (nodeType === 'scenes-group') {
        items = proj.scenes.filter(s => !s.imageUrl && s.description);
        genFn = generateSceneImage;
        itemLabel = '场景';
    } else {
        return;
    }

    if (items.length === 0) {
        showToast('没有需要生成图片的项目', 'info');
        return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ 生成中...';
    progress.classList.remove('hidden');
    progress.innerHTML = '';

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const logLine = document.createElement('div');
        logLine.textContent = `[${i + 1}/${items.length}] 正在生成${itemLabel} "${item.name}" 的图片...`;
        progress.appendChild(logLine);
        progress.scrollTop = progress.scrollHeight;

        try {
            const url = await genFn(item.description, proj);
            if (url) {
                addImageCandidate(item, url);
                await saveProject(proj);
                logLine.innerHTML = `<span style="color:#6ee7b7">✅ [${i + 1}/${items.length}] ${escapeHtml(item.name)} — 已生成</span>`;
                succeeded++;
            } else {
                logLine.innerHTML = `<span style="color:#fca5a5">❌ [${i + 1}/${items.length}] ${escapeHtml(item.name)} — 未返回结果</span>`;
                failed++;
            }
        } catch (err) {
            logLine.innerHTML = `<span style="color:#fca5a5">❌ [${i + 1}/${items.length}] ${escapeHtml(item.name)} — ${escapeHtml(err.message)}</span>`;
            failed++;
        }
        progress.scrollTop = progress.scrollHeight;
    }

    const summary = document.createElement('div');
    summary.style.cssText = 'margin-top:6px;font-weight:600';
    summary.textContent = `完成: ${succeeded} 成功, ${failed} 失败`;
    progress.appendChild(summary);
    progress.scrollTop = progress.scrollHeight;

    btn.disabled = false;
    btn.textContent = '🎨 自动生成缺失图片';
    showToast(`图片生成完成: ${succeeded} 成功, ${failed} 失败`, succeeded > 0 ? 'success' : 'error');

    // Refresh tree and detail panel
    renderTreePanel();
    attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
    if (state.selectedNodeId) renderDetailPanel(state.selectedNodeId, state.selectedNodeType);
}

async function generateAllMissingImages(proj) {
    const missingChars = proj.characters.filter(c => !c.imageUrl && c.description);
    const missingProps = proj.props.filter(p => !p.imageUrl && p.description);
    const missingScenes = proj.scenes.filter(s => !s.imageUrl && s.description);
    const total = missingChars.length + missingProps.length + missingScenes.length;
    if (total === 0) { showToast('没有需要生成图片的项目', 'info'); return; }

    const btn = $('genAllMissingBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.3);border-top-color:white"></div> 生成中...'; }

    let succeeded = 0, failed = 0, idx = 0;

    for (const c of missingChars) {
        idx++;
        if (btn) btn.innerHTML = `⏳ ${idx}/${total}...`;
        try {
            const url = await generateCharacterImage(c.description, proj);
            if (url) { addImageCandidate(c, url); await saveProject(proj); succeeded++; }
            else { failed++; }
        } catch (err) { console.error(`角色图片生成失败 [${c.name}]:`, err); failed++; }
    }

    for (const p of missingProps) {
        idx++;
        if (btn) btn.innerHTML = `⏳ ${idx}/${total}...`;
        try {
            const url = await generatePropImage(p.description, proj);
            if (url) { addImageCandidate(p, url); await saveProject(proj); succeeded++; }
            else { failed++; }
        } catch (err) { console.error(`道具图片生成失败 [${p.name}]:`, err); failed++; }
    }

    for (const s of missingScenes) {
        idx++;
        if (btn) btn.innerHTML = `⏳ ${idx}/${total}...`;
        try {
            const url = await generateSceneImage(s.description, proj);
            if (url) { addImageCandidate(s, url); await saveProject(proj); succeeded++; }
            else { failed++; }
        } catch (err) { console.error(`场景图片生成失败 [${s.name}]:`, err); failed++; }
    }

    showToast(`图片生成完成: ${succeeded} 成功, ${failed} 失败`, succeeded > 0 ? 'success' : 'error');
    renderBreakdown();
    if (state.selectedNodeId) renderDetailPanel(state.selectedNodeId, state.selectedNodeType);
}

// ============ Regeneration Modal ============
function showRegenModal(nodeId, nodeType, prompt) {
    const isGroup = nodeType.endsWith('-group');
    const labels = {
        synopsis: '重新生成概要', character: '重新生成角色', prop: '重新生成道具', scene: '重新生成场景',
        short: '重新生成短片提示词', 'characters-group': '重新生成所有角色',
        'props-group': '重新生成所有道具', 'scenes-group': '重新生成所有场景', 'shorts-group': '重新生成所有分镜'
    };
    const modal = $('editModal');
    $('editModalTitle').textContent = labels[nodeType] || '重新生成';
    $('editModalBody').innerHTML = `
        <div class="space-y-3">
            <div>
                <label class="text-xs" style="color:var(--text-muted)">AI 提示词 (可修改以自定义生成效果)</label>
                <textarea id="regenPromptInput" class="modal-input mt-1" style="min-height:200px;font-size:12px;line-height:1.5">${escapeHtml(prompt)}</textarea>
            </div>
            <p class="text-xs" style="color:var(--text-faint)">${isGroup ? '⚠️ 将重新生成此分组下的所有子节点' : '将重新生成此节点'}</p>
            <div id="regenStreamPreview" class="card-flat hidden" style="max-height:200px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace"></div>
            <div class="flex gap-2">
                <button class="btn-primary" id="doRegenBtn">🔄 生成</button>
                <button class="btn-secondary" id="cancelRegenBtn">取消</button>
            </div>
        </div>`;
    modal.classList.remove('hidden');

    $('cancelRegenBtn').onclick = () => modal.classList.add('hidden');
    $('doRegenBtn').onclick = async () => {
        const customPrompt = $('regenPromptInput').value.trim();
        const btn = $('doRegenBtn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.3);border-top-color:white"></div> 生成中...';

        const streamPreview = $('regenStreamPreview');
        streamPreview.classList.remove('hidden');
        streamPreview.textContent = '正在生成...';

        try {
            const result = await regenerateNode(nodeType, state.currentProject, nodeId, customPrompt, (text) => {
                streamPreview.textContent = text;
                streamPreview.scrollTop = streamPreview.scrollHeight;
            });
            applyRegenResult(nodeType, state.currentProject, nodeId, result);
            await saveProject(state.currentProject);
            modal.classList.add('hidden');
            showToast('重新生成完成', 'success');
            renderBreakdown();
            // Re-select the node
            if (state.selectedNodeId) renderDetailPanel(state.selectedNodeId, state.selectedNodeType);
        } catch (err) {
            showToast(`生成失败: ${err.message}`, 'error');
            btn.disabled = false;
            btn.innerHTML = '🔄 生成';
        }
    };
}

function applyRegenResult(nodeType, project, nodeId, result) {
    switch (nodeType) {
        case 'synopsis':
            if (result.synopsis) project.synopsis = result.synopsis;
            break;
        case 'character': {
            const c = project.characters.find(x => x.id === nodeId);
            if (c && result.description) c.description = result.description;
            if (c && result.name) c.name = result.name;
            break;
        }
        case 'prop': {
            const p = project.props.find(x => x.id === nodeId);
            if (p && result.description) p.description = result.description;
            if (p && result.name) p.name = result.name;
            break;
        }
        case 'scene': {
            const s = project.scenes.find(x => x.id === nodeId);
            if (s && result.description) s.description = result.description;
            if (s && result.name) s.name = result.name;
            break;
        }
        case 'short': {
            const sh = project.shorts.find(x => x.id === nodeId);
            if (sh && result.prompt) sh.prompt = result.prompt;
            if (sh && result.duration) sh.duration = result.duration;
            if (sh && result.shotType) sh.shotType = result.shotType;
            if (sh && result.cameraMovement) sh.cameraMovement = result.cameraMovement;
            if (sh && result.cameraAngle) sh.cameraAngle = result.cameraAngle;
            if (sh && result.lighting) sh.lighting = result.lighting;
            if (sh && result.emotion) sh.emotion = result.emotion;
            if (sh && result.stableVariables) sh.stableVariables = result.stableVariables;
            break;
        }
        case 'characters-group':
            if (result.characters) {
                project.characters = result.characters.map(c => ({
                    id: crypto.randomUUID(), name: c.name, description: c.description,
                    imageUrl: null, imagePath: null, anchorImageUrl: null, anchorVerified: false,
                    designPrompt: null, visualTraits: c.visualTraits || null,
                }));
                // Update short characterIds (best effort: clear them)
                project.shorts.forEach(s => { s.characterIds = []; });
            }
            break;
        case 'props-group':
            if (result.props) {
                project.props = result.props.map(p => ({
                    id: crypto.randomUUID(), name: p.name, description: p.description,
                    imageUrl: null, imagePath: null, anchorImageUrl: null, anchorVerified: false,
                    designPrompt: null,
                }));
                project.shorts.forEach(s => { s.propIds = []; });
            }
            break;
        case 'scenes-group':
            if (result.scenes) {
                project.scenes = result.scenes.map(s => ({
                    id: crypto.randomUUID(), name: s.name, description: s.description,
                    imageUrl: null, imagePath: null,
                    lighting: s.lighting || null, timeOfDay: s.timeOfDay || null,
                    weather: s.weather || null, mood: s.mood || null,
                }));
                project.shorts.forEach(s => { s.sceneId = null; });
            }
            break;
        case 'shorts-group':
            if (result.shorts) {
                project.shorts = result.shorts.slice(0, CONFIG.MAX_SHORTS).map((s, i) => {
                    const scene = project.scenes.find(sc => sc.name === s.sceneName);
                    const charIds = (s.characterNames || []).map(cn => {
                        const ch = project.characters.find(c => c.name === cn);
                        return ch?.id;
                    }).filter(Boolean);
                    const propIds = (s.propNames || []).map(pn => {
                        const p = project.props.find(pr => pr.name === pn);
                        return p?.id;
                    }).filter(Boolean);
                    return {
                        id: crypto.randomUUID(), order: s.order || (i + 1), folderId: null,
                        sceneId: scene?.id || null, characterIds: charIds, propIds,
                        prompt: s.prompt, duration: s.duration || 5,
                        ratio: project.settings.ratio, imageUrls: [], imagePaths: [],
                        taskId: null, status: 'pending', videoUrl: null, videoPath: null, sourceVideoUrl: null, referenceVideoUrl: null, firstFrameUrl: null, lastFrameUrl: null, audioUrls: [], modelOverride: null, generateAudioOverride: null, watermark: false, error: null, videoCandidates: [],
                        shotType: s.shotType || null, cameraMovement: s.cameraMovement || null,
                        cameraAngle: s.cameraAngle || null, lighting: s.lighting || null,
                        emotion: s.emotion || null, stableVariables: s.stableVariables || null,
                        enhanced: false,
                    };
                });
            }
            break;
    }
}

// ============ Video Candidates ============

/** Save current video as a candidate before regeneration */
function preserveVideoCandidate(short) {
    if (!short.videoUrl) return;
    if (!short.videoCandidates) short.videoCandidates = [];
    // Avoid duplicates
    if (short.videoCandidates.some(c => c.url === short.videoUrl)) return;
    short.videoCandidates.push({
        url: short.videoUrl,
        path: short.videoPath || null,
        sourceUrl: short.sourceVideoUrl || null,
        createdAt: new Date().toISOString(),
    });
}

/** Add a newly generated video as a candidate and set it as active */
function addVideoCandidate(short, videoUrl, videoPath) {
    if (!short.videoCandidates) short.videoCandidates = [];
    if (!short.videoCandidates.some(c => c.url === videoUrl)) {
        short.videoCandidates.push({
            url: videoUrl,
            path: videoPath || null,
            sourceUrl: videoUrl,
            createdAt: new Date().toISOString(),
        });
    }
    short.videoUrl = videoUrl;
    short.videoPath = videoPath || null;
    short.sourceVideoUrl = videoUrl;
}

/** Select a candidate as the active video */
function selectVideoCandidate(short, candidateUrl) {
    const candidate = (short.videoCandidates || []).find(c => c.url === candidateUrl);
    if (!candidate) return;
    short.videoUrl = candidate.url;
    short.videoPath = candidate.path || null;
    short.sourceVideoUrl = candidate.sourceUrl || candidate.url;
    short.status = 'succeeded';
    short.error = null;
}

/** Delete a video candidate and move it to trash */
function deleteVideoCandidate(proj, short, candidateUrl) {
    const idx = (short.videoCandidates || []).findIndex(c => c.url === candidateUrl);
    if (idx < 0) return;
    const removed = short.videoCandidates.splice(idx, 1)[0];
    if (!proj.trash) proj.trash = [];
    proj.trash.push({
        type: 'video', url: removed.url, path: removed.path || null,
        sourceUrl: removed.sourceUrl || null, createdAt: removed.createdAt || null,
        deletedAt: new Date().toISOString(), settings: removed.settings || null,
        fromId: short.id, fromName: `#${short.order}`, fromType: 'short',
    });
    // If the active video was deleted, switch to another candidate or clear
    if (short.videoUrl === removed.url) {
        const next = short.videoCandidates[0] || null;
        if (next) {
            short.videoUrl = next.url;
            short.videoPath = next.path || null;
            short.sourceVideoUrl = next.sourceUrl || next.url;
        } else {
            short.videoUrl = null; short.videoPath = null; short.sourceVideoUrl = null;
            short.status = 'pending';
        }
    }
}

/** Delete an image candidate and move it to trash */
function deleteImageCandidate(proj, item, candidateUrl, itemName, itemType) {
    const idx = (item.imageCandidates || []).findIndex(c => c.url === candidateUrl);
    if (idx < 0) return;
    const removed = item.imageCandidates.splice(idx, 1)[0];
    if (!proj.trash) proj.trash = [];
    proj.trash.push({
        type: 'image', url: removed.url, path: removed.path || null,
        sourceUrl: null, createdAt: removed.createdAt || null,
        deletedAt: new Date().toISOString(), settings: null,
        fromId: item.id, fromName: itemName || '', fromType: itemType || '',
    });
    // If the active image was deleted, switch to another candidate or clear
    if (item.imageUrl === removed.url) {
        const next = item.imageCandidates[0] || null;
        if (next) {
            item.imageUrl = next.url;
            item.imagePath = next.path || null;
        } else {
            item.imageUrl = null; item.imagePath = null;
        }
    }
}

// ============ Image Candidates ============

/** Save current image as a candidate before regeneration */
function preserveImageCandidate(item) {
    if (!item.imageUrl) return;
    if (!item.imageCandidates) item.imageCandidates = [];
    if (item.imageCandidates.some(c => c.url === item.imageUrl)) return;
    item.imageCandidates.push({
        url: item.imageUrl,
        path: item.imagePath || null,
        createdAt: new Date().toISOString(),
    });
}

/** Add a newly generated image as a candidate and set it as active */
function addImageCandidate(item, imageUrl, imagePath) {
    if (!item.imageCandidates) item.imageCandidates = [];
    if (!item.imageCandidates.some(c => c.url === imageUrl)) {
        item.imageCandidates.push({
            url: imageUrl,
            path: imagePath || null,
            createdAt: new Date().toISOString(),
        });
    }
    item.imageUrl = imageUrl;
    item.imagePath = imagePath || null;
    // Save to local disk if in local mode
    const proj = state.currentProject;
    if (proj?.localMode) {
        const name = item.name || item.id || 'image';
        saveAssetToLocal(proj, imageUrl, 'images', `${name}.png`).catch(() => {});
    }
}

/** Select a candidate as the active image */
function selectImageCandidate(item, candidateUrl) {
    const candidate = (item.imageCandidates || []).find(c => c.url === candidateUrl);
    if (!candidate) return;
    item.imageUrl = candidate.url;
    item.imagePath = candidate.path || null;
}

/** Render image candidates strip HTML */
function renderImageCandidatesHTML(item) {
    const candidates = item.imageCandidates || [];
    if (candidates.length <= 1) return '';
    return `
    <div>
        <label class="text-xs" style="color:var(--text-muted)">历史版本 (${candidates.length})</label>
        <div class="flex gap-2 mt-1 overflow-x-auto pb-1 pt-1" id="imgCandidatesList" style="overflow-y:visible">
            ${candidates.map((c, i) => {
                const isActive = c.url === item.imageUrl;
                const label = `v${i + 1}`;
                const date = c.createdAt ? new Date(c.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                const isAssetRef = typeof c.url === 'string' && c.url.startsWith('asset://');
                const assetId = isAssetRef ? c.url.replace(/^asset:\/\//, '') : '';
                return `<div class="flex flex-col items-center gap-1 flex-shrink-0" style="width:68px;position:relative">
                    <div class="cursor-pointer rounded-lg overflow-hidden" style="position:relative;width:60px;height:60px;border:2px solid ${isActive ? 'var(--accent)' : 'var(--border-card)'}" data-img-candidate-url="${escapeHtml(c.url)}" data-img-candidate-path="${escapeHtml(c.path || '')}">
                        ${isAssetRef
                            ? `<div style="display:flex;align-items:center;justify-content:center;flex-direction:column;height:100%;padding:4px;background:var(--bg-panel)"><span style="font-size:10px;color:var(--text-muted)">虚拟人像</span><span style="font-size:9px;color:var(--text-faint);max-width:52px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(assetId)}">${escapeHtml(assetId)}</span></div>`
                            : `<img src="${escapeHtml(resolveUrl(c.url))}" class="w-full h-full" style="object-fit:cover" onerror="this.onerror=null;this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;font-size:10px;color:var(--text-faint)\\'>不可预览</div>'">`}
                        ${isActive ? '<div style="position:absolute;top:2px;right:2px;background:var(--accent);color:white;font-size:9px;padding:1px 4px;border-radius:4px;font-weight:700">当前</div>' : ''}
                    </div>
                    <span class="text-xs" style="color:var(--text-faint)">${label}</span>
                    ${!isActive ? `<button class="img-candidate-delete" data-img-candidate-delete="${escapeHtml(c.url)}" title="移到回收站" style="position:absolute;top:-4px;right:-2px;background:rgba(239,68,68,0.8);color:white;border:none;border-radius:50%;width:16px;height:16px;font-size:10px;line-height:16px;text-align:center;cursor:pointer;display:none;padding:0">✕</button>` : ''}
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

/** Attach click handlers for image candidate selection */
function attachImageCandidateEvents(item, proj, nodeId, nodeType) {
    const list = $('imgCandidatesList');
    if (!list) return;
    // Show/hide delete button on hover
    list.querySelectorAll('.flex-shrink-0').forEach(wrapper => {
        const delBtn = wrapper.querySelector('.img-candidate-delete');
        if (delBtn) {
            wrapper.onmouseenter = () => delBtn.style.display = '';
            wrapper.onmouseleave = () => delBtn.style.display = 'none';
        }
    });
    list.querySelectorAll('[data-img-candidate-url]').forEach(el => {
        el.onclick = async () => {
            selectImageCandidate(item, el.dataset.imgCandidateUrl);
            await saveProject(proj);
            renderDetailPanel(nodeId, nodeType);
            renderTreePanel();
            attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
            showToast('已切换图片版本', 'success');
        };
    });
    list.querySelectorAll('[data-img-candidate-delete]').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            deleteImageCandidate(proj, item, btn.dataset.imgCandidateDelete, item.name, nodeType);
            await saveProject(proj);
            renderDetailPanel(nodeId, nodeType);
            renderTreePanel();
            attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
            showToast('已移到回收站', 'info');
        };
    });
}

// ============ Trash / 回收站 ============

function renderTrashView(panel, proj) {
    const trash = proj.trash || [];
    if (trash.length === 0) {
        panel.innerHTML = `<div class="card-flat p-4 fade-in"><h3 class="text-base font-semibold mb-3">🗑️ 回收站</h3><p class="text-xs" style="color:var(--text-faint)">回收站为空</p></div>`;
        return;
    }
    const sorted = [...trash].sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
    panel.innerHTML = `
        <div class="card-flat p-4 fade-in">
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-base font-semibold">🗑️ 回收站 (${trash.length})</h3>
                <button class="btn-danger" id="emptyTrashBtn" style="font-size:12px">清空回收站</button>
            </div>
            <div class="flex flex-wrap gap-3">
                ${sorted.map((t, i) => {
                    const isVideo = t.type === 'video';
                    const date = t.deletedAt ? new Date(t.deletedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                    const fromLabel = t.fromName ? `${t.fromType === 'short' ? '分镜' : t.fromType === 'character' ? '角色' : t.fromType === 'scene' ? '场景' : t.fromType === 'prop' ? '道具' : ''} ${t.fromName}` : '';
                    return `<div class="flex flex-col items-center gap-1" style="width:${isVideo ? '120' : '80'}px">
                        <div class="rounded-lg overflow-hidden" style="position:relative;width:${isVideo ? '120' : '72'}px;height:${isVideo ? '72' : '72'}px;border:2px solid var(--border-card);background:var(--bg-panel)">
                            ${isVideo
                                ? `<video src="${escapeHtml(resolveUrl(t.url))}" muted class="w-full h-full" style="object-fit:cover" preload="metadata" onerror="this.onerror=null;this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;font-size:10px;color:var(--text-faint)\\'>失败</div>'"></video>`
                                : (t.url && t.url.startsWith('asset://')
                                    ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:10px;color:var(--text-muted)">虚拟人像</div>`
                                    : `<img src="${escapeHtml(resolveUrl(t.url))}" class="w-full h-full" style="object-fit:cover" onerror="this.onerror=null;this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;font-size:10px;color:var(--text-faint)\\'>不可预览</div>'">`)}
                            <div style="position:absolute;top:2px;left:2px;background:rgba(0,0,0,0.6);color:white;font-size:8px;padding:1px 4px;border-radius:3px">${isVideo ? '🎬' : '🖼️'}</div>
                        </div>
                        <span class="text-xs" style="color:var(--text-faint);text-align:center;line-height:1.2">${escapeHtml(fromLabel)}</span>
                        <span class="text-xs" style="color:var(--text-faint);font-size:9px">${date}</span>
                        <button class="btn-secondary" data-trash-restore="${i}" style="font-size:10px;padding:2px 8px">恢复</button>
                    </div>`;
                }).join('')}
            </div>
        </div>`;

    $('emptyTrashBtn').onclick = async () => {
        if (!confirm(`确定清空回收站？(${trash.length} 个项目将永久删除)`)) return;
        proj.trash = [];
        await saveProject(proj);
        renderDetailPanel('trash-group', 'trash-group');
        renderTreePanel();
        attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
        showToast('回收站已清空', 'success');
    };

    panel.querySelectorAll('[data-trash-restore]').forEach(btn => {
        btn.onclick = async () => {
            const idx = parseInt(btn.dataset.trashRestore);
            const sortedItem = sorted[idx];
            if (!sortedItem) return;
            const trashIdx = trash.indexOf(sortedItem);
            if (trashIdx < 0) return;
            const removed = trash.splice(trashIdx, 1)[0];
            // Try to restore to original item
            const restoreCandidate = { url: removed.url, path: removed.path || null, sourceUrl: removed.sourceUrl || null, createdAt: removed.createdAt || null, settings: removed.settings || null };
            if (removed.type === 'video') {
                const short = proj.shorts.find(s => s.id === removed.fromId);
                if (short) {
                    if (!short.videoCandidates) short.videoCandidates = [];
                    if (!short.videoCandidates.some(c => c.url === removed.url)) {
                        short.videoCandidates.push(restoreCandidate);
                    }
                    showToast(`已恢复到 #${short.order} 的历史版本`, 'success');
                } else {
                    showToast('原分镜已不存在，已恢复到回收站外', 'warning');
                }
            } else {
                const item = [...proj.characters, ...proj.scenes, ...proj.props].find(x => x.id === removed.fromId);
                if (item) {
                    if (!item.imageCandidates) item.imageCandidates = [];
                    if (!item.imageCandidates.some(c => c.url === removed.url)) {
                        item.imageCandidates.push(restoreCandidate);
                    }
                    showToast(`已恢复到 ${item.name || '原项目'} 的历史版本`, 'success');
                } else {
                    showToast('原项目已不存在，已恢复到回收站外', 'warning');
                }
            }
            await saveProject(proj);
            renderDetailPanel('trash-group', 'trash-group');
            renderTreePanel();
            attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
        };
    });
}

// ============ Generation Queue ============

function renderQueueDropdown() {
    const dd = $('genQueueDropdown');
    if (!dd) return;
    const proj = state.currentProject;
    const queue = state.generationQueue;
    if (!queue.length) {
        dd.innerHTML = '<div class="p-3 text-xs" style="color:var(--text-muted)">队列为空</div>';
        return;
    }
    dd.innerHTML = `
        <div class="px-3 py-1 flex items-center justify-between" style="border-bottom:1px solid var(--border)">
            <span class="text-xs font-semibold" style="color:var(--text-primary)">生成队列 (${queue.length})</span>
            <button class="q-remove" id="clearQueueBtn" style="font-size:11px;color:var(--text-faint);background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:4px" title="清空队列">清空</button>
        </div>
        ${queue.map(id => {
            const sh = proj.shorts.find(s => s.id === id);
            if (!sh) return '';
            const statusIcon = sh.status === 'running' ? '⏳' : sh.status === 'succeeded' ? '✅' : sh.status === 'failed' ? '❌' : '⏸️';
            const canRemove = sh.status !== 'running';
            return `<div class="gen-queue-item">
                <span class="q-order">#${sh.order}</span>
                <span class="q-status">${statusIcon}</span>
                <span class="q-prompt">${escapeHtml(truncate(sh.prompt || '(无提示词)', 40))}</span>
                ${canRemove ? `<button class="q-remove" data-queue-remove="${id}" title="移除">✕</button>` : ''}
            </div>`;
        }).join('')}
    `;
    // Wire remove buttons
    dd.querySelectorAll('[data-queue-remove]').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const removeId = btn.dataset.queueRemove;
            const sh = proj.shorts.find(s => s.id === removeId);
            if (sh && sh.status === 'pending') {
                const lastCandidate = (sh.videoCandidates || []).at(-1);
                if (lastCandidate) {
                    sh.videoUrl = lastCandidate.url;
                    sh.videoPath = lastCandidate.path || null;
                    sh.sourceVideoUrl = lastCandidate.sourceUrl || lastCandidate.url;
                    sh.status = 'succeeded';
                    sh.error = null;
                } else {
                    sh.status = 'failed';
                    sh.error = '已从队列移除';
                }
            }
            state.generationQueue = state.generationQueue.filter(id => id !== removeId);
            if (state.generationQueue.length === 0 && !proj.shorts.some(s => s.status === 'running')) {
                proj.status = 'editing';
            }
            await saveProject(proj);
            renderBreakdown();
        };
    });
    if ($('clearQueueBtn')) {
        $('clearQueueBtn').onclick = async (e) => {
            e.stopPropagation();
            state.generationQueue.forEach(id => {
                const sh = proj.shorts.find(s => s.id === id);
                if (sh && sh.status === 'pending') {
                    const lastCandidate = (sh.videoCandidates || []).at(-1);
                    if (lastCandidate) {
                        sh.videoUrl = lastCandidate.url;
                        sh.videoPath = lastCandidate.path || null;
                        sh.sourceVideoUrl = lastCandidate.sourceUrl || lastCandidate.url;
                        sh.status = 'succeeded';
                        sh.error = null;
                    } else {
                        sh.status = 'failed';
                        sh.error = '已从队列移除';
                    }
                }
            });
            state.generationQueue = [];
            if (!proj.shorts.some(s => s.status === 'running')) {
                proj.status = 'editing';
            }
            await saveProject(proj);
            renderBreakdown();
        };
    }
}

function queueShotsForGeneration(shortIds, proj) {
    if (!state.token) { showToast('请先登录', 'error'); return; }
    const shorts = shortIds.map(id => proj.shorts.find(s => s.id === id)).filter(Boolean);
    const validShorts = shorts.filter(s => s.prompt?.trim());
    if (!validShorts.length) { showToast('所选分镜没有有效的提示词', 'error'); return; }

    for (const sh of validShorts) {
        if (state.generationQueue.includes(sh.id)) continue; // already in queue
        if (sh.status === 'running') continue; // already running
        // Preserve current video as candidate
        preserveVideoCandidate(sh);
        sh.status = 'pending';
        sh.taskId = null;
        sh.error = null;
        state.generationQueue.push(sh.id);
    }

    proj.status = 'generating';
    saveProject(proj);
    tryGenerateFromQueue(proj);
    renderBreakdown();
    showToast(`已加入生成队列: ${validShorts.length} 个分镜`, 'success');
}

async function tryGenerateFromQueue(proj) {
    const running = state.generationQueue
        .map(id => proj.shorts.find(s => s.id === id))
        .filter(s => s && s.status === 'running').length;
    if (running >= CONFIG.MAX_CONCURRENT) return;

    const pendingInQueue = state.generationQueue
        .map(id => proj.shorts.find(s => s.id === id))
        .filter(s => s && s.status === 'pending');
    const toStart = pendingInQueue.slice(0, CONFIG.MAX_CONCURRENT - running);

    for (const short of toStart) {
        try {
            short.status = 'running';
            const taskId = await submitGenVideo(short, proj);
            short.taskId = taskId;
            await saveProject(proj);
            startPolling(taskId, proj.id, async (p, updatedShort) => {
                await onQueueGenerationUpdate(p, updatedShort);
            });
            if (state.currentView === 'breakdown') renderBreakdown();
        } catch (err) {
            short.status = 'failed';
            short.error = err.message;
            await saveProject(proj);
            showToast(`短片 #${short.order} 提交失败: ${err.message}`, 'error');
        }
    }

    // Check if queue is all done
    const queuedShorts = state.generationQueue.map(id => proj.shorts.find(s => s.id === id)).filter(Boolean);
    const allDone = queuedShorts.every(s => s.status === 'succeeded' || s.status === 'failed');
    if (allDone && queuedShorts.length > 0) {
        const succeeded = queuedShorts.filter(s => s.status === 'succeeded').length;
        state.generationQueue = [];
        if (!proj.shorts.some(s => s.status === 'running' || s.status === 'pending')) {
            proj.status = succeeded > 0 ? 'completed' : 'editing';
        }
        await saveProject(proj);
        showToast(`生成完成: ${succeeded}/${queuedShorts.length} 成功`, succeeded > 0 ? 'success' : 'error');
        if (state.currentView === 'breakdown') renderBreakdown();
    }
}

async function onQueueGenerationUpdate(proj, updatedShort) {
    await saveProject(proj);
    tryGenerateFromQueue(proj);
    if (state.currentView === 'breakdown') {
        renderBreakdown();
        if (state.selectedNodeId === updatedShort?.id) {
            renderDetailPanel(updatedShort.id, 'short');
            renderTreePanel();
            attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
        }
    }
    if (state.currentView === 'generation') {
        const { renderGeneration } = await import('./generate.js');
        renderGeneration();
    }
}

// ============ Generation View ============
async function onGenerateSingleShot(short, proj) {
    if (short.status === 'running') {
        // Already running — submit as parallel task
        await submitParallelTask(short, proj);
        return;
    }
    queueShotsForGeneration([short.id], proj);
}

async function submitParallelTask(short, proj) {
    if (!state.token) { showToast('请先登录', 'error'); return; }
    if (!short.prompt?.trim()) { showToast('请先填写提示词', 'error'); return; }

    const model = short.modelOverride || proj.settings.model;
    const duration = short.duration || proj.settings.defaultDuration;
    const ratio = short.ratio || proj.settings.ratio;
    const generateAudio = short.generateAudioOverride ?? proj.settings.generateAudio;
    const watermark = short.watermark || false;

    showToast(`正在提交并行生成任务...`, 'info');

    try {
        const taskId = await submitGenVideo(short, proj);
        if (!short.parallelTasks) short.parallelTasks = [];
        const task = {
            variantIndex: short.parallelTasks.length,
            taskId,
            settings: { model, duration, ratio, generateAudio, watermark },
            status: 'running',
            error: null,
            videoUrl: null,
            createdAt: new Date().toISOString(),
        };
        short.parallelTasks.push(task);
        startPolling(taskId, proj.id, async (p, updatedShort) => {
            await saveProject(p);
            if (state.currentView === 'breakdown') {
                renderBreakdown();
                if (state.selectedNodeId === updatedShort?.id) {
                    renderDetailPanel(updatedShort.id, 'short');
                    renderTreePanel();
                    attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
                }
            }
            if (state.currentView === 'generation') {
                const { renderGeneration } = await import('./generate.js');
                renderGeneration();
            }
        });
        await saveProject(proj);
        showToast(`并行任务已提交`, 'success');
    } catch (err) {
        showToast(`并行提交失败: ${err.message}`, 'error');
    }

    if (state.currentView === 'breakdown') {
        renderBreakdown();
        renderDetailPanel(short.id, 'short');
        renderTreePanel();
        attachTreeEvents($('treeContainer'), onTreeSelect, onTreeRegenerate, onTreeContextMenu);
    }
}

// ============ Parallel Generation ============

function renderParallelTasksHTML(sh) {
    const tasks = sh.parallelTasks || [];
    if (!tasks.length) return '';
    const running = tasks.filter(t => t.status === 'running').length;
    const succeeded = tasks.filter(t => t.status === 'succeeded').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    return `
    <div class="mt-3 p-3 rounded-lg" style="background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2)">
        <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold" style="color:#c084fc">⚡ 并行生成 (${tasks.length} 个变体)</span>
            <span class="text-xs" style="color:var(--text-muted)">${running ? `⏳${running} 运行中` : ''}${succeeded ? ` ✅${succeeded} 成功` : ''}${failed ? ` ❌${failed} 失败` : ''}</span>
        </div>
        <div class="flex gap-2 flex-wrap">
            ${tasks.map((t, i) => {
                const statusIcon = t.status === 'running' ? '⏳' : t.status === 'succeeded' ? '✅' : t.status === 'failed' ? '❌' : '⏸️';
                const borderColor = t.status === 'succeeded' ? 'rgba(16,185,129,0.4)' : t.status === 'failed' ? 'rgba(239,68,68,0.4)' : t.status === 'running' ? 'rgba(99,102,241,0.4)' : 'var(--border-card)';
                return `<div class="p-2 rounded-lg text-xs flex flex-col gap-1" style="background:var(--bg-card);border:1px solid ${borderColor};min-width:120px">
                    <div class="flex items-center gap-1 font-semibold" style="color:var(--text-primary)">${statusIcon} 变体 ${i + 1}</div>
                    <div style="color:var(--text-muted)">${escapeHtml(t.settings?.model || '-')}</div>
                    <div style="color:var(--text-muted)">${t.settings?.duration || '-'}s · ${escapeHtml(t.settings?.ratio || '-')}</div>
                    ${t.status === 'succeeded' && t.videoUrl ? `<video src="${escapeHtml(resolveUrl(t.videoUrl))}" muted class="w-full rounded mt-1 cursor-pointer" style="max-height:80px;object-fit:cover" data-play-url="${escapeHtml(t.videoUrl)}" preload="metadata"></video>` : ''}
                    ${t.status === 'failed' && t.error ? `<div style="color:#fca5a5;font-size:10px">${escapeHtml(t.error).slice(0, 60)}</div>` : ''}
                </div>`;
            }).join('')}
        </div>
        ${tasks.every(t => t.status === 'succeeded' || t.status === 'failed') ? `<button class="btn-secondary text-xs mt-2" id="clearParallelTasksBtn">清除并行记录</button>` : ''}
    </div>`;
}
