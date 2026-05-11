// ============ Storage (personalPageStore workspace files) ============

import { CONFIG } from './config.js';
import { sdk, state, normalizeProject, syncAllReferenceVideoUrls } from './state.js';
import { saveStatsToProject } from './stats.js';
import { localBlobCache } from './utils.js';

import { buildPlotExport } from './state.js';

function getWorkspaceStore() {
    if (!sdk.personalPageStore) return null;
    return sdk.personalPageStore.withWorkspace(CONFIG.PROJECT_WORKSPACE);
}

function sanitizeProjectFileStem(title) {
    const safeTitle = String(title || '未命名项目')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .replace(/^\.+|\.+$/g, '');
    return safeTitle || '未命名项目';
}

function toPageName(projectFileName) {
    return String(projectFileName || '').replace(/\.md$/i, '');
}

function isAimovieFileName(name) {
    return !!name && (name.endsWith('.aimovie') || name.endsWith(CONFIG.PROJECT_FILE_SUFFIX));
}

function isAiplotFileName(name) {
    return !!name && (name.endsWith('.aiplot') || name.endsWith('.aiplot.md'));
}

function parseAimovieFile(content) {
    if (!content || !String(content).trim()) return null;
    try {
        return JSON.parse(content);
    } catch (_) {
        return null;
    }
}

async function deleteProjectFile(projectFileName) {
    if (!sdk?.token || !projectFileName) return;
    const store = getWorkspaceStore();
    if (!store) return;
    await store.clearPageData(toPageName(projectFileName)).catch((error) => {
        console.warn('[AIMM] Delete project file failed:', error.message || error);
    });
}

function buildProjectSummary(project) {
    return {
        id: project.id,
        title: project.title,
        status: project.status,
        workspace: CONFIG.PROJECT_WORKSPACE,
        projectFileName: getProjectFileName(project),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        shortCount: project.shorts?.length || 0,
        totalDuration: project.totalDuration || 0,
        episodeCount: project.episodeCount || 1,
        localMode: project.localMode || false,
    };
}

/** Values considered "empty/default" and omitted when saving to reduce file size. */
const SHORT_DEFAULTS = {
    propIds: [], characterIds: [], imageUrls: [], imagePaths: [], audioUrls: [], videoCandidates: [], parallelTasks: [], imageCandidates: [], picturebookCandidates: [],
    taskId: null, status: 'pending', videoUrl: null, videoPath: null,
    sourceVideoUrl: null, referenceVideoUrl: null, referenceVideoSourceShortId: null, firstFrameUrl: null, lastFrameUrl: null,
    modelOverride: null, generateAudioOverride: null, watermark: false, error: null,
    shotType: null, cameraMovement: null, cameraAngle: null, lighting: null, emotion: null,
    stableVariables: null, enhanced: false, folderId: null,
    picturebook: false, picturebookUrl: null, picturebookPath: null,
    picturebookStatus: null, picturebookTaskId: null, picturebookError: null,
    dialogue: '', narration: '',
};
const CHAR_DEFAULTS = {
    imageUrl: null, imagePath: null, anchorImageUrl: null, anchorVerified: false,
    designPrompt: null, visualTraits: null, folderId: null, imageCandidates: [],
};
const SCENE_DEFAULTS = {
    imageUrl: null, imagePath: null, lighting: null, timeOfDay: null,
    weather: null, mood: null, folderId: null, imageCandidates: [],
};
const PROP_DEFAULTS = {
    imageUrl: null, imagePath: null, anchorImageUrl: null, anchorVerified: false,
    designPrompt: null, folderId: null, imageCandidates: [],
};

function isDefaultValue(val, def) {
    if (val === def) return true;
    if (Array.isArray(def) && def.length === 0 && Array.isArray(val) && val.length === 0) return true;
    return false;
}

function stripDefaults(obj, defaults) {
    const out = { ...obj };
    for (const key in defaults) {
        if (key in out && isDefaultValue(out[key], defaults[key])) delete out[key];
    }
    return out;
}

function stripProjectDefaults(project) {
    const p = JSON.parse(JSON.stringify(project));
    if (p.shorts) p.shorts = p.shorts.map(s => stripDefaults(s, SHORT_DEFAULTS));
    if (p.characters) p.characters = p.characters.map(c => stripDefaults(c, CHAR_DEFAULTS));
    if (p.scenes) p.scenes = p.scenes.map(s => stripDefaults(s, SCENE_DEFAULTS));
    if (p.props) p.props = p.props.map(pr => stripDefaults(pr, PROP_DEFAULTS));
    return p;
}

function buildProjectMarkdown(project) {
    return JSON.stringify({
        format: 'aimovie',
        version: 1,
        summary: buildProjectSummary(project),
        project: stripProjectDefaults(project),
    }, null, 2);
}

async function resolveProjectFileName(project, previousFileName = null) {
    const store = getWorkspaceStore();
    const baseStem = sanitizeProjectFileStem(project.title);
    let candidate = `${baseStem}${CONFIG.PROJECT_FILE_SUFFIX}`;
    if (!store) {
        project.projectFileName = candidate;
        return candidate;
    }

    let suffix = 1;
    while (true) {
        const raw = await store.readFile(candidate);
        const parsed = parseAimovieFile(raw);
        const summary = parsed?.summary;
        if (!summary || summary.id === project.id || candidate === previousFileName) {
            project.projectFileName = candidate;
            return candidate;
        }
        suffix += 1;
        candidate = `${baseStem}-${suffix}${CONFIG.PROJECT_FILE_SUFFIX}`;
    }
}

function upsertProjectSummary(project) {
    const summary = buildProjectSummary(project);
    const existingIndex = state.projects.findIndex(item => item.projectFileName === summary.projectFileName || item.id === summary.id);
    if (existingIndex >= 0) {
        state.projects.splice(existingIndex, 1, summary);
    } else {
        state.projects.unshift(summary);
    }
}

async function saveProjectFile(project, previousFileName = null) {
    const store = getWorkspaceStore();
    if (!store) return;

    const projectFileName = await resolveProjectFileName(project, previousFileName);
    await store.createFile(projectFileName, buildProjectMarkdown(project));

    if (previousFileName && previousFileName !== projectFileName) {
        await deleteProjectFile(previousFileName);
    }
}

export function getProjectWorkspace(project) {
    if (project) project.workspace = CONFIG.PROJECT_WORKSPACE;
    return CONFIG.PROJECT_WORKSPACE;
}

export function getProjectWorkspaceStore() {
    return getWorkspaceStore();
}

export function getProjectFileName(project) {
    if (!project) return '';
    const fileName = `${sanitizeProjectFileStem(project.title)}${CONFIG.PROJECT_FILE_SUFFIX}`;
    project.workspace = CONFIG.PROJECT_WORKSPACE;
    project.projectFileName = fileName;
    return fileName;
}

export function getProjectAssetFolder(project) {
    return sanitizeProjectFileStem((getProjectFileName(project) || '').replace(CONFIG.PROJECT_FILE_SUFFIX, ''));
}

export async function saveProjectList() {}

// ============ Interactive Plot File (.aiplot.md) ============

const PLOT_FILE_SUFFIX = '.aiplot.md';

export function getPlotFileName(project) {
    return `${sanitizeProjectFileStem(project?.title)}${PLOT_FILE_SUFFIX}`;
}

/**
 * Export an interactive movie plot to a sibling <project>.aiplot.md file.
 * The file is a self-contained JSON (wrapped in .md) that the standalone
 * movie player can load without the full project.
 */
export async function exportPlotFile(project) {
    if (!project) throw new Error('no project');
    const store = getWorkspaceStore();
    if (!store) throw new Error('存储不可用（未登录？）');
    const payload = buildPlotExport(project);
    const fileName = getPlotFileName(project);
    await store.createFile(fileName, JSON.stringify(payload, null, 2));
    return { fileName, payload };
}

/** Parse an .aiplot.md content string into a plot payload (or null). */
export function parsePlotFile(content) {
    if (!content || !String(content).trim()) return null;
    try {
        const parsed = JSON.parse(content);
        if (parsed && parsed.format === 'aiplot') return parsed;
        return null;
    } catch (_) {
        return null;
    }
}

/** Load an .aiplot.md file by name from the project workspace. */
export async function loadPlotFile(fileName) {
    const store = getWorkspaceStore();
    if (!store) return null;
    const raw = await store.readFile(fileName);
    return parsePlotFile(raw);
}

// ============ Task Log (persistent per-project task tracking) ============

const TASK_LOG_SUFFIX = '.tasklog.md';

function getTaskLogFileName(project) {
    return 'logs/' + sanitizeProjectFileStem(project.title) + TASK_LOG_SUFFIX;
}

export async function loadTaskLog(project) {
    const store = getWorkspaceStore();
    if (!store || !project) return [];
    try {
        const raw = await store.readFile(getTaskLogFileName(project));
        if (!raw || !raw.trim()) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

async function saveTaskLog(project, log) {
    const store = getWorkspaceStore();
    if (!store || !project) return;
    try {
        await store.createFile(getTaskLogFileName(project), JSON.stringify(log, null, 2));
    } catch (e) {
        console.warn('[AIMM] Save task log failed:', e.message);
    }
}

export async function appendTaskLogEntry(project, entry) {
    const log = await loadTaskLog(project);
    log.push({
        ...entry,
        submittedAt: new Date().toISOString(),
    });
    await saveTaskLog(project, log);
}

export async function updateTaskLogEntry(project, taskId, updates) {
    const log = await loadTaskLog(project);
    const entry = log.find(e => e.taskId === taskId);
    if (entry) {
        Object.assign(entry, updates, { updatedAt: new Date().toISOString() });
        await saveTaskLog(project, log);
    }
}

// ============ Undo / Redo (in-memory snapshots) ============

const MAX_UNDO = 10;
const _undoStack = [];   // past snapshots (JSON strings)
const _redoStack = [];
let _undoRedoCallback = null;  // (canUndo, canRedo) => void
let _isRestoring = false;      // guard to skip snapshot during undo/redo restore
let _lastSavedSnapshot = null; // JSON string of the last-saved project state

export function setUndoRedoCallback(cb) { _undoRedoCallback = cb; }

function _notifyUndoRedo() {
    if (_undoRedoCallback) _undoRedoCallback(_undoStack.length > 0, _redoStack.length > 0);
}

function _pushUndoSnapshot(project) {
    if (_isRestoring) return;
    const newSnap = JSON.stringify(project);
    if (_lastSavedSnapshot) {
        // Only push if the previous state differs from current
        if (_lastSavedSnapshot !== newSnap) {
            // avoid duplicate consecutive snapshots
            if (_undoStack.length === 0 || _undoStack[_undoStack.length - 1] !== _lastSavedSnapshot) {
                _undoStack.push(_lastSavedSnapshot);
                if (_undoStack.length > MAX_UNDO) _undoStack.shift();
            }
            _redoStack.length = 0; // clear redo on new change
        }
    }
    _lastSavedSnapshot = newSnap;
    _notifyUndoRedo();
}

export function clearUndoRedo() {
    _undoStack.length = 0;
    _redoStack.length = 0;
    _lastSavedSnapshot = null;
    _notifyUndoRedo();
}

export function undoProject() {
    if (_undoStack.length === 0 || !state.currentProject) return null;
    // save current state to redo
    _redoStack.push(JSON.stringify(state.currentProject));
    const snap = _undoStack.pop();
    const restored = normalizeProject(JSON.parse(snap));
    _isRestoring = true;
    Object.assign(state.currentProject, restored);
    _lastSavedSnapshot = snap;
    _isRestoring = false;
    _notifyUndoRedo();
    return state.currentProject;
}

export function redoProject() {
    if (_redoStack.length === 0 || !state.currentProject) return null;
    // save current state to undo
    _undoStack.push(JSON.stringify(state.currentProject));
    const snap = _redoStack.pop();
    const restored = normalizeProject(JSON.parse(snap));
    _isRestoring = true;
    Object.assign(state.currentProject, restored);
    _lastSavedSnapshot = snap;
    _isRestoring = false;
    _notifyUndoRedo();
    return state.currentProject;
}

export function canUndo() { return _undoStack.length > 0; }
export function canRedo() { return _redoStack.length > 0; }

export async function saveProject(project) {
    if (!sdk.token || !sdk.personalPageStore) return;
    syncAllReferenceVideoUrls(project);
    _pushUndoSnapshot(project);
    saveStatsToProject(project);
    const previousFileName = project.projectFileName || null;
    project.updatedAt = Date.now();
    getProjectWorkspace(project);
    try {
        await saveProjectFile(project, previousFileName);
        upsertProjectSummary(project);
        if (project.localMode) syncProjectFileToLocal(project).catch(() => {});
    } catch (e) {
        console.error('[AIMM] Save project failed:', e);
    }
}

/** Persist project without affecting undo/redo stacks (used after undo/redo restore). */
export async function saveProjectSilent(project) {
    if (!sdk.token || !sdk.personalPageStore) return;
    syncAllReferenceVideoUrls(project);
    const previousFileName = project.projectFileName || null;
    project.updatedAt = Date.now();
    getProjectWorkspace(project);
    try {
        await saveProjectFile(project, previousFileName);
        upsertProjectSummary(project);
    } catch (e) {
        console.error('[AIMM] Save project failed:', e);
    }
}

export async function loadProjectList() {
    if (!sdk.token || !sdk.personalPageStore) return [];
    try {
        const store = getWorkspaceStore();
        const listing = await store.listDir('.');
        const files = String(listing)
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('Directory is empty') && !line.endsWith('/') && isAimovieFileName(line));

        const summaries = await Promise.all(files.map(async (fileName) => {
            const normalizedFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
            const raw = await store.readFile(normalizedFileName);
            const summary = parseAimovieFile(raw)?.summary;
            if (!summary) return null;
            return {
                ...summary,
                workspace: CONFIG.PROJECT_WORKSPACE,
                projectFileName: normalizedFileName,
            };
        }));

        return summaries.filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (e) {
        console.warn('[AIMM] Load project list failed:', e.message);
        return [];
    }
}

export async function loadProject(projectFileName) {
    if (!sdk.token || !sdk.personalPageStore || !projectFileName) return null;
    try {
        const store = getWorkspaceStore();
        const normalizedFileName = projectFileName.endsWith('.md') ? projectFileName : `${projectFileName}.md`;
        const raw = await store.readFile(normalizedFileName);
        const project = parseAimovieFile(raw)?.project;
        if (!project) return null;
        project.workspace = CONFIG.PROJECT_WORKSPACE;
        project.projectFileName = normalizedFileName;
        return normalizeProject(project);
    } catch (e) {
        console.warn('[AIMM] Load project failed:', e.message);
        return null;
    }
}

export async function deleteProjectRemote(projectFileName) {
    if (!sdk.token || !sdk.personalPageStore || !projectFileName) return;
    try {
        await deleteProjectFile(projectFileName);
    } catch (e) {
        console.warn('[AIMM] Delete project failed:', e.message);
    }
}

// ============ Backup & Rollback ============

function getBackupFolder(projectFileName) {
    const stem = String(projectFileName || '').replace(/\.md$/i, '').replace(CONFIG.PROJECT_FILE_SUFFIX.replace('.md', ''), '');
    return `backup/${sanitizeProjectFileStem(stem)}`;
}

function formatTimestamp(date) {
    const d = date || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function computeProjectHash(project) {
    const data = JSON.stringify({
        characters: project.characters,
        scenes: project.scenes,
        shorts: project.shorts,
        props: project.props,
        script: project.script,
        synopsis: project.synopsis,
        settings: project.settings,
    });
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
    }
    return hash;
}

export async function backupProject(project, { force = false } = {}) {
    if (!sdk?.token || !sdk.personalPageStore || !project) return null;
    const currentHash = computeProjectHash(project);
    if (!force && project._lastBackupHash === currentHash) {
        console.log('[AIMM] Skipped backup — no changes since last backup');
        return null;
    }
    const store = getWorkspaceStore();
    if (!store) return null;
    const projectFileName = getProjectFileName(project);
    const folder = getBackupFolder(projectFileName);
    const stem = String(projectFileName).replace(/\.md$/i, '');
    const backupName = `${folder}/${stem}_${formatTimestamp(new Date())}${CONFIG.PROJECT_FILE_SUFFIX}`;
    try {
        await store.createFile(backupName, buildProjectMarkdown(project));
        project._lastBackupHash = currentHash;
        return backupName;
    } catch (e) {
        console.error('[AIMM] Backup failed:', e);
        return null;
    }
}

export async function listBackups(project) {
    if (!sdk?.token || !sdk.personalPageStore || !project) return [];
    const store = getWorkspaceStore();
    if (!store) return [];
    const projectFileName = getProjectFileName(project);
    const folder = getBackupFolder(projectFileName);
    try {
        const listing = await store.listDir(folder, true);
        const files = String(listing)
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('Directory is empty') && !line.endsWith('/') && isAimovieFileName(line));
        return files.sort().reverse();
    } catch (e) {
        return [];
    }
}

export async function loadBackup(project, backupFileName) {
    if (!sdk?.token || !sdk.personalPageStore || !backupFileName) return null;
    const store = getWorkspaceStore();
    if (!store) return null;
    const projectFileName = getProjectFileName(project);
    const folder = getBackupFolder(projectFileName);
    const fullPath = backupFileName.startsWith(folder) ? backupFileName : `${folder}/${backupFileName}`;
    const normalizedPath = fullPath.endsWith('.md') ? fullPath : `${fullPath}.md`;
    try {
        const raw = await store.readFile(normalizedPath);
        const parsed = parseAimovieFile(raw);
        return parsed?.project || null;
    } catch (e) {
        console.warn('[AIMM] Load backup failed:', e.message);
        return null;
    }
}

export async function clearBackups(project) {
    if (!sdk?.token || !sdk.personalPageStore || !project) return 0;
    const store = getWorkspaceStore();
    if (!store) return 0;
    const backups = await listBackups(project);
    if (!backups.length) return 0;
    const projectFileName = getProjectFileName(project);
    const folder = getBackupFolder(projectFileName);
    let deleted = 0;
    for (const f of backups) {
        const fullPath = f.startsWith(folder) ? f : `${folder}/${f}`;
        const pageName = toPageName(fullPath.endsWith('.md') ? fullPath : `${fullPath}.md`);
        try {
            await store.clearPageData(pageName);
            deleted++;
        } catch (_) {}
    }
    return deleted;
}

// ============ Export Project to Local Folder ============

function buildLocalExportProject(project, exportOptions = {}) {
    const options = {
        mode: exportOptions.mode === 'custom' ? 'custom' : 'all',
        includeCharacters: exportOptions.includeCharacters !== false,
        includeScenes: exportOptions.includeScenes !== false,
        includeProps: exportOptions.includeProps !== false,
        includeShorts: exportOptions.includeShorts !== false,
    };

    const cloned = normalizeProject(JSON.parse(JSON.stringify(project || {})));
    cloned.workspace = null;
    cloned.projectFileName = null;
    cloned.localMode = false;
    cloned.localAssetMap = {};
    cloned.localDirName = null;

    if (options.mode === 'all') return cloned;

    if (!options.includeCharacters) cloned.characters = [];
    if (!options.includeScenes) cloned.scenes = [];
    if (!options.includeProps) cloned.props = [];
    if (!options.includeShorts) {
        cloned.shorts = [];
        cloned.plot = { rootNodeId: null, nodes: [] };
        cloned.subtitles = null;
    }

    const keptCharacterIds = new Set((cloned.characters || []).map(item => item.id));
    const keptSceneIds = new Set((cloned.scenes || []).map(item => item.id));
    const keptPropIds = new Set((cloned.props || []).map(item => item.id));

    cloned.shorts = (cloned.shorts || []).map(short => ({
        ...short,
        sceneId: keptSceneIds.has(short.sceneId) ? short.sceneId : null,
        characterIds: (short.characterIds || []).filter(id => keptCharacterIds.has(id)),
        propIds: (short.propIds || []).filter(id => keptPropIds.has(id)),
    }));

    const keptShortIds = new Set((cloned.shorts || []).map(item => item.id));
    if (cloned.plot && Array.isArray(cloned.plot.nodes)) {
        cloned.plot.nodes = cloned.plot.nodes.map(node => ({
            ...node,
            shortIds: (node.shortIds || []).filter(id => keptShortIds.has(id)),
        }));
        if (cloned.plot.rootNodeId && !cloned.plot.nodes.some(node => node.id === cloned.plot.rootNodeId)) {
            cloned.plot.rootNodeId = cloned.plot.nodes[0]?.id || null;
        }
    }

    const allowedCategories = new Set();
    if (options.includeCharacters) allowedCategories.add('characters');
    if (options.includeScenes) allowedCategories.add('scenes');
    if (options.includeProps) allowedCategories.add('props');
    if (options.includeShorts) allowedCategories.add('shorts');
    cloned.folders = (cloned.folders || []).filter(folder => allowedCategories.has(folder.category));

    return normalizeProject(cloned);
}

function collectProjectUrls(project) {
    const urls = [];
    const seen = new Set();
    function add(url, subfolder, filename) {
        if (!url || typeof url !== 'string' || seen.has(url)) return;
        seen.add(url);
        urls.push({ url, subfolder, filename });
    }
    function filenameFromUrl(url, fallbackExt = '') {
        try {
            const pathname = new URL(url).pathname;
            const base = pathname.split('/').pop() || '';
            return base || `file_${Math.random().toString(36).slice(2, 8)}${fallbackExt}`;
        } catch (_) {
            return `file_${Math.random().toString(36).slice(2, 8)}${fallbackExt}`;
        }
    }
    (project.characters || []).forEach(c => {
        if (c.imageUrl) add(c.imageUrl, 'images/characters', `${c.name || c.id}.${c.imageUrl.split('.').pop().split('?')[0] || 'png'}`);
        if (c.anchorImageUrl) add(c.anchorImageUrl, 'images/characters', `${c.name || c.id}_anchor.${c.anchorImageUrl.split('.').pop().split('?')[0] || 'png'}`);
        (c.imageCandidates || []).forEach((u, i) => {
            if (typeof u === 'string') add(u, 'images/characters', `${c.name || c.id}_candidate_${i}.${filenameFromUrl(u, '.png').split('.').pop()}`);
        });
    });
    (project.props || []).forEach(p => {
        if (p.imageUrl) add(p.imageUrl, 'images/props', `${p.name || p.id}.${p.imageUrl.split('.').pop().split('?')[0] || 'png'}`);
        if (p.anchorImageUrl) add(p.anchorImageUrl, 'images/props', `${p.name || p.id}_anchor.${p.anchorImageUrl.split('.').pop().split('?')[0] || 'png'}`);
        (p.imageCandidates || []).forEach((u, i) => {
            if (typeof u === 'string') add(u, 'images/props', `${p.name || p.id}_candidate_${i}.${filenameFromUrl(u, '.png').split('.').pop()}`);
        });
    });
    (project.scenes || []).forEach(s => {
        if (s.imageUrl) add(s.imageUrl, 'images/scenes', `${s.name || s.id}.${s.imageUrl.split('.').pop().split('?')[0] || 'png'}`);
        (s.imageCandidates || []).forEach((u, i) => {
            if (typeof u === 'string') add(u, 'images/scenes', `${s.name || s.id}_candidate_${i}.${filenameFromUrl(u, '.png').split('.').pop()}`);
        });
    });
    (project.shorts || []).forEach(sh => {
        if (sh.videoUrl) add(sh.videoUrl, 'videos', `shot_${sh.order}_video.${filenameFromUrl(sh.videoUrl, '.mp4').split('.').pop()}`);
        if (sh.sourceVideoUrl && sh.sourceVideoUrl !== sh.videoUrl) add(sh.sourceVideoUrl, 'videos', `shot_${sh.order}_source.${filenameFromUrl(sh.sourceVideoUrl, '.mp4').split('.').pop()}`);
        if (sh.referenceVideoUrl) add(sh.referenceVideoUrl, 'videos', `shot_${sh.order}_ref.${filenameFromUrl(sh.referenceVideoUrl, '.mp4').split('.').pop()}`);
        if (sh.firstFrameUrl) add(sh.firstFrameUrl, 'images/frames', `shot_${sh.order}_first.${filenameFromUrl(sh.firstFrameUrl, '.png').split('.').pop()}`);
        if (sh.lastFrameUrl) add(sh.lastFrameUrl, 'images/frames', `shot_${sh.order}_last.${filenameFromUrl(sh.lastFrameUrl, '.png').split('.').pop()}`);
        (sh.imageUrls || []).forEach((u, i) => {
            if (typeof u === 'string') add(u, 'images/shots', `shot_${sh.order}_img_${i}.${filenameFromUrl(u, '.png').split('.').pop()}`);
        });
        (sh.audioUrls || []).forEach((u, i) => {
            if (typeof u === 'string') add(u, 'audio', `shot_${sh.order}_audio_${i}.${filenameFromUrl(u, '.mp3').split('.').pop()}`);
        });
        (sh.videoCandidates || []).forEach((u, i) => {
            if (typeof u === 'string') add(u, 'videos', `shot_${sh.order}_candidate_${i}.${filenameFromUrl(u, '.mp4').split('.').pop()}`);
        });
    });
    return urls;
}

export function summarizeLocalExport(project, exportOptions = {}) {
    const exportProject = buildLocalExportProject(project, exportOptions);
    return {
        project: exportProject,
        counts: {
            characters: exportProject.characters?.length || 0,
            scenes: exportProject.scenes?.length || 0,
            props: exportProject.props?.length || 0,
            shorts: exportProject.shorts?.length || 0,
        },
        assets: collectProjectUrls(exportProject),
    };
}

async function getOrCreateSubDir(dirHandle, subPath) {
    const parts = subPath.split('/').filter(Boolean);
    let current = dirHandle;
    for (const part of parts) {
        current = await current.getDirectoryHandle(part, { create: true });
    }
    return current;
}

async function writeFileToDir(dirHandle, subfolder, filename, blob) {
    const dir = subfolder ? await getOrCreateSubDir(dirHandle, subfolder) : dirHandle;
    const safe = filename.replace(/[<>:"/\\|?*]/g, '_');
    const fh = await dir.getFileHandle(safe, { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
}

export async function exportProjectToLocal(project, onProgress, exportOptions = {}) {
    if (!project) throw new Error('没有打开的项目');

    if (!('showDirectoryPicker' in window)) {
        throw new Error('当前浏览器不支持选择文件夹，请使用 Chrome 或 Edge');
    }

    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const shouldDownloadAssets = exportOptions.downloadAssets !== false;
    const { project: exportProject, assets } = summarizeLocalExport(project, exportOptions);

    // 1. Save workspace file (project JSON)
    const projectJson = buildProjectMarkdown(exportProject);
    const projectFileName = getProjectFileName(exportProject) || `${exportProject.title || 'project'}.aimovie.json`;
    await writeFileToDir(dirHandle, '', projectFileName.replace(/\.md$/, '.json'), new Blob([projectJson], { type: 'application/json' }));
    if (onProgress) onProgress(0, 0, '已保存项目文件');

    if (!shouldDownloadAssets) {
        return { total: assets.length, done: 0, failed: 0, skippedAssets: assets.length, downloadAssets: false };
    }

    // 2. Collect all asset URLs
    const total = assets.length;
    let done = 0;
    let failed = 0;

    // 3. Download and save each asset
    for (const asset of assets) {
        try {
            if (onProgress) onProgress(done, total, `下载 ${asset.filename}…`);
            const resp = await fetch(asset.url);
            if (!resp.ok) { failed++; done++; continue; }
            const blob = await resp.blob();
            await writeFileToDir(dirHandle, asset.subfolder, asset.filename, blob);
        } catch (e) {
            console.warn('[AIMM] Export asset failed:', asset.url, e.message);
            failed++;
        }
        done++;
    }

    return { total, done, failed, skippedAssets: 0, downloadAssets: true };
}

export function parseLocalProjectText(text) {
    try {
        const parsed = JSON.parse(text);
        const project = parsed?.project || parsed;
        if (!project || (!project.title && !project.shorts && !project.characters && !project.scenes && !project.props)) {
            throw new Error('无法识别的项目文件格式');
        }
        return normalizeProject(project);
    } catch (e) {
        throw new Error('文件解析失败: ' + e.message);
    }
}

export function cloneImportedProject(project) {
    const cloned = JSON.parse(JSON.stringify(project || {}));
    cloned.id = crypto.randomUUID();
    cloned.createdAt = Date.now();
    cloned.updatedAt = Date.now();
    cloned.workspace = null;
    cloned.projectFileName = null;
    cloned.localMode = false;
    cloned.localAssetMap = {};
    cloned.localDirName = null;
    return normalizeProject(cloned);
}

export async function pickProjectFromLocal() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.md,.aimovie,.aimovie.json';
    return new Promise((resolve, reject) => {
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                reject(new Error('未选择文件'));
                return;
            }
            try {
                const text = await file.text();
                resolve({
                    file,
                    project: parseLocalProjectText(text),
                });
            } catch (e) {
                reject(e);
            }
        };
        input.click();
    });
}

export async function importProjectFromLocal() {
    const { project } = await pickProjectFromLocal();
    return cloneImportedProject(project);
}

// ============ Local Mode Engine ============

// In-memory caches (not serialized): projectId → dirHandle
const _localDirHandles = new Map();

export function getLocalDirHandle(project) {
    return _localDirHandles.get(project?.id) || null;
}

async function readLocalFile(dirHandle, relativePath) {
    const parts = relativePath.split('/').filter(Boolean);
    let current = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        try { current = await current.getDirectoryHandle(parts[i]); }
        catch { return null; }
    }
    try {
        const fh = await current.getFileHandle(parts[parts.length - 1]);
        const file = await fh.getFile();
        return file;
    } catch { return null; }
}

async function loadLocalBlobUrl(dirHandle, cdnUrl, relativePath) {
    if (localBlobCache.has(cdnUrl)) return localBlobCache.get(cdnUrl);
    const file = await readLocalFile(dirHandle, relativePath);
    if (!file) return null;
    const blobUrl = URL.createObjectURL(file);
    localBlobCache.set(cdnUrl, blobUrl);
    return blobUrl;
}

/**
 * Enable local mode for a project.
 * Prompts for a directory, downloads all current assets, builds the mapping.
 */
export async function enableLocalMode(project, onProgress) {
    if (!('showDirectoryPicker' in window)) {
        throw new Error('当前浏览器不支持选择文件夹，请使用 Chrome 或 Edge');
    }

    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    _localDirHandles.set(project.id, dirHandle);

    // Download all existing assets
    const assets = collectProjectUrls(project);
    const total = assets.length;
    let done = 0, failed = 0;

    for (const asset of assets) {
        try {
            if (onProgress) onProgress(done, total, `下载 ${asset.filename}…`);
            const resp = await fetch(asset.url);
            if (!resp.ok) { failed++; done++; continue; }
            const blob = await resp.blob();
            const localPath = asset.subfolder ? `${asset.subfolder}/${asset.filename}` : asset.filename;
            await writeFileToDir(dirHandle, asset.subfolder, asset.filename, blob);
            project.localAssetMap[asset.url] = localPath;
            // Create blob URL for immediate use
            localBlobCache.set(asset.url, URL.createObjectURL(blob));
        } catch (e) {
            console.warn('[AIMM] Local mode download failed:', asset.url, e.message);
            failed++;
        }
        done++;
    }

    // Save the project file locally too
    const projectJson = buildProjectMarkdown(project);
    const pFileName = (getProjectFileName(project) || `${project.title}.aimovie`).replace(/\.md$/, '.json');
    await writeFileToDir(dirHandle, '', pFileName, new Blob([projectJson], { type: 'application/json' }));

    project.localMode = true;
    project.localDirName = dirHandle.name;

    return { total, done, failed };
}

/**
 * Re-attach local directory after page reload or project re-open.
 * User must re-pick the same directory (browser security).
 */
export async function reattachLocalDir(project, onProgress) {
    if (!project?.localMode) return false;
    if (!('showDirectoryPicker' in window)) return false;

    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    _localDirHandles.set(project.id, dirHandle);
    project.localDirName = dirHandle.name;

    // Rebuild blob URLs from existing localAssetMap
    const entries = Object.entries(project.localAssetMap);
    const total = entries.length;
    let done = 0;
    for (const [cdnUrl, localPath] of entries) {
        if (onProgress) onProgress(done, total, `加载 ${localPath.split('/').pop()}…`);
        await loadLocalBlobUrl(dirHandle, cdnUrl, localPath);
        done++;
    }

    return true;
}

/**
 * Disable local mode — revoke blob URLs and clear mapping.
 */
export function disableLocalMode(project) {
    // Revoke all blob URLs for this project
    for (const [cdnUrl, localPath] of Object.entries(project.localAssetMap || {})) {
        const blobUrl = localBlobCache.get(cdnUrl);
        if (blobUrl) {
            try { URL.revokeObjectURL(blobUrl); } catch (_) {}
            localBlobCache.delete(cdnUrl);
        }
    }
    _localDirHandles.delete(project.id);
    project.localMode = false;
    project.localAssetMap = {};
    project.localDirName = null;
}

/**
 * Save a single new asset to the local directory (called after generation).
 * Returns the local relative path, or null if not in local mode.
 */
export async function saveAssetToLocal(project, cdnUrl, subfolder, filename) {
    if (!project?.localMode) return null;
    const dirHandle = _localDirHandles.get(project.id);
    if (!dirHandle) return null;
    try {
        const resp = await fetch(cdnUrl);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        await writeFileToDir(dirHandle, subfolder, filename, blob);
        const localPath = subfolder ? `${subfolder}/${filename}` : filename;
        project.localAssetMap[cdnUrl] = localPath;
        localBlobCache.set(cdnUrl, URL.createObjectURL(blob));
        return localPath;
    } catch (e) {
        console.warn('[AIMM] saveAssetToLocal failed:', cdnUrl, e.message);
        return null;
    }
}

/**
 * Persist the project JSON file to the local directory (call after save).
 */
export async function syncProjectFileToLocal(project) {
    if (!project?.localMode) return;
    const dirHandle = _localDirHandles.get(project.id);
    if (!dirHandle) return;
    try {
        const projectJson = buildProjectMarkdown(project);
        const pFileName = (getProjectFileName(project) || `${project.title}.aimovie`).replace(/\.md$/, '.json');
        await writeFileToDir(dirHandle, '', pFileName, new Blob([projectJson], { type: 'application/json' }));
    } catch (e) {
        console.warn('[AIMM] syncProjectFileToLocal failed:', e.message);
    }
}
