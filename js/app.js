// ============ App Entry Point ============

import { state, sdk, setLoggedOut } from './state.js';
import { CONFIG } from './config.js';
import { showToast, $ } from './utils.js';
import { navigateTo } from './views.js';
import { stopPolling } from './api.js';
import { initHelp, hideHelpModal, maybeShowHelpOnFirstUse } from './help.js';
import { showSettingsModal, hideSettingsModal, initGlobalSettings } from './global_settings.js';
import { showNewProjectModal } from './newproject.js';
import { undoProject, redoProject, setUndoRedoCallback, clearUndoRedo, saveProject, saveProjectSilent, enableLocalMode, disableLocalMode, reattachLocalDir, syncProjectFileToLocal } from './storage.js';
import { showImportProjectModal } from './import.js';
import { showExportProjectModal } from './export.js';
import { showStatsModal, attachStatsHover } from './stats.js';
import { initBuiltinPresets } from './prompts.js';
import { initHoverPreview } from './hoverPreview.js';
import { initImageClipboard } from './imageClipboard.js';

let workspaceViewerInstance = null;

function closeFileMenu() { $('fileMenuDropdown').classList.remove('open'); }

// ============ Mobile Helpers ============
function isMobile() { return window.innerWidth <= 768; }

function closeMobileSidebar() {
    document.body.classList.remove('mobile-sidebar-open');
    $('mobileSidebarOverlay')?.classList.remove('open');
}

function toggleMobileSidebar() {
    const isOpen = document.body.classList.toggle('mobile-sidebar-open');
    const overlay = $('mobileSidebarOverlay');
    if (overlay) overlay.classList.toggle('open', isOpen);
}

// ============ Theme ============
function applyTheme(isLight) {
    document.body.classList.toggle('light', isLight);
    localStorage.setItem('aimm_theme', isLight ? 'light' : 'dark');
}

function toggleTheme() {
    applyTheme(!document.body.classList.contains('light'));
}

// ============ Auth ============
async function handleAuth() {
    if (state.token) {
        setLoggedOut(true);
        Object.keys(state.pollingIntervals).forEach(id => stopPolling(id));
        state.projects = [];
        state.currentProject = null;
        destroyWorkspaceViewer();
        try { await sdk.logout(); } catch (_) {}
        $('userName').textContent = '';
        navigateTo('projectList');
        showToast('已退出', 'info');
    } else {
        try {
            setLoggedOut(false);
            await sdk.showLoginWindow({ title: 'Keepwork 登录' });
            await refreshAuthUI();
            if (state.token) {
                navigateTo('projectList');
                showToast('登录成功', 'success');
            }
        } catch (e) { console.error('Login error:', e); }
    }
}

async function refreshAuthUI() {
    if (state.token) {
        try {
            const profile = await sdk.getUserProfile({ useCache: false });
            const user = profile || sdk.user || {};
            const name = user.nickname || user.username || '用户';
            const initial = (name[0] || '?').toUpperCase();
            $('userName').textContent = name;
            const avatarEl = $('userAvatar');
            if (user.portrait) {
                avatarEl.innerHTML = `<img src="${user.portrait}" alt="">`;
            } else {
                avatarEl.textContent = initial;
            }
            $('userProfileBtn').classList.remove('hidden');
            $('menuWorkspaceBtn').classList.remove('disabled');
            $('loginBtn').classList.add('hidden');
        } catch (e) {
            // Token invalid (401) — treat as logged out
            console.warn('[AIMM] Token invalid, clearing session:', e.message || e);
            setLoggedOut(true);
            try { await sdk.logout(); } catch (_) {}
            $('userName').textContent = '';
            $('userProfileBtn').classList.add('hidden');
            $('menuWorkspaceBtn').classList.add('disabled');
            $('loginBtn').classList.remove('hidden');
        }
    } else {
        $('userName').textContent = '';
        $('userProfileBtn').classList.add('hidden');
        $('menuWorkspaceBtn').classList.add('disabled');
        $('loginBtn').classList.remove('hidden');
    }
}

function destroyWorkspaceViewer() {
    if (workspaceViewerInstance && typeof workspaceViewerInstance.destroy === 'function') {
        workspaceViewerInstance.destroy();
    }
    workspaceViewerInstance = null;
}

function closeWorkspaceViewer() {
    $('workspaceViewerModal').classList.add('hidden');
    destroyWorkspaceViewer();
}

function openWorkspaceViewer() {
    if (!state.token) {
        showToast('请先登录', 'error');
        return;
    }
    const modal = $('workspaceViewerModal');
    const host = $('workspaceViewerHost');
    if (!modal || !host) return;

    destroyWorkspaceViewer();
    if (!host || typeof window.createWorkspaceViewer !== 'function') {
        showToast('WorkspaceViewer 不可用', 'error');
        return;
    }

    modal.classList.remove('hidden');

    workspaceViewerInstance = window.createWorkspaceViewer({
        container: host,
        workspace: CONFIG.PROJECT_WORKSPACE,
        hideTopbar: true,
        hideUserInfo: true,
        compact: true,
    });
}

function toggleProfileDropdown() {
    const dd = $('profileDropdown');
    if (!dd.classList.contains('hidden')) {
        dd.classList.add('hidden');
        return;
    }
    const user = sdk.user || {};
    const name = user.nickname || user.username || '用户';
    dd.innerHTML = `
        <div class="profile-item" id="profileOpenProfile">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            会员与用户信息
        </div>
        <div class="profile-divider"></div>
        <div class="profile-item" id="profileLogout" style="color:#f87171">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            退出登录
        </div>
    `;
    dd.classList.remove('hidden');
    dd.querySelector('#profileOpenProfile').onclick = async () => {
        dd.classList.add('hidden');
        try {
            const result = await sdk.showProfileWindow();
            if (result && result.action === 'logout') handleAuth();
            else if (sdk.token) await sdk.getUserProfile({ forceRefresh: true });
        } catch (e) { console.error('ProfileWindow error:', e); }
    };
    dd.querySelector('#profileLogout').onclick = () => {
        dd.classList.add('hidden');
        handleAuth();
    };
}

// ============ Modal Helpers ============
function hideEditModal() { $('editModal').classList.add('hidden'); }
function hideVideoModal() {
    const video = $('videoPreview');
    video.pause(); video.src = '';
    $('videoModal').classList.add('hidden');
}

// ============ Init ============
async function init() {
    const savedTheme = localStorage.getItem('aimm_theme');
    applyTheme(savedTheme ? savedTheme === 'light' : false);

    // Load built-in prompt presets from AIMovieMakerWorkspace/prompts/*.md.
    // Must run before any getPrompt() call (which is synchronous).
    try { await initBuiltinPresets(); } catch (e) { console.warn('[init] initBuiltinPresets failed:', e); }

    // Load global settings (API keys + model defaults) before any API call.
    try { await initGlobalSettings(); } catch (e) { console.warn('[init] initGlobalSettings failed:', e); }

    // Wire up sidebar buttons
    $('themeBtn').onclick = toggleTheme;
    $('homeBtn').onclick = () => {
        destroyWorkspaceViewer();
        navigateTo('projectList');
    };

    // Undo / Redo
    function updateUndoRedoButtons(canUndo, canRedo) {
        $('undoBtn').disabled = !canUndo;
        $('redoBtn').disabled = !canRedo;
    }
    setUndoRedoCallback(updateUndoRedoButtons);

    async function performUndo() {
        const restored = undoProject();
        if (restored) {
            await saveProjectSilent(restored);
            navigateTo(state.currentView);
            showToast('已撤销', 'info');
        }
    }
    async function performRedo() {
        const restored = redoProject();
        if (restored) {
            await saveProjectSilent(restored);
            navigateTo(state.currentView);
            showToast('已重做', 'info');
        }
    }
    $('undoBtn').onclick = performUndo;
    $('redoBtn').onclick = performRedo;

    // Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            if (state.currentProject && !e.target.closest('input, textarea, [contenteditable]')) {
                e.preventDefault();
                performUndo();
            }
        }
        if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
            if (state.currentProject && !e.target.closest('input, textarea, [contenteditable]')) {
                e.preventDefault();
                performRedo();
            }
        }
    });
    $('sidebarBreakdownBtn').onclick = () => {
        if (state.currentProject) navigateTo('breakdown');
        else showToast('请先打开一个项目', 'info');
    };
    $('sidebarGenerateBtn').onclick = () => {
        if (state.currentProject) navigateTo('generation');
        else showToast('请先打开一个项目', 'info');
    };
    $('sidebarPreviewBtn').onclick = () => {
        if (state.currentProject) navigateTo('preview');
        else showToast('请先打开一个项目', 'info');
    };
    $('sidebarClipEditorBtn').onclick = () => {
        if (state.currentProject) navigateTo('clipEditor');
        else showToast('请先打开一个项目', 'info');
    };
    $('sidebarMp4ToWebpBtn').onclick = () => {
        if (state.currentProject) navigateTo('mp4ToWebp');
        else showToast('请先打开一个项目', 'info');
    };
    $('globalSettingsBtn').onclick = showSettingsModal;
    $('sidebarStatsBtn').onclick = showStatsModal;
    attachStatsHover($('sidebarStatsBtn'));
    $('userProfileBtn').onclick = toggleProfileDropdown;
    $('loginBtn').onclick = handleAuth;
    $('menuWorkspaceBtn').onclick = () => { closeFileMenu(); openWorkspaceViewer(); };
    $('menuNewProjectBtn').onclick = () => {
        closeFileMenu();
        if (!state.token) { showToast('请先登录', 'error'); return; }
        showNewProjectModal();
    };
    $('menuOpenProjectBtn').onclick = () => { closeFileMenu(); navigateTo('projectList'); };
    $('menuImportLocalBtn').onclick = () => {
        closeFileMenu();
        showImportProjectModal();
    };
    $('menuSettingsBtn').onclick = () => { closeFileMenu(); showSettingsModal(); };
    $('menuExportLocalBtn').onclick = () => {
        closeFileMenu();
        showExportProjectModal();
    };
    $('menuLocalModeBtn').onclick = async () => {
        closeFileMenu();
        const proj = state.currentProject;
        if (!proj) { showToast('请先打开一个项目', 'info'); return; }
        if (proj.localMode) {
            // Disable local mode
            disableLocalMode(proj);
            await saveProject(proj);
            showToast('已关闭本地模式', 'info');
            navigateTo(state.currentView);
        } else {
            // Enable local mode
            try {
                showToast('请选择本地存储目录…', 'info');
                const result = await enableLocalMode(proj, (done, total, msg) => {
                    if (total > 0) showToast(`本地化: ${done}/${total} — ${msg}`, 'info');
                });
                await saveProject(proj);
                showToast(`本地模式已启用! ${result.total} 个资源已下载${result.failed ? `, ${result.failed} 个失败` : ''}`, 'success');
                navigateTo(state.currentView);
            } catch (e) {
                if (e.name !== 'AbortError') showToast(`启用本地模式失败: ${e.message}`, 'error');
            }
        }
    };

    // File menu toggle
    $('fileMenuBtn').onclick = (e) => {
        e.stopPropagation();
        $('fileMenuDropdown').classList.toggle('open');
    };

    // Close file menu on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.file-menu-wrap')) {
            $('fileMenuDropdown').classList.remove('open');
        }
    });

    // Close profile dropdown on outside click
    document.addEventListener('click', (e) => {
        const dd = $('profileDropdown');
        if (!dd.classList.contains('hidden') && !e.target.closest('#userProfileBtn') && !e.target.closest('#profileDropdown')) {
            dd.classList.add('hidden');
        }
    });

    // Modal close on backdrop
    $('editModal').onclick = (e) => { if (e.target === $('editModal')) hideEditModal(); };
    $('videoModal').onclick = (e) => { if (e.target === $('videoModal')) hideVideoModal(); };
    $('workspaceViewerModal').onclick = (e) => { if (e.target === $('workspaceViewerModal')) closeWorkspaceViewer(); };
    $('editModalClose').onclick = hideEditModal;
    $('videoModalClose').onclick = hideVideoModal;
    $('workspaceViewerClose').onclick = closeWorkspaceViewer;
    $('imgPreview').onclick = () => $('imgPreview').classList.add('hidden');

    // Escape key
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            hideEditModal();
            hideVideoModal();
            hideHelpModal();
            hideSettingsModal();
            closeWorkspaceViewer();
            $('imgPreview').classList.add('hidden');
        }
    });

    await refreshAuthUI();
    initHelp();
    initHoverPreview();
    initImageClipboard();

    // Mobile bottom bar
    $('mobileHamburger').onclick = () => toggleMobileSidebar();
    $('mobileSidebarOverlay').onclick = () => closeMobileSidebar();
    $('mobTabBreakdown').onclick = () => {
        if (state.currentProject) navigateTo('breakdown');
        else showToast('请先打开一个项目', 'info');
    };
    $('mobTabGenerate').onclick = () => {
        if (state.currentProject) navigateTo('generation');
        else showToast('请先打开一个项目', 'info');
    };
    $('mobTabPreview').onclick = () => {
        if (state.currentProject) navigateTo('preview');
        else showToast('请先打开一个项目', 'info');
    };
    $('mobTabMore').onclick = () => toggleMobileSidebar();

    navigateTo('projectList');
    maybeShowHelpOnFirstUse();
}

init();
