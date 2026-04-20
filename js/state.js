// ============ Application State ============

const hashParams = new URLSearchParams(window.location.hash.slice(1));
const queryParams = new URLSearchParams(window.location.search);
const urlToken = hashParams.get('token') || queryParams.get('token');

export const sdk = window.keepwork || new KeepworkSDK({ timeout: 30000, token: urlToken });

let loggedOut = false;

export const state = {
    currentView: 'projectList',
    projects: [],
    currentProject: null,
    selectedNodeId: null,
    selectedNodeType: null,
    selectedNodeIds: new Set(),   // multi-select: set of selected node IDs (shorts only)
    generationQueue: [],          // ordered list of short IDs queued for video generation
    treeExpanded: {
        'script-section': true,
        'characters-group': false,
        'props-group': false,
        'scenes-group': false,
        'shorts-group': true,
    },
    apiBase: localStorage.getItem('aimm_api_base') || 'https://api.keepwork.com/core/v0/gpt',
    sidebarWidth: parseInt(localStorage.getItem('aimm_sidebar_width') || '280', 10),
    pollingIntervals: {},
};

Object.defineProperty(state, 'token', {
    get() { return loggedOut ? '' : (sdk.token || ''); }
});

export function setLoggedOut(val) { loggedOut = val; }

export function resetTreeExpanded() {
    state.treeExpanded = {
        'script-section': true,
        'characters-group': false,
        'props-group': false,
        'scenes-group': false,
        'shorts-group': true,
    };
    state.selectedNodeId = 'script-section';
    state.selectedNodeType = 'script-section';
    state.selectedNodeIds.clear();
}

export function getFolders(project, category) {
    return (project.folders || []).filter(f => f.category === category).sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function normalizeProject(project) {
    if (!project) return project;
    project.settings = {
        resolution: '720p',
        ratio: '16:9',
        model: 'seedance-2.0-fast',
        generateAudio: true,
        defaultDuration: 5,
        narrationVoice: '',
        narrationVoiceName: '',
        narrationSpeed: 0,
        narrationLanguage: 'zh',
        stylePreset: '3d-semirealistic',
        customStyleSuffix: '',
        envPreset: '',
        customEnvSuffix: '',
        racePreset: '',
        customRaceSuffix: '',
        ...(project.settings || {}),
    };
    project.pipelineStage = project.pipelineStage || 'draft';
    project.episodeCount = Math.max(1, parseInt(project.episodeCount) || 1);
    project.characters = (project.characters || []).map(c => ({
        id: c?.id || crypto.randomUUID(),
        imageUrl: null,
        imagePath: null,
        anchorImageUrl: null,
        anchorVerified: false,
        designPrompt: null,
        visualTraits: null,
        folderId: null,
        imageCandidates: [],
        ...c,
    }));
    project.props = (project.props || []).map(p => ({
        id: p?.id || crypto.randomUUID(),
        imageUrl: null,
        imagePath: null,
        anchorImageUrl: null,
        anchorVerified: false,
        designPrompt: null,
        folderId: null,
        imageCandidates: [],
        ...p,
    }));
    project.scenes = (project.scenes || []).map(s => ({
        id: s?.id || crypto.randomUUID(),
        imageUrl: null,
        imagePath: null,
        lighting: null,
        timeOfDay: null,
        weather: null,
        mood: null,
        folderId: null,
        imageCandidates: [],
        ...s,
    }));
    project.shorts = (project.shorts || []).map((short, index) => ({
        id: short?.id || crypto.randomUUID(),
        order: index + 1,
        characterIds: [],
        propIds: [],
        imageUrls: [],
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
        shotType: null,
        cameraMovement: null,
        cameraAngle: null,
        lighting: null,
        emotion: null,
        stableVariables: null,
        enhanced: false,
        folderId: null,
        picturebook: false,
        picturebookUrl: null,
        picturebookPath: null,
        picturebookStatus: null,
        picturebookTaskId: null,
        picturebookError: null,
        videoCandidates: [],
        parallelTasks: [],
        dialogue: '',
        narration: '',
        ...short,
        order: short?.order || index + 1,
        folderId: short?.folderId || null,
        characterIds: short?.characterIds || [],
        propIds: short?.propIds || [],
        imageUrls: short?.imageUrls || [],
        imagePaths: short?.imagePaths || [],
        taskId: short?.taskId || null,
        status: short?.status || 'pending',
        videoUrl: short?.videoUrl || null,
        videoPath: short?.videoPath || null,
        sourceVideoUrl: short?.sourceVideoUrl || null,
        referenceVideoUrl: short?.referenceVideoUrl || null,
        firstFrameUrl: short?.firstFrameUrl || null,
        lastFrameUrl: short?.lastFrameUrl || null,
        audioUrls: short?.audioUrls || [],
        modelOverride: short?.modelOverride || null,
        generateAudioOverride: short?.generateAudioOverride ?? null,
        watermark: short?.watermark || false,
        error: short?.error || null,
        picturebook: short?.picturebook || false,
        picturebookUrl: short?.picturebookUrl || null,
        picturebookPath: short?.picturebookPath || null,
        picturebookStatus: short?.picturebookStatus || null,
        picturebookTaskId: short?.picturebookTaskId || null,
        picturebookError: short?.picturebookError || null,
        videoCandidates: short?.videoCandidates || [],
        parallelTasks: short?.parallelTasks || [],
        dialogue: short?.dialogue || '',
        narration: short?.narration || '',
    }));
    // Migrate legacy shortFolders → unified folders
    if (project.shortFolders && project.shortFolders.length > 0 && !(project.folders && project.folders.length > 0)) {
        project.folders = project.shortFolders.map(f => ({ ...f, category: 'shorts' }));
        delete project.shortFolders;
    }
    project.folders = (project.folders || []).map(f => ({
        id: f?.id || crypto.randomUUID(),
        name: f?.name || '未命名文件夹',
        order: f?.order || 0,
        category: f?.category || 'shorts',
        ...f,
    }));
    project.workspace = project.workspace || null;
    project.projectFileName = project.projectFileName || null;
    project.localMode = project.localMode || false;
    project.localAssetMap = project.localAssetMap || {};  // CDN URL → local relative path
    project.localDirName = project.localDirName || null;  // hint: last used folder name
    project.videoGenUsage = project.videoGenUsage || { totalTasks: 0, succeededTasks: 0, failedTasks: 0, totalDuration: 0, details: [] };
    project.subtitles = normalizeSubtitles(project.subtitles);
    project.isInteractive = project.isInteractive === true;
    project.plot = normalizePlot(project.plot);
    return project;
}

// ============ Interactive Plot Graph ============

function normalizePlot(plot) {
    const out = (plot && typeof plot === 'object') ? { ...plot } : {};
    out.nodes = Array.isArray(out.nodes) ? out.nodes : [];
    out.nodes = out.nodes.map(n => ({
        id: n?.id || crypto.randomUUID(),
        name: n?.name || '未命名剧情节点',
        parentId: n?.parentId || null,
        childIds: Array.isArray(n?.childIds) ? n.childIds.slice() : [],
        choices: Array.isArray(n?.choices) ? n.choices.map(c => ({
            id: c?.id || crypto.randomUUID(),
            label: c?.label || '继续',
            targetNodeId: c?.targetNodeId || null,
            condition: c?.condition || null,
        })) : [],
        shortIds: Array.isArray(n?.shortIds) ? n.shortIds.slice() : [],
        folderId: n?.folderId || null,
        endingType: n?.endingType || null, // 'good' | 'bad' | 'neutral' | null
        notes: n?.notes || '',
        // Optional position hint for graph layout (authoring only)
        x: Number.isFinite(n?.x) ? n.x : null,
        y: Number.isFinite(n?.y) ? n.y : null,
    }));
    out.rootNodeId = out.rootNodeId && out.nodes.some(n => n.id === out.rootNodeId)
        ? out.rootNodeId
        : (out.nodes[0]?.id || null);
    return out;
}

/** Return a plot node by id. */
export function getPlotNode(project, nodeId) {
    return (project?.plot?.nodes || []).find(n => n.id === nodeId) || null;
}

/** Return all plot nodes (sorted by DFS order from root). */
export function getPlotNodes(project) {
    return project?.plot?.nodes || [];
}

/** Root node. */
export function getPlotRoot(project) {
    const p = project?.plot;
    if (!p) return null;
    return p.nodes.find(n => n.id === p.rootNodeId) || p.nodes[0] || null;
}

/** Compute dotted path like "1.2.3" for a node (root = "1"). */
export function plotNodePath(project, nodeId) {
    const nodes = getPlotNodes(project);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const chain = [];
    let cur = byId.get(nodeId);
    while (cur) {
        const parent = cur.parentId ? byId.get(cur.parentId) : null;
        if (parent) {
            const idx = Math.max(0, parent.childIds.indexOf(cur.id));
            chain.unshift(String(idx + 1));
        } else {
            chain.unshift('1');
        }
        cur = parent;
    }
    return chain.join('.') || '1';
}

/** DFS traversal of plot graph from root; returns nodes in traversal order. */
export function traversePlot(project) {
    const nodes = getPlotNodes(project);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const root = getPlotRoot(project);
    const out = [];
    const seen = new Set();
    function walk(n) {
        if (!n || seen.has(n.id)) return;
        seen.add(n.id);
        out.push(n);
        n.childIds.forEach(cid => walk(byId.get(cid)));
    }
    walk(root);
    // Include orphan nodes at the end
    nodes.forEach(n => { if (!seen.has(n.id)) { seen.add(n.id); out.push(n); } });
    return out;
}

/**
 * Ensure each plot node has a matching 'shorts' folder named plot<dotted>,
 * and assign node.shortIds' folderId accordingly. Idempotent.
 */
export function syncPlotFolders(project) {
    if (!project || !project.plot) return;
    const nodes = getPlotNodes(project);
    if (!nodes.length) return;
    project.folders = project.folders || [];
    let order = 1;
    traversePlot(project).forEach(node => {
        const path = plotNodePath(project, node.id);
        const slug = `plot${path}`;
        // Find existing folder linked to this node
        let folder = node.folderId
            ? project.folders.find(f => f.id === node.folderId)
            : project.folders.find(f => f.plotNodeId === node.id);
        // Fallback: find by slug for legacy
        if (!folder) folder = project.folders.find(f => f.category === 'shorts' && f.name === slug);
        if (!folder) {
            folder = {
                id: crypto.randomUUID(),
                name: slug,
                order: order++,
                category: 'shorts',
                plotNodeId: node.id,
            };
            project.folders.push(folder);
        } else {
            folder.category = 'shorts';
            folder.plotNodeId = node.id;
            // Only auto-rename if it still uses the canonical plot<slug> pattern
            if (/^plot[\d.]+$/.test(folder.name) || folder.name === slug) folder.name = slug;
            folder.order = order++;
        }
        node.folderId = folder.id;
        // Assign short.folderId for linked shorts
        (project.shorts || []).forEach(s => {
            if (node.shortIds.includes(s.id)) s.folderId = folder.id;
        });
    });
}

/** Create a new plot node as a child of parentId (or root if null). */
export function createPlotNode(project, { parentId = null, name = '新剧情节点' } = {}) {
    if (!project.plot) project.plot = { rootNodeId: null, nodes: [] };
    const node = {
        id: crypto.randomUUID(),
        name,
        parentId: parentId || null,
        childIds: [],
        choices: [],
        shortIds: [],
        folderId: null,
        endingType: null,
        notes: '',
        x: null, y: null,
    };
    project.plot.nodes.push(node);
    if (parentId) {
        const parent = getPlotNode(project, parentId);
        if (parent && !parent.childIds.includes(node.id)) parent.childIds.push(node.id);
    }
    if (!project.plot.rootNodeId) project.plot.rootNodeId = node.id;
    return node;
}

/** Add a choice edge from `fromNodeId` to `toNodeId`. */
export function addPlotChoice(project, fromNodeId, toNodeId, label = '选项') {
    const from = getPlotNode(project, fromNodeId);
    const to = getPlotNode(project, toNodeId);
    if (!from || !to || from.id === to.id) return null;
    const choice = { id: crypto.randomUUID(), label, targetNodeId: to.id, condition: null };
    from.choices.push(choice);
    if (!from.childIds.includes(to.id)) from.childIds.push(to.id);
    if (!to.parentId) to.parentId = from.id;
    return choice;
}

/** Remove a plot node (re-parents its children to its parent). */
export function removePlotNode(project, nodeId) {
    if (!project.plot) return;
    const nodes = project.plot.nodes;
    const node = getPlotNode(project, nodeId);
    if (!node) return;
    // detach from parent
    if (node.parentId) {
        const parent = getPlotNode(project, node.parentId);
        if (parent) parent.childIds = parent.childIds.filter(id => id !== nodeId);
    }
    // re-parent children
    node.childIds.forEach(cid => {
        const c = getPlotNode(project, cid);
        if (c) c.parentId = node.parentId;
    });
    // remove choices pointing to this node
    nodes.forEach(n => {
        n.choices = n.choices.filter(c => c.targetNodeId !== nodeId);
        n.childIds = n.childIds.filter(id => id !== nodeId);
    });
    // remove node
    project.plot.nodes = nodes.filter(n => n.id !== nodeId);
    if (project.plot.rootNodeId === nodeId) {
        project.plot.rootNodeId = project.plot.nodes[0]?.id || null;
    }
}

/** Build a plot export payload (portable artifact for standalone player). */
export function buildPlotExport(project) {
    const plot = project.plot || { nodes: [], rootNodeId: null };
    const shortById = new Map((project.shorts || []).map(s => [s.id, s]));
    // Only include shots referenced by any node
    const usedIds = new Set();
    plot.nodes.forEach(n => n.shortIds.forEach(id => usedIds.add(id)));
    const shorts = Array.from(usedIds).map(id => {
        const s = shortById.get(id);
        if (!s) return null;
        return {
            id: s.id,
            order: s.order,
            duration: s.duration || 5,
            videoUrl: s.videoUrl || null,
            picturebookUrl: s.picturebookUrl || null,
            firstFrameUrl: s.firstFrameUrl || null,
            dialogue: s.dialogue || '',
            narration: s.narration || '',
        };
    }).filter(Boolean);
    return {
        format: 'aiplot',
        version: 1,
        title: project.title,
        synopsis: project.synopsis,
        settings: {
            resolution: project.settings?.resolution || '720p',
            ratio: project.settings?.ratio || '16:9',
        },
        subtitles: project.subtitles || null,
        plot: {
            rootNodeId: plot.rootNodeId,
            nodes: plot.nodes.map(n => ({
                id: n.id,
                name: n.name,
                parentId: n.parentId,
                childIds: n.childIds,
                choices: n.choices,
                shortIds: n.shortIds,
                endingType: n.endingType,
            })),
        },
        shorts,
        exportedAt: new Date().toISOString(),
    };
}

export const DEFAULT_SUBTITLE_STYLE = {
    fontSize: 28,
    fontFamily: 'system',
    fontWeight: 'normal',  // 'normal' | 'bold'
    italic: false,
    color: '#ffffff',
    outlineColor: '#000000',
    outlineWidth: 2,
    shadow: true,
    bg: '#000000',
    bgOpacity: 0,           // 0..1
    position: 'bottom',     // 'top' | 'middle' | 'bottom'
    offsetY: 0,             // px offset from chosen anchor
};

export function normalizeSubtitleStyle(style) {
    return { ...DEFAULT_SUBTITLE_STYLE, ...(style || {}) };
}

function normalizeSubtitles(subs) {
    const out = subs && typeof subs === 'object' ? { ...subs } : {};
    out.tracks = Array.isArray(out.tracks) ? out.tracks : [];
    out.entries = Array.isArray(out.entries) ? out.entries : [];
    // Ensure default tracks exist
    if (!out.tracks.find(t => t.kind === 'dialogue')) {
        out.tracks.push({
            id: crypto.randomUUID(), name: '台词', kind: 'dialogue',
            visible: true, locked: false,
            defaultStyle: { ...DEFAULT_SUBTITLE_STYLE, position: 'bottom', bgOpacity: 0.4 },
        });
    }
    if (!out.tracks.find(t => t.kind === 'narration')) {
        out.tracks.push({
            id: crypto.randomUUID(), name: '旁白', kind: 'narration',
            visible: true, locked: false,
            defaultStyle: { ...DEFAULT_SUBTITLE_STYLE, position: 'top', italic: true, color: '#ffe9a8' },
        });
    }
    if (!out.tracks.find(t => t.kind === 'textOverlay')) {
        out.tracks.push({
            id: crypto.randomUUID(), name: '文字覆盖', kind: 'textOverlay',
            visible: true, locked: false,
            defaultStyle: { fontSize: 32, fontFamily: 'system', fontWeight: 'normal', italic: false, color: '#ffffff', outlineColor: '#000000', outlineWidth: 2, shadow: true, bg: '#000000', bgOpacity: 0, posX: 50, posY: 50, width: 60 },
        });
    }
    out.tracks = out.tracks.map(t => ({
        id: t.id || crypto.randomUUID(),
        name: t.name || '字幕',
        kind: t.kind || 'custom',
        visible: t.visible !== false,
        locked: t.locked === true,
        defaultStyle: { ...DEFAULT_SUBTITLE_STYLE, ...(t.defaultStyle || {}) },
    }));
    out.entries = out.entries.map(e => ({
        id: e.id || crypto.randomUUID(),
        trackId: e.trackId,
        startTime: Number(e.startTime) || 0,
        endTime: Number(e.endTime) || 0,
        text: e.text || '',
        style: e.style || null,           // sparse override; null means use track default
        sourceShortId: e.sourceShortId || null,
        lines: e.lines || undefined,      // text overlay multi-line definitions
        template: e.template || undefined, // text overlay template key
    })).filter(e => e.trackId);
    return out;
}

export function createProject(title, episodeCount) {
    return normalizeProject({
        id: crypto.randomUUID(),
        title: title || '未命名项目',
        workspace: null,
        projectFileName: null,
        script: '',
        synopsis: '',
        totalDuration: 3,
        episodeCount: Math.max(1, parseInt(episodeCount) || 1),
        status: 'idle',
        settings: { ratio: '16:9', model: 'seedance-2.0-fast', generateAudio: true, defaultDuration: 5, narrationVoice: '', narrationVoiceName: '', narrationSpeed: 0, narrationLanguage: 'zh', stylePreset: '3d-semirealistic', customStyleSuffix: '', promptPreset: '' },
        characters: [],
        props: [],
        scenes: [],
        shorts: [],
        folders: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
}

export function linkBreakdown(project, breakdown) {
    if (breakdown.title) project.title = breakdown.title;
    if (breakdown.synopsis) project.synopsis = breakdown.synopsis;
    project.characters = (breakdown.characters || []).map(c => ({
        id: crypto.randomUUID(), name: c.name, description: c.description,
        imageUrl: null, imagePath: null, anchorImageUrl: null, anchorVerified: false,
        designPrompt: null, visualTraits: c.visualTraits || null,
    }));
    project.props = (breakdown.props || []).map(p => ({
        id: crypto.randomUUID(), name: p.name, description: p.description,
        imageUrl: null, imagePath: null, anchorImageUrl: null, anchorVerified: false,
        designPrompt: null,
    }));
    project.scenes = (breakdown.scenes || []).map(s => ({
        id: crypto.randomUUID(), name: s.name, description: s.description,
        imageUrl: null, imagePath: null,
        lighting: s.lighting || null, timeOfDay: s.timeOfDay || null,
        weather: s.weather || null, mood: s.mood || null,
    }));
    // Create episode folders if episodeCount > 1
    const episodeCount = project.episodeCount || 1;
    const episodeFolders = [];
    if (episodeCount > 1) {
        for (let ep = 1; ep <= episodeCount; ep++) {
            episodeFolders.push({
                id: crypto.randomUUID(),
                name: `第${ep}集`,
                order: ep,
                category: 'shorts',
            });
        }
        project.folders = episodeFolders;
    }

    const allShorts = (breakdown.shorts || []).slice(0, 50);
    project.shorts = allShorts.map((s, i) => {
        const scene = project.scenes.find(sc => sc.name === s.sceneName);
        const charIds = (s.characterNames || []).map(cn => {
            const ch = project.characters.find(c => c.name === cn);
            return ch?.id;
        }).filter(Boolean);
        const propIds = (s.propNames || []).map(pn => {
            const p = project.props.find(pr => pr.name === pn);
            return p?.id;
        }).filter(Boolean);

        // Assign to episode folder based on the AI's episode field or distribute evenly
        let folderId = null;
        if (episodeCount > 1 && episodeFolders.length > 0) {
            if (s.episode && s.episode >= 1 && s.episode <= episodeCount) {
                folderId = episodeFolders[s.episode - 1].id;
            } else {
                // Distribute evenly across episodes
                const epIdx = Math.floor(i / Math.ceil(allShorts.length / episodeCount));
                folderId = episodeFolders[Math.min(epIdx, episodeFolders.length - 1)].id;
            }
        }

        return {
            id: crypto.randomUUID(), order: s.order || (i + 1), folderId,
            sceneId: scene?.id || null, characterIds: charIds, propIds,
            prompt: s.prompt, duration: s.duration || 5,
            ratio: project.settings.ratio, imageUrls: [], imagePaths: [],
            taskId: null, status: 'pending', videoUrl: null, videoPath: null, sourceVideoUrl: null, referenceVideoUrl: null,
            firstFrameUrl: null, lastFrameUrl: null, audioUrls: [], modelOverride: null, generateAudioOverride: null, watermark: false,
            error: null,
            shotType: s.shotType || null, cameraMovement: s.cameraMovement || null,
            cameraAngle: s.cameraAngle || null, lighting: s.lighting || null,
            emotion: s.emotion || null, stableVariables: s.stableVariables || null,
            enhanced: false,
            dialogue: s.dialogue || '',
            narration: s.narration || '',
        };
    });
    project.status = 'editing';
    project.pipelineStage = 'parsed';

    // Plot graph (optional, for interactive movies)
    if (breakdown.plot && Array.isArray(breakdown.plot.nodes) && breakdown.plot.nodes.length > 0) {
        project.isInteractive = true;
        // Map LLM-emitted shortOrders → our actual short IDs
        const shortByOrder = new Map(project.shorts.map(s => [s.order, s]));
        project.plot = normalizePlot({
            rootNodeId: breakdown.plot.rootNodeId || null,
            nodes: breakdown.plot.nodes.map(n => {
                const orders = Array.isArray(n.shortOrders) ? n.shortOrders : (Array.isArray(n.shortIds) ? n.shortIds : []);
                const shortIds = orders.map(o => shortByOrder.get(Number(o))?.id).filter(Boolean);
                return {
                    id: n.id || crypto.randomUUID(),
                    name: n.name || '剧情节点',
                    parentId: n.parentId || null,
                    childIds: Array.isArray(n.childIds) ? n.childIds : [],
                    choices: (n.choices || []).map(c => ({
                        id: c.id || crypto.randomUUID(),
                        label: c.label || '选项',
                        targetNodeId: c.targetNodeId || null,
                    })),
                    shortIds,
                    endingType: n.endingType || null,
                    notes: n.notes || '',
                };
            }),
        });
        // Rebuild parent/child from choices if not provided
        const byId = new Map(project.plot.nodes.map(n => [n.id, n]));
        project.plot.nodes.forEach(n => {
            n.choices.forEach(c => {
                if (c.targetNodeId && byId.has(c.targetNodeId)) {
                    const child = byId.get(c.targetNodeId);
                    if (!n.childIds.includes(child.id)) n.childIds.push(child.id);
                    if (!child.parentId) child.parentId = n.id;
                }
            });
        });
        if (!project.plot.rootNodeId) {
            // Find node without parent
            const root = project.plot.nodes.find(n => !n.parentId);
            project.plot.rootNodeId = root?.id || project.plot.nodes[0]?.id || null;
        }
        syncPlotFolders(project);
    }
}

export const PIPELINE_STAGES = [
    { key: 'draft', label: '草稿', icon: '📝' },
    { key: 'parsed', label: '已解析', icon: '📖' },
    { key: 'enhanced', label: '已增强', icon: '🎬' },
    { key: 'preflight_passed', label: '预检通过', icon: '✅' },
    { key: 'generating', label: '生成中', icon: '⚙️' },
    { key: 'reviewing', label: '审核中', icon: '🔍' },
    { key: 'completed', label: '已完成', icon: '🎉' },
];

export function runPreflight(project) {
    const issues = [];
    const chars = project.characters || [];
    const props = project.props || [];
    const scenes = project.scenes || [];
    const shorts = project.shorts || [];

    chars.forEach(c => {
        if (!c.imageUrl && !c.anchorImageUrl) {
            issues.push({ severity: 'P0', type: 'missing_anchor', target: `角色: ${c.name}`, message: '缺少参考图片（锚点图）', fix: '上传或AI生成角色参考图' });
        }
        if (!c.description || c.description.length < 30) {
            issues.push({ severity: 'P1', type: 'weak_description', target: `角色: ${c.name}`, message: '描述过于简短，可能导致视觉不一致', fix: '点击"重新生成"获取详细描述' });
        }
    });

    props.forEach(p => {
        if (!p.imageUrl && !p.anchorImageUrl) {
            issues.push({ severity: 'P1', type: 'missing_anchor', target: `道具: ${p.name}`, message: '缺少参考图片', fix: '上传或AI生成道具参考图' });
        }
        if (!p.description || p.description.length < 10) {
            issues.push({ severity: 'P1', type: 'weak_description', target: `道具: ${p.name}`, message: '描述过于简短', fix: '点击"重新生成"获取详细描述' });
        }
    });

    scenes.forEach(s => {
        if (!s.imageUrl) {
            issues.push({ severity: 'P1', type: 'missing_scene_ref', target: `场景: ${s.name}`, message: '缺少场景参考图', fix: '上传或AI生成场景参考图' });
        }
        if (!s.description || s.description.length < 30) {
            issues.push({ severity: 'P1', type: 'weak_description', target: `场景: ${s.name}`, message: '描述过于简短', fix: '点击"重新生成"获取详细描述' });
        }
    });

    shorts.forEach(sh => {
        if (!sh.prompt || sh.prompt.length < 20) {
            issues.push({ severity: 'P0', type: 'missing_prompt', target: `短片 #${sh.order}`, message: '缺少视频提示词', fix: '编辑或重新生成提示词' });
        }
        if (!sh.sceneId) {
            issues.push({ severity: 'P1', type: 'no_scene', target: `短片 #${sh.order}`, message: '未关联场景', fix: '在短片详情中选择场景' });
        }
        const scene = scenes.find(sc => sc.id === sh.sceneId);
        if (scene && !scene.imageUrl) {
            issues.push({ severity: 'P1', type: 'scene_no_image', target: `短片 #${sh.order}`, message: `关联场景"${scene.name}"缺少参考图`, fix: '为该场景上传参考图' });
        }
        const missingChars = (sh.characterIds || []).filter(cid => {
            const ch = chars.find(c => c.id === cid);
            return ch && !ch.imageUrl && !ch.anchorImageUrl;
        });
        if (missingChars.length > 0) {
            issues.push({ severity: 'P0', type: 'char_no_anchor', target: `短片 #${sh.order}`, message: `${missingChars.length} 个角色缺少参考图`, fix: '为角色上传或生成参考图' });
        }
    });

    return {
        passed: !issues.some(i => i.severity === 'P0'),
        issues,
        p0Count: issues.filter(i => i.severity === 'P0').length,
        p1Count: issues.filter(i => i.severity === 'P1').length,
        p2Count: issues.filter(i => i.severity === 'P2').length,
    };
}
