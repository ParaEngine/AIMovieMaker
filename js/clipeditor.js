// ============ Clip Editor ============
// A lightweight, professional multi-track NLE for previewing the movie.
// Tracks: 1 video lane (clips, reorderable) + N subtitle lanes (drag/trim/inspect).
// Subtitles render as a canvas overlay; styles are per-entry (sparse) over per-track defaults.
// Two built-in subtitle kinds:
//   - dialogue: mirrors short.dialogue (audio is baked into the video clip)
//   - narration: post-process voice-over text, AI-generatable per project
// Output stays in-editor; export (SRT / burned-in MP4) is intentionally out of scope.

import { escapeHtml, resolveUrl, showToast } from './utils.js';
import { getFolders } from './state.js';
import PlotGraph from './plotgraph.js';

const TRANSITION_DURATION_MS = 600;

const TRANSITIONS = {
    cut:       { label: '直切', apply: () => {} },
    fadeBlack: { label: '淡入淡出', apply: (canvas, ctx, _p, _n, t) => {
        ctx.fillStyle = `rgba(0,0,0,${t < 0.5 ? t * 2 : 2 - t * 2})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }},
    crossfade: { label: '交叉溶解', apply: (canvas, ctx, prevFrame, nextFrame, t) => {
        if (prevFrame) { ctx.globalAlpha = 1 - t; ctx.drawImage(prevFrame, 0, 0, canvas.width, canvas.height); }
        if (nextFrame) { ctx.globalAlpha = t; ctx.drawImage(nextFrame, 0, 0, canvas.width, canvas.height); }
        ctx.globalAlpha = 1;
    }},
    wipeLeft: { label: '左擦除', apply: (canvas, ctx, prevFrame, nextFrame, t) => {
        const x = Math.round(canvas.width * t);
        if (nextFrame) ctx.drawImage(nextFrame, 0, 0, x, canvas.height, 0, 0, x, canvas.height);
        if (prevFrame) ctx.drawImage(prevFrame, x, 0, canvas.width - x, canvas.height, x, 0, canvas.width - x, canvas.height);
    }},
};

const DEFAULT_STYLE = {
    fontSize: 28, fontFamily: 'system', fontWeight: 'normal', italic: false,
    color: '#ffffff', outlineColor: '#000000', outlineWidth: 2, shadow: true,
    bg: '#000000', bgOpacity: 0, position: 'bottom', offsetY: 0,
};

const FONT_FAMILIES = {
    system: 'system-ui, -apple-system, sans-serif',
    sans:   'sans-serif',
    serif:  'serif',
    mono:   'monospace',
    yahei:  '"Microsoft YaHei", "微软雅黑", sans-serif',
    pingfang: '"PingFang SC", "苹方", sans-serif',
    songti: '"SimSun", "宋体", serif',
    kaiti:  '"KaiTi", "楷体", serif',
};

// ---- Text Overlay Templates ----
// Each template has `lines`: array of {text, style-overrides} for multi-line rich rendering.
// `style` contains the shared/base style. Each line can override fontSize, fontFamily, color, etc.
const TEXT_OVERLAY_TEMPLATES = {
    title: {
        label: '标题', icon: '🎬',
        style: {
            fontSize: 56, fontFamily: 'yahei', fontWeight: 'bold', italic: false,
            color: '#ffffff', outlineColor: '#000000', outlineWidth: 3, shadow: true,
            bg: '#000000', bgOpacity: 0.5, posX: 50, posY: 20, width: 80,
        },
        defaultLines: [
            { text: '影片标题', fontSize: 56, fontWeight: 'bold' },
        ],
    },
    character_intro: {
        label: '角色介绍', icon: '👤',
        style: {
            fontSize: 40, fontFamily: 'kaiti', fontWeight: 'normal', italic: false,
            color: '#ffffff', outlineColor: '#000000', outlineWidth: 2, shadow: true,
            bg: '#000000', bgOpacity: 0, posX: 35, posY: 70, width: 50,
        },
        defaultLines: [
            { text: 'Alice', fontSize: 52, fontFamily: 'serif', italic: true, color: '#ffffff' },
            { text: '12 years old', fontSize: 22, fontFamily: 'sans', fontWeight: 'bold', color: '#b0c4de', letterSpacing: 4 },
            { text: 'Daughter of Tom', fontSize: 18, fontFamily: 'sans', fontWeight: 'bold', color: '#8899aa', letterSpacing: 6 },
        ],
    },
    subtitle_big: {
        label: '大字幕', icon: '📝',
        style: {
            fontSize: 44, fontFamily: 'yahei', fontWeight: 'bold', italic: false,
            color: '#f0f0f0', outlineColor: '#111111', outlineWidth: 2, shadow: true,
            bg: '#000000', bgOpacity: 0.4, posX: 50, posY: 50, width: 70,
        },
        defaultLines: [
            { text: '章节标题', fontSize: 44, fontWeight: 'bold' },
        ],
    },
    lower_third: {
        label: '下三分之一', icon: '📰',
        style: {
            fontSize: 28, fontFamily: 'yahei', fontWeight: 'normal', italic: false,
            color: '#ffffff', outlineColor: '#000000', outlineWidth: 0, shadow: false,
            bg: '#0066cc', bgOpacity: 0.9, posX: 25, posY: 80, width: 45,
        },
        defaultLines: [
            { text: '人物名字', fontSize: 28, fontWeight: 'bold', color: '#ffffff' },
            { text: '头衔 / 职位描述', fontSize: 18, color: '#cce0ff' },
        ],
    },
    location: {
        label: '地点', icon: '📍',
        style: {
            fontSize: 24, fontFamily: 'system', fontWeight: 'normal', italic: true,
            color: '#e0e0e0', outlineColor: '#000000', outlineWidth: 1, shadow: true,
            bg: '#333333', bgOpacity: 0.7, posX: 80, posY: 88, width: 35,
        },
        defaultLines: [
            { text: '纽约市', fontSize: 26, fontWeight: 'bold', color: '#ffffff' },
            { text: '2026年春', fontSize: 18, italic: true, color: '#cccccc' },
        ],
    },
    quote: {
        label: '引用', icon: '💬',
        style: {
            fontSize: 32, fontFamily: 'kaiti', fontWeight: 'normal', italic: true,
            color: '#ffd700', outlineColor: '#000000', outlineWidth: 2, shadow: true,
            bg: '#000000', bgOpacity: 0.3, posX: 50, posY: 45, width: 60,
        },
        defaultLines: [
            { text: '"经典台词"', fontSize: 32, italic: true },
        ],
    },
    credits: {
        label: '字幕/署名', icon: '🎭',
        style: {
            fontSize: 22, fontFamily: 'system', fontWeight: 'normal', italic: false,
            color: '#cccccc', outlineColor: '#000000', outlineWidth: 1, shadow: false,
            bg: '#000000', bgOpacity: 0, posX: 50, posY: 85, width: 60,
        },
        defaultLines: [
            { text: '导演', fontSize: 16, color: '#888888' },
            { text: '张三', fontSize: 26, fontWeight: 'bold', color: '#ffffff' },
        ],
    },
    warning: {
        label: '警告/提示', icon: '⚠️',
        style: {
            fontSize: 36, fontFamily: 'system', fontWeight: 'bold', italic: false,
            color: '#ff4444', outlineColor: '#ffffff', outlineWidth: 3, shadow: true,
            bg: '#000000', bgOpacity: 0.6, posX: 50, posY: 50, width: 60,
        },
        defaultLines: [
            { text: '⚠ 注意！', fontSize: 36, fontWeight: 'bold', color: '#ff4444' },
            { text: '重要提示文字', fontSize: 22, color: '#ffaaaa' },
        ],
    },
};

const DEFAULT_OVERLAY_STYLE = {
    fontSize: 32, fontFamily: 'system', fontWeight: 'normal', italic: false,
    color: '#ffffff', outlineColor: '#000000', outlineWidth: 2, shadow: true,
    bg: '#000000', bgOpacity: 0, posX: 50, posY: 50, width: 60,
};

const ZOOM_MIN = 10;
const ZOOM_MAX = 120;
const VIDEO_LANE_H = 56;
const SUB_LANE_H = 44;
const TEXT_LANE_H = 44;
const RULER_H = 22;

export default class ClipEditor {
    /**
     * @param {Object} opts
     * @param {HTMLElement} opts.container
     * @param {Object}      [opts.project]
     * @param {Array}       opts.shorts
     * @param {string}     [opts.transition='cut']
     * @param {number}     [opts.defaultDuration=5]
     * @param {Function}   [opts.onProjectChange]
     * @param {Function}   [opts.generateSubtitles]
     */
    constructor({ container, project, shorts, transition = 'cut', defaultDuration = 5, onProjectChange, generateSubtitles }) {
        this.container = container;
        this.project = project || null;
        this.shorts = shorts;
        this.transition = transition;
        this.defaultDuration = defaultDuration;
        this.onProjectChange = onProjectChange || (() => {});
        this.generateSubtitlesFn = generateSubtitles || null;

        this.clips = [];
        this.currentIndex = 0;
        this.playing = false;
        this.transitionActive = false;
        this._raf = null;
        this._destroyed = false;

        this.pxPerSecond = 40;
        this.selection = { kind: null, id: null };
        this._dragState = null;
        this._saveTimer = null;
        this._folderFilter = null; // null = show all
        this._playheadDrag = null;

        this._undoStack = [];
        this._redoStack = [];
        this._maxUndo = 50;
        this._canvasOverlayDrag = null; // { entryId, mode: 'move'|'resize', startX, startY, origPosX, origPosY, origWidth }

        this._build();
        this._syncDialogueEntries();
        this._renderTimeline();
        this._renderInspector();
        this._showFirstFrame();
        // Auto-show plot graph panel for interactive projects
        if (this.project?.isInteractive && window.innerWidth >= 1100) {
            const panel = this.container.querySelector('#cePlotPanel');
            if (panel) panel.classList.add('ce-plotgraph-visible');
            this._mountPlotPanel();
            requestAnimationFrame(() => this._resizeCanvas());
        }
    }

    // ---- Public API ----

    setTransition(name) {
        if (TRANSITIONS[name]) this.transition = name;
        const sel = this.container.querySelector('#ceTransSel');
        if (sel) sel.value = this.transition;
    }

    play() {
        if (this._destroyed) return;
        // For interactive projects with no folder selected, start from root plot node
        if (this.project?.isInteractive && !this._folderFilter && !this._currentPlotNodeId) {
            const plot = this.project.plot;
            if (plot?.rootNodeId) {
                this._playFromPlotNode(plot.rootNodeId);
                return;
            }
        }
        this.playing = true;
        this._playCurrentClip();
        this._updatePlayBtn();
    }

    pause() {
        this.playing = false;
        const clip = this.clips[this.currentIndex];
        if (clip?.video) clip.video.pause();
        clearTimeout(this._placeholderTimer);
        this._updatePlayBtn();
    }

    _removeChoiceOverlay() {
        const ov = this.container.querySelector('.ce-choice-overlay');
        if (ov) ov.remove();
    }

    seekTo(index) {
        if (index < 0 || index >= this.clips.length) return;
        this._removeChoiceOverlay();
        const wasPlaying = this.playing;
        this.pause();
        this.currentIndex = index;
        this._renderCurrentFrame();
        this._renderTimeline();
        if (wasPlaying) this.play();
    }

    seekToTime(globalT) {
        let acc = 0;
        for (let i = 0; i < this.clips.length; i++) {
            const d = this._clipVisibleDuration(this.clips[i]);
            if (globalT < acc + d) {
                const offset = Math.max(0, globalT - acc);
                const wasPlaying = this.playing;
                this.pause();
                this.currentIndex = i;
                const clip = this.clips[i];
                if (clip.hasVideo && clip.video) {
                    const seekTime = (clip.trimStart || 0) + offset;
                    try { clip.video.currentTime = seekTime; } catch {}
                    if (clip.video.readyState >= 2) {
                        this._renderCurrentFrame();
                    } else {
                        const onSeeked = () => {
                            clip.video.removeEventListener('seeked', onSeeked);
                            clip.video.removeEventListener('loadeddata', onSeeked);
                            if (!this._destroyed) this._renderCurrentFrame();
                        };
                        clip.video.addEventListener('seeked', onSeeked);
                        clip.video.addEventListener('loadeddata', onSeeked);
                    }
                } else {
                    this._renderCurrentFrame();
                }
                this._renderTimeline();
                if (wasPlaying) this.play();
                return;
            }
            acc += d;
        }
        this.seekTo(this.clips.length - 1);
    }

    destroy() {
        this._destroyed = true;
        this.pause();
        cancelAnimationFrame(this._raf);
        clearTimeout(this._saveTimer);
        this.clips.forEach(c => { if (c.video) { c.video.pause(); c.video.src = ''; } });
        window.removeEventListener('resize', this._onResize);
        document.removeEventListener('mousemove', this._onDocMouseMove);
        document.removeEventListener('mouseup', this._onDocMouseUp);
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('mousemove', this._onCanvasDragMove);
        document.removeEventListener('mouseup', this._onCanvasDragEnd);
        if (this._plotGraph) { this._plotGraph.destroy(); this._plotGraph = null; }
        this.container.innerHTML = '';
    }

    // ---- Interactive Plot integration ----

    _togglePlotPanel() {
        const panel = this.container.querySelector('#cePlotPanel');
        if (!panel) return;
        const isWide = window.innerWidth >= 1100;
        if (isWide) {
            // On wide screens, toggle visibility class
            panel.classList.toggle('ce-plotgraph-visible');
            this._mountPlotPanel();
            // Resize video canvas after layout reflow
            requestAnimationFrame(() => this._resizeCanvas());
        } else {
            // On narrow screens, slide in/out
            const overlay = this.container.querySelector('#cePlotOverlay');
            panel.classList.toggle('ce-plotgraph-open');
            if (overlay) overlay.classList.toggle('ce-plotgraph-overlay-show', panel.classList.contains('ce-plotgraph-open'));
            this._mountPlotPanel();
        }
    }

    _updatePlotResponsive() {
        const panel = this.container.querySelector('#cePlotPanel');
        if (!panel) return;
        const overlay = this.container.querySelector('#cePlotOverlay');
        const isWide = window.innerWidth >= 1100;
        if (isWide) {
            // On wide screen: remove slide-in classes, keep visible if was open
            panel.classList.remove('ce-plotgraph-open');
            if (overlay) overlay.classList.remove('ce-plotgraph-overlay-show');
        } else {
            // On narrow screen: remove always-visible class
            panel.classList.remove('ce-plotgraph-visible');
        }
    }

    _mountPlotPanel() {
        if (!this.project) return;
        const host = this.container.querySelector('#cePlotPanel');
        if (!host) return;
        if (this._plotGraph) return;
        this._plotGraph = new PlotGraph({
            container: host,
            project: this.project,
            onSelect: (nodeId) => this._filterByPlotNode(nodeId),
            onPlay: (nodeId) => this._playFromPlotNode(nodeId),
            onChange: () => {
                // Keep folder dropdown options in sync with new/renamed plot folders
                const sel = this.container.querySelector('#ceFolderFilter');
                if (sel) sel.innerHTML = this._folderFilterOptions();
                this._scheduleSave();
            },
        });
    }

    _findPlotNodeByFolder(folderId) {
        const plot = this.project?.plot;
        if (!plot || !folderId) return null;
        return plot.nodes.find(n => n.folderId === folderId) || null;
    }

    _filterByPlotNode(nodeId) {
        const plot = this.project?.plot;
        if (!plot) return;
        const node = plot.nodes.find(n => n.id === nodeId);
        if (!node) return;
        this._currentPlotNodeId = nodeId;
        if (!node.folderId) return;
        this._folderFilter = node.folderId;
        const sel = this.container.querySelector('#ceFolderFilter');
        if (sel) sel.value = node.folderId;
        this.pause();
        this.currentIndex = 0;
        this._buildClips();
        this._syncDialogueEntries();
        this._renderTimeline();
        this._renderInspector();
        this._showFirstFrame();
    }

    _playFromPlotNode(nodeId) {
        this._filterByPlotNode(nodeId);
        this.seekTo(0);
        this.play();
    }

    _onPlotBranchEnd() {
        const plot = this.project?.plot;
        if (!plot) return false;
        // Auto-detect plot node from folder filter or current clip if not explicitly set
        if (!this._currentPlotNodeId) {
            const folderId = this._folderFilter || this.clips[this.currentIndex]?.short?.folderId;
            const detected = this._findPlotNodeByFolder(folderId);
            if (detected) this._currentPlotNodeId = detected.id;
        }
        if (!this._currentPlotNodeId) return false;
        const node = plot.nodes.find(n => n.id === this._currentPlotNodeId);
        if (!node) return false;
        const choices = Array.isArray(node.choices) ? node.choices.filter(c => c.targetNodeId) : [];
        if (choices.length === 0) {
            // Ending or no next
            return false;
        }
        if (choices.length === 1) {
            // Auto-advance
            this._playFromPlotNode(choices[0].targetNodeId);
            return true;
        }
        // Show choice overlay
        this._showChoiceOverlay(choices);
        return true;
    }

    _showChoiceOverlay(choices) {
        this.pause();
        const stage = this.container.querySelector('.clipeditor-stage');
        if (!stage) return;
        // Remove previous overlay if any
        const prev = stage.querySelector('.ce-choice-overlay');
        if (prev) prev.remove();
        const overlay = document.createElement('div');
        overlay.className = 'ce-choice-overlay';
        overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:20;padding:16px;';
        overlay.innerHTML = `
            <div style="color:#fff;font-size:15px;font-weight:600;margin-bottom:8px">请选择你的行动</div>
            ${choices.map((c, i) => `<button class="btn-primary" data-ci="${i}" style="min-width:220px">${escapeHtml(c.label || '选项 ' + (i + 1))}</button>`).join('')}
        `;
        // Ensure parent is positioned
        const computedPos = getComputedStyle(stage).position;
        if (computedPos === 'static') stage.style.position = 'relative';
        stage.appendChild(overlay);
        overlay.querySelectorAll('[data-ci]').forEach(btn => {
            btn.onclick = () => {
                const idx = Number(btn.getAttribute('data-ci'));
                overlay.remove();
                const choice = choices[idx];
                if (choice?.targetNodeId) this._playFromPlotNode(choice.targetNodeId);
            };
        });
    }

    // ---- Build ----

    _build() {
        this._buildClips();

        this.container.innerHTML = `
            <div class="clipeditor">
                <div class="clipeditor-content">
                    <div class="clipeditor-main">
                        <div class="clipeditor-stage-wrap">
                            <div class="clipeditor-stage">
                                <canvas class="clipeditor-canvas"></canvas>
                            </div>
                            <div class="clipeditor-controls">
                                <button class="clipeditor-btn clipeditor-play-btn" title="播放/暂停">▶</button>
                                <button class="clipeditor-btn" id="ceStopBtn" title="停止">⏹</button>
                                <button class="clipeditor-btn" id="ceUndoBtn" title="撤销 (Ctrl+Z)" disabled>↩</button>
                                <button class="clipeditor-btn" id="ceRedoBtn" title="重做 (Ctrl+Y)" disabled>↪</button>
                                <span class="clipeditor-time" id="ceTime">00:00 / 00:00</span>
                                <div style="flex:1"></div>
                                <label class="clipeditor-label">文件夹:
                                    <select class="clipeditor-select" id="ceFolderFilter">
                                        ${this._folderFilterOptions()}
                                    </select>
                                </label>
                                <button class="clipeditor-btn-sm" id="cePlotBtn" title="互动剧情图" style="${this.project?.isInteractive ? '' : 'display:none'}">🌿 剧情图</button>
                                <label class="clipeditor-label">转场:
                                    <select class="clipeditor-select" id="ceTransSel">
                                        ${Object.entries(TRANSITIONS).map(([k, v]) => `<option value="${k}" ${k === this.transition ? 'selected' : ''}>${v.label}</option>`).join('')}
                                    </select>
                                </label>
                                <label class="clipeditor-label">缩放:
                                    <input type="range" id="ceZoom" min="${ZOOM_MIN}" max="${ZOOM_MAX}" step="2" value="${this.pxPerSecond}" style="width:100px">
                                    <span class="clipeditor-zoom-val">${this.pxPerSecond}</span>
                                </label>

                            </div>
                        </div>
                        <div class="clipeditor-inspector" id="ceInspector"></div>
                    </div>
                    <div class="clipeditor-tlwrap">
                        <div class="clipeditor-tlhead-col" id="ceTlHeadCol"></div>
                        <div class="clipeditor-tlbody" id="ceTlBody">
                            <div class="clipeditor-tlruler" id="ceTlRuler"></div>
                            <div class="clipeditor-tllanes" id="ceTlLanes"></div>
                            <div class="clipeditor-tlplayhead" id="ceTlPlayhead"><div class="clipeditor-tlplayhead-handle" id="ceTlPlayheadHandle"></div></div>
                        </div>
                    </div>
                </div>
                <div class="ce-plotgraph-resizer" id="cePlotResizer"></div>
                <div class="ce-plotgraph-panel" id="cePlotPanel"></div>
                <div class="ce-plotgraph-overlay" id="cePlotOverlay"></div>
            </div>`;

        this.canvas = this.container.querySelector('.clipeditor-canvas');
        this.ctx = this.canvas.getContext('2d');
        this._resizeCanvas();
        this._wireCanvasOverlayDrag();

        this.container.querySelector('.clipeditor-play-btn').onclick = () => this.playing ? this.pause() : this.play();
        this.container.querySelector('#ceStopBtn').onclick = () => { this.pause(); this.seekTo(0); };
        this.container.querySelector('#ceUndoBtn').onclick = () => this.undo();
        this.container.querySelector('#ceRedoBtn').onclick = () => this.redo();
        this.container.querySelector('#ceFolderFilter').onchange = (e) => {
            this._folderFilter = e.target.value || null;
            // Sync plot node when folder is selected manually
            if (this._folderFilter) {
                const plotNode = this._findPlotNodeByFolder(this._folderFilter);
                this._currentPlotNodeId = plotNode ? plotNode.id : null;
            } else {
                this._currentPlotNodeId = null;
            }
            this.pause();
            this.currentIndex = 0;
            this._buildClips();
            this._syncDialogueEntries();
            this._renderTimeline();
            this._renderInspector();
            this._showFirstFrame();
        };
        this.container.querySelector('#ceTransSel').onchange = (e) => { this.transition = e.target.value; };
        const plotBtn = this.container.querySelector('#cePlotBtn');
        if (plotBtn) plotBtn.onclick = () => this._togglePlotPanel();
        const plotOverlay = this.container.querySelector('#cePlotOverlay');
        if (plotOverlay) plotOverlay.onclick = () => {
            const panel = this.container.querySelector('#cePlotPanel');
            if (panel) panel.classList.remove('ce-plotgraph-open');
            plotOverlay.classList.remove('ce-plotgraph-overlay-show');
        };
        this._wirePlotResizer();
        const zoomEl = this.container.querySelector('#ceZoom');
        zoomEl.oninput = (e) => {
            this.pxPerSecond = Number(e.target.value);
            this.container.querySelector('.clipeditor-zoom-val').textContent = this.pxPerSecond;
            this._renderTimeline();
        };


        this._tlBody = this.container.querySelector('#ceTlBody');
        this._tlBody.addEventListener('scroll', () => this._updatePlayhead());

        window.addEventListener('resize', this._onResize);
        document.addEventListener('mousemove', this._onDocMouseMove);
        document.addEventListener('mouseup', this._onDocMouseUp);
        document.addEventListener('keydown', this._onKeyDown);
    }

    _onResize = () => { if (!this._destroyed) { this._resizeCanvas(); this._renderTimeline(); this._updatePlotResponsive(); } };

    _wirePlotResizer() {
        const resizer = this.container.querySelector('#cePlotResizer');
        if (!resizer) return;
        let startX, startW;
        const onMouseMove = (e) => {
            const delta = startX - e.clientX;
            const panel = this.container.querySelector('#cePlotPanel');
            if (!panel) return;
            const newW = Math.max(200, Math.min(800, startW + delta));
            panel.style.width = newW + 'px';
            this._resizeCanvas();
        };
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const panel = this.container.querySelector('#cePlotPanel');
            if (!panel) return;
            startX = e.clientX;
            startW = panel.offsetWidth;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    _onKeyDown = (e) => {
        if (this._destroyed) return;
        // Undo/Redo works even when input is focused
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); this.redo(); return; }
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (e.code === 'Space') { e.preventDefault(); this.playing ? this.pause() : this.play(); }
    };

    _resizeCanvas() {
        const stage = this.container.querySelector('.clipeditor-stage');
        if (!stage) return;
        const stageW = stage.clientWidth;
        const stageH = stage.clientHeight;
        // Fit 16:9 canvas within available stage area
        let w = stageW;
        let h = Math.round(w * 9 / 16);
        if (h > stageH && stageH > 0) {
            h = stageH;
            w = Math.round(h * 16 / 9);
        }
        this.canvas.width = w;
        this.canvas.height = h;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this._renderCurrentFrame();
    }

    _folderFilterOptions() {
        const folders = this.project ? getFolders(this.project, 'shorts') : [];
        let html = `<option value="">全部</option>`;
        folders.forEach(f => {
            html += `<option value="${f.id}" ${this._folderFilter === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`;
        });
        return html;
    }

    _buildClips() {
        const filtered = this._folderFilter
            ? this.shorts.filter(s => s.folderId === this._folderFilter)
            : this.shorts;
        this.clips = filtered.map(s => {
            const hasVideo = s.status === 'succeeded' && s.videoUrl;
            const isPicturebook = !hasVideo && s.picturebookUrl && s.picturebookStatus === 'succeeded';
            const clip = {
                short: s, hasVideo, isPicturebook,
                video: null, image: null,
                duration: s.duration || this.defaultDuration,
                trimStart: s._trimStart || 0,
                trimEnd: s._trimEnd ?? null, // null = use full duration
                loaded: false,
            };
            if (isPicturebook) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => { clip.loaded = true; if (this.clips[this.currentIndex] === clip && !this.playing) this._renderCurrentFrame(); };
                img.onerror = () => { clip.isPicturebook = false; clip.loaded = true; };
                img.src = resolveUrl(s.picturebookUrl);
                clip.image = img;
            } else if (hasVideo) {
                const vid = document.createElement('video');
                vid.crossOrigin = 'anonymous';
                vid.preload = 'auto';
                vid.muted = false;
                vid.playsInline = true;
                vid.src = resolveUrl(s.videoUrl);
                vid.onloadedmetadata = () => {
                    clip.duration = vid.duration || clip.duration;
                    clip.loaded = true;
                    this._renderTimeline();
                    this._updateTotalTime();
                };
                vid.onloadeddata = () => { if (this.clips[this.currentIndex] === clip && !this.playing) this._renderCurrentFrame(); };
                vid.onerror = () => { clip.hasVideo = false; clip.loaded = true; this._renderTimeline(); };
                clip.video = vid;
            }
            return clip;
        });
    }

    // ---- Subtitle helpers ----

    _subs() {
        if (!this.project) return null;
        if (!this.project.subtitles) this.project.subtitles = { tracks: [], entries: [] };
        if (!Array.isArray(this.project.subtitles.tracks)) this.project.subtitles.tracks = [];
        if (!Array.isArray(this.project.subtitles.entries)) this.project.subtitles.entries = [];
        return this.project.subtitles;
    }

    _dialogueTrack() { const s = this._subs(); return s ? s.tracks.find(t => t.kind === 'dialogue') : null; }
    _narrationTrack() { const s = this._subs(); return s ? s.tracks.find(t => t.kind === 'narration') : null; }

    _clipVisibleDuration(clip) {
        const full = clip.duration || this.defaultDuration;
        const start = clip.trimStart || 0;
        const end = clip.trimEnd ?? full;
        return Math.max(0.5, end - start);
    }

    _clipStartTime(idx) {
        let t = 0;
        for (let i = 0; i < idx; i++) t += this._clipVisibleDuration(this.clips[i]);
        return t;
    }

    _totalDuration() {
        return this.clips.reduce((s, c) => s + this._clipVisibleDuration(c), 0);
    }

    _syncDialogueEntries() {
        const subs = this._subs();
        const track = this._dialogueTrack();
        if (!subs || !track) return;
        const seen = new Set();
        this.clips.forEach((clip, i) => {
            const sh = clip.short;
            const start = this._clipStartTime(i);
            const end = start + this._clipVisibleDuration(clip);
            const existing = subs.entries.find(e => e.trackId === track.id && e.sourceShortId === sh.id);
            if (sh.dialogue && sh.dialogue.trim()) {
                if (existing) {
                    existing.text = sh.dialogue.trim();
                    existing.startTime = start;
                    existing.endTime = end;
                } else {
                    subs.entries.push({
                        id: crypto.randomUUID(),
                        trackId: track.id,
                        startTime: start, endTime: end,
                        text: sh.dialogue.trim(),
                        style: null, sourceShortId: sh.id,
                    });
                }
                seen.add(sh.id);
            }
        });
        subs.entries = subs.entries.filter(e => {
            if (e.trackId !== track.id || !e.sourceShortId) return true;
            return seen.has(e.sourceShortId);
        });
    }

    _scheduleSave() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.onProjectChange(), 400);
    }

    // ---- Undo / Redo ----

    _snapshot() {
        return {
            clipOrder: this.clips.map(c => c.short.id),
            clipTrims: this.clips.map(c => ({ id: c.short.id, trimStart: c.trimStart, trimEnd: c.trimEnd, duration: c.duration })),
            shortData: this.shorts.map(s => ({ id: s.id, order: s.order, dialogue: s.dialogue, narration: s.narration, _trimStart: s._trimStart, _trimEnd: s._trimEnd, duration: s.duration })),
            subtitles: this.project ? JSON.parse(JSON.stringify(this.project.subtitles || { tracks: [], entries: [] })) : null,
            currentIndex: this.currentIndex,
            selection: { ...this.selection },
        };
    }

    _pushUndo() {
        this._undoStack.push(this._snapshot());
        if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
        this._redoStack.length = 0;
        this._updateUndoRedoBtns();
    }

    _restoreSnapshot(snap) {
        // Restore short data
        snap.shortData.forEach(sd => {
            const sh = this.shorts.find(s => s.id === sd.id);
            if (!sh) return;
            sh.order = sd.order; sh.dialogue = sd.dialogue; sh.narration = sd.narration;
            sh._trimStart = sd._trimStart; sh._trimEnd = sd._trimEnd; sh.duration = sd.duration;
        });
        // Restore clip order and trims
        const ordered = [];
        snap.clipOrder.forEach(id => {
            const c = this.clips.find(x => x.short.id === id);
            if (c) ordered.push(c);
        });
        // Keep any clips not in snapshot (shouldn't happen, but safe)
        this.clips.forEach(c => { if (!ordered.includes(c)) ordered.push(c); });
        this.clips = ordered;
        snap.clipTrims.forEach(ct => {
            const c = this.clips.find(x => x.short.id === ct.id);
            if (c) { c.trimStart = ct.trimStart; c.trimEnd = ct.trimEnd; c.duration = ct.duration; }
        });
        // Restore subtitles
        if (snap.subtitles && this.project) {
            this.project.subtitles = JSON.parse(JSON.stringify(snap.subtitles));
        }
        this.currentIndex = Math.min(snap.currentIndex, this.clips.length - 1);
        this.selection = { ...snap.selection };
        this._renderTimeline();
        this._renderInspector();
        this._renderCurrentFrame();
        this._scheduleSave();
    }

    undo() {
        if (this._undoStack.length === 0) return;
        this._redoStack.push(this._snapshot());
        const snap = this._undoStack.pop();
        this._restoreSnapshot(snap);
        this._updateUndoRedoBtns();
    }

    redo() {
        if (this._redoStack.length === 0) return;
        this._undoStack.push(this._snapshot());
        const snap = this._redoStack.pop();
        this._restoreSnapshot(snap);
        this._updateUndoRedoBtns();
    }

    _updateUndoRedoBtns() {
        const undo = this.container.querySelector('#ceUndoBtn');
        const redo = this.container.querySelector('#ceRedoBtn');
        if (undo) undo.disabled = this._undoStack.length === 0;
        if (redo) redo.disabled = this._redoStack.length === 0;
    }

    _resetClipLength(clip) {
        this._pushUndo();
        clip.trimStart = 0;
        clip.trimEnd = null;
        clip.short._trimStart = 0;
        clip.short._trimEnd = null;
        this._syncDialogueEntries();
        this._renderTimeline();
        this._renderInspector();
        this._renderCurrentFrame();
        this._scheduleSave();
    }

    _resetAllClipLengths() {
        if (!confirm('确认重置所有片段为原始时长？')) return;
        let changed = false;
        this.clips.forEach(clip => {
            if (this._isClipTrimmed(clip)) {
                changed = true;
            }
        });
        if (!changed) { showToast('所有片段已是原始时长', 'info'); return; }
        this._pushUndo();
        this.clips.forEach(clip => {
            if (this._isClipTrimmed(clip)) {
                clip.trimStart = 0;
                clip.trimEnd = null;
                clip.short._trimStart = 0;
                clip.short._trimEnd = null;
                changed = true;
            }
        });
        if (!changed) { showToast('所有片段已是原始时长', 'info'); return; }
        this._syncDialogueEntries();
        this._renderTimeline();
        this._renderInspector();
        this._renderCurrentFrame();
        this._scheduleSave();
        showToast('已重置所有片段为原始时长', 'success');
    }

    // ---- Timeline render ----

    _renderTimeline() {
        const subs = this._subs();
        const tracks = subs ? subs.tracks : [];
        const total = this._totalDuration();
        const totalPx = Math.max((this._tlBody?.clientWidth || 600) - 8, total * this.pxPerSecond);

        const headCol = this.container.querySelector('#ceTlHeadCol');
        if (!headCol) return; // DOM not ready yet (e.g. triggered by early video error)
        const subTracks = tracks.filter(t => t.kind !== 'textOverlay');
        const textTracks = tracks.filter(t => t.kind === 'textOverlay');
        const totalH = RULER_H + VIDEO_LANE_H + subTracks.length * SUB_LANE_H + textTracks.length * TEXT_LANE_H;
        headCol.style.height = totalH + 'px';
        headCol.innerHTML = `
            <div class="ce-tlhead-spacer" style="height:${RULER_H}px">
                <div class="ce-add-track-wrap">
                    <button class="ce-add-track-btn" id="ceAddTrackToggle" title="添加轨道">＋</button>
                    <div class="ce-add-track-menu" id="ceAddTrackMenu">
                        <div class="ce-add-track-item" data-add="subtitle">＋ 字幕轨</div>
                        <div class="ce-add-track-item" data-add="text">＋ 文字覆盖</div>
                    </div>
                </div>
            </div>
            <div class="ce-tlhead ce-tlhead-video" style="height:${VIDEO_LANE_H}px">
                <span class="ce-tlhead-name">🎬 视频</span>
                <button class="ce-th-btn" id="ceResetAllLengths" title="重置所有片段为原始时长">↺</button>
            </div>
            ${subTracks.map(tr => this._trackHeadHTML(tr)).join('')}
            ${textTracks.map(tr => this._trackHeadHTML(tr)).join('')}
        `;

        const ruler = this.container.querySelector('#ceTlRuler');
        ruler.style.width = totalPx + 'px';
        ruler.innerHTML = this._rulerHTML(total);

        const lanes = this.container.querySelector('#ceTlLanes');
        lanes.style.width = totalPx + 'px';
        lanes.innerHTML = `
            <div class="ce-lane ce-lane-video" style="height:${VIDEO_LANE_H}px;width:${totalPx}px" data-lane="video">
                ${this.clips.map((c, i) => this._clipBlockHTML(c, i)).join('')}
            </div>
            ${subTracks.map(tr => this._subLaneHTML(tr, totalPx)).join('')}
            ${textTracks.map(tr => this._textOverlayLaneHTML(tr, totalPx)).join('')}
        `;

        this._wireTimelineEvents();
        this._updatePlayhead();

        const resetAllBtn = this.container.querySelector('#ceResetAllLengths');
        if (resetAllBtn) {
            resetAllBtn.onclick = (e) => {
                e.stopPropagation();
                this._resetAllClipLengths();
            };
        }
    }

    _trackHeadHTML(tr) {
        const isAuto = tr.kind === 'dialogue' || tr.kind === 'narration';
        const isTextOverlay = tr.kind === 'textOverlay';
        const aiBtn = (isAuto || tr.kind === 'custom') && this.project
            ? `<button class="ce-th-btn" data-th-action="ai" data-th-id="${tr.id}" title="AI 生成">🤖</button>` : '';
        const clearBtn = `<button class="ce-th-btn" data-th-action="clear" data-th-id="${tr.id}" title="清空轨道">🧹</button>`;
        const delBtn = (tr.kind === 'custom' || isTextOverlay) ? `<button class="ce-th-btn ce-th-btn-danger" data-th-action="del" data-th-id="${tr.id}" title="删除轨道">🗑</button>` : '';
        const laneH = isTextOverlay ? TEXT_LANE_H : SUB_LANE_H;
        return `
            <div class="ce-tlhead ce-tlhead-sub${isTextOverlay ? ' ce-tlhead-text' : ''}" data-track="${tr.id}" style="height:${laneH}px">
                <div class="ce-tlhead-row">
                    <button class="ce-th-eye" data-th-action="vis" data-th-id="${tr.id}" title="显示/隐藏">${tr.visible ? '👁' : '🚫'}</button>
                    <input class="ce-th-name" data-th-id="${tr.id}" value="${escapeHtml(tr.name)}">
                </div>
                <div class="ce-tlhead-row ce-tlhead-actions">
                    <button class="ce-th-btn" data-th-action="style" data-th-id="${tr.id}" title="编辑默认样式">⚙</button>
                    ${aiBtn}${clearBtn}${delBtn}
                </div>
            </div>`;
    }

    _rulerHTML(total) {
        if (total <= 0) return '';
        const ticks = [];
        for (let s = 0; s <= Math.ceil(total); s++) {
            const x = s * this.pxPerSecond;
            const major = s % 5 === 0;
            ticks.push(`<div class="ce-tick${major ? ' ce-tick-major' : ''}" style="left:${x}px">${major ? `<span class="ce-tick-label">${this._fmt(s)}</span>` : ''}</div>`);
        }
        return ticks.join('');
    }

    _isClipTrimmed(clip) {
        const full = clip.duration || this.defaultDuration;
        const start = clip.trimStart || 0;
        const end = clip.trimEnd ?? full;
        return start > 0.01 || Math.abs(end - full) > 0.01;
    }

    // Returns { choices, nodeId } if this clip is the last one of a plot-node folder
    // that has interactive choices; otherwise null.
    _clipChoicesInfo(clip, idx) {
        if (!this.project?.isInteractive) return null;
        const folderId = clip.short?.folderId;
        if (!folderId) return null;
        const node = this._findPlotNodeByFolder(folderId);
        if (!node) return null;
        const choices = Array.isArray(node.choices) ? node.choices.filter(c => c.targetNodeId) : [];
        if (choices.length === 0) return null;
        // Must be the last clip of this folder in the current clips array
        const next = this.clips[idx + 1];
        if (next && next.short?.folderId === folderId) return null;
        return { choices, nodeId: node.id };
    }

    _clipBlockHTML(clip, idx) {
        const w = this._clipVisibleDuration(clip) * this.pxPerSecond;
        const x = this._clipStartTime(idx) * this.pxPerSecond;
        const cls = ['ce-clip'];
        if (idx === this.currentIndex) cls.push('ce-clip-current');
        if (this.selection.kind === 'clip' && this.selection.id === clip.short.id) cls.push('ce-clip-selected');
        if (!clip.hasVideo && !clip.isPicturebook) cls.push('ce-clip-empty');
        if (this._isClipTrimmed(clip)) cls.push('ce-clip-trimmed');
        const desc = clip.short.prompt || clip.short.description || '';
        const dialogIcon = clip.short.dialogue ? '🗣' : '';
        const choiceInfo = this._clipChoicesInfo(clip, idx);
        let choiceZone = '';
        if (choiceInfo) {
            // Zone takes the last ~25% of the clip, min 28px, max 96px
            const zoneW = Math.max(28, Math.min(96, Math.round(w * 0.25)));
            const title = `互动分支 (${choiceInfo.choices.length} 个选项) - 点击选择`;
            choiceZone = `<div class="ce-clip-choice-zone" data-choice-node="${choiceInfo.nodeId}" style="width:${zoneW}px" title="${escapeHtml(title)}"><span class="ce-clip-choice-zone-icon">✦ 选择</span></div>`;
        }
        return `
            <div class="${cls.join(' ')}" data-clip-idx="${idx}" data-clip-id="${clip.short.id}"
                 style="left:${x}px;width:${Math.max(w, 16)}px"
                 title="${escapeHtml(desc)}">
                <div class="ce-clip-handle ce-clip-handle-l" data-handle="l"></div>
                <span class="ce-clip-label">#${clip.short.order} ${dialogIcon}</span>
                ${choiceZone}
                <div class="ce-clip-handle ce-clip-handle-r" data-handle="r"></div>
            </div>`;
    }

    _subLaneHTML(tr, totalPx) {
        const subs = this._subs();
        const entries = subs.entries.filter(e => e.trackId === tr.id);
        const blocks = entries.map(e => {
            const x = e.startTime * this.pxPerSecond;
            const w = Math.max((e.endTime - e.startTime) * this.pxPerSecond, 12);
            const cls = ['ce-sub-block'];
            if (this.selection.kind === 'entry' && this.selection.id === e.id) cls.push('ce-sub-block-selected');
            if (e.sourceShortId) cls.push('ce-sub-block-linked');
            return `
                <div class="${cls.join(' ')}" data-entry-id="${e.id}"
                     style="left:${x}px;width:${w}px"
                     title="${escapeHtml(e.text)}">
                    <div class="ce-clip-handle ce-clip-handle-l" data-handle="l"></div>
                    <span class="ce-sub-block-text">${escapeHtml(e.text || '(空)')}</span>
                    <div class="ce-clip-handle ce-clip-handle-r" data-handle="r"></div>
                </div>`;
        }).join('');
        return `<div class="ce-lane ce-lane-sub" data-lane="sub" data-track-id="${tr.id}" style="height:${SUB_LANE_H}px;width:${totalPx}px;${tr.visible ? '' : 'opacity:0.5;'}">${blocks}</div>`;
    }

    _textOverlayLaneHTML(tr, totalPx) {
        const subs = this._subs();
        const entries = subs.entries.filter(e => e.trackId === tr.id);
        const blocks = entries.map(e => {
            const x = e.startTime * this.pxPerSecond;
            const w = Math.max((e.endTime - e.startTime) * this.pxPerSecond, 12);
            const cls = ['ce-sub-block', 'ce-text-block'];
            if (this.selection.kind === 'entry' && this.selection.id === e.id) cls.push('ce-sub-block-selected');
            const tpl = e.template ? TEXT_OVERLAY_TEMPLATES[e.template] : null;
            const icon = tpl ? tpl.icon : '🔤';
            return `
                <div class="${cls.join(' ')}" data-entry-id="${e.id}"
                     style="left:${x}px;width:${w}px"
                     title="${escapeHtml(e.text)}">
                    <div class="ce-clip-handle ce-clip-handle-l" data-handle="l"></div>
                    <span class="ce-sub-block-text">${icon} ${escapeHtml(e.text || '(空)')}</span>
                    <div class="ce-clip-handle ce-clip-handle-r" data-handle="r"></div>
                </div>`;
        }).join('');
        return `<div class="ce-lane ce-lane-sub ce-lane-text" data-lane="text" data-track-id="${tr.id}" style="height:${TEXT_LANE_H}px;width:${totalPx}px;${tr.visible ? '' : 'opacity:0.5;'}">${blocks}</div>`;
    }

    _wireTimelineEvents() {
        const lanes = this.container.querySelector('#ceTlLanes');

        // + dropdown button
        const addToggle = this.container.querySelector('#ceAddTrackToggle');
        const addMenu = this.container.querySelector('#ceAddTrackMenu');
        if (addToggle && addMenu) {
            addToggle.onclick = (e) => { e.stopPropagation(); addMenu.classList.toggle('ce-add-track-menu-open'); };
            addMenu.querySelectorAll('.ce-add-track-item').forEach(item => {
                item.onclick = (e) => {
                    e.stopPropagation();
                    addMenu.classList.remove('ce-add-track-menu-open');
                    if (item.dataset.add === 'subtitle') this._addCustomTrack();
                    else if (item.dataset.add === 'text') this._addTextOverlayTrack();
                };
            });
            // close dropdown on outside click
            const closeMenu = (e) => { if (!addMenu.contains(e.target) && e.target !== addToggle) addMenu.classList.remove('ce-add-track-menu-open'); };
            document.addEventListener('click', closeMenu);
        }

        this.container.querySelectorAll('#ceTlHeadCol .ce-th-btn, #ceTlHeadCol .ce-th-eye').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const action = btn.dataset.thAction;
                const id = btn.dataset.thId;
                const tr = this._subs().tracks.find(t => t.id === id);
                if (!tr) return;
                if (action === 'vis') { tr.visible = !tr.visible; this._renderTimeline(); this._renderCurrentFrame(); this._scheduleSave(); }
                else if (action === 'style') { this.selection = { kind: 'track', id: tr.id }; this._renderInspector(); this._renderTimeline(); }
                else if (action === 'ai') this._aiGenerateForTrack(tr);
                else if (action === 'clear') this._clearTrack(tr);
                else if (action === 'del') this._deleteTrack(tr);
            };
        });
        this.container.querySelectorAll('#ceTlHeadCol .ce-th-name').forEach(inp => {
            inp.onchange = () => {
                const tr = this._subs().tracks.find(t => t.id === inp.dataset.thId);
                if (tr) { tr.name = inp.value || '字幕'; this._scheduleSave(); }
            };
        });

        const ruler = this.container.querySelector('#ceTlRuler');
        const seekFromClick = (e) => {
            const rect = ruler.getBoundingClientRect();
            const t = (e.clientX - rect.left) / this.pxPerSecond;
            this.seekToTime(Math.max(0, t));
        };
        ruler.onclick = seekFromClick;

        // Click on video lane empty space also seeks
        const videoLane = lanes.querySelector('.ce-lane-video');
        if (videoLane) {
            videoLane.onclick = (e) => {
                if (e.target !== videoLane) return;
                const rect = videoLane.getBoundingClientRect();
                const t = (e.clientX - rect.left) / this.pxPerSecond;
                this.seekToTime(Math.max(0, t));
            };
        }

        lanes.querySelectorAll('.ce-clip').forEach(el => {
            el.onmousedown = (ev) => {
                // Clicking the choice zone opens the choice overlay instead of dragging
                const zone = ev.target.closest('.ce-clip-choice-zone');
                if (zone) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const nodeId = zone.dataset.choiceNode;
                    const plot = this.project?.plot;
                    const node = plot?.nodes.find(n => n.id === nodeId);
                    const choices = node ? (node.choices || []).filter(c => c.targetNodeId) : [];
                    if (choices.length > 0) {
                        this.pause();
                        this._currentPlotNodeId = nodeId;
                        // Seek to the last frame of the clicked clip
                        const clipIdx = parseInt(el.dataset.clipIdx);
                        const clip = this.clips[clipIdx];
                        if (clip) {
                            const endT = this._clipStartTime(clipIdx) + this._clipVisibleDuration(clip);
                            // Nudge slightly before the hard end so the frame renders
                            this.seekToTime(Math.max(0, endT - 0.05));
                        }
                        this._showChoiceOverlay(choices);
                    }
                    return;
                }
                this._beginDrag(ev, el, 'clip');
            };
        });
        lanes.querySelectorAll('.ce-sub-block').forEach(el => {
            el.onmousedown = (ev) => this._beginDrag(ev, el, 'entry');
            el.oncontextmenu = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const entryId = el.dataset.entryId;
                this._showContextMenu(ev.clientX, ev.clientY, [
                    { label: '✏️ 编辑', action: () => { this.selection = { kind: 'entry', id: entryId }; this._renderTimeline(); this._renderInspector(); } },
                    { label: '📋 复制', action: () => this._duplicateEntry(entryId) },
                    { label: '🗑 删除', action: () => this._deleteEntry(entryId) },
                ]);
            };
        });
        lanes.querySelectorAll('.ce-lane-sub').forEach(lane => {
            lane.ondblclick = (ev) => {
                if (ev.target !== lane) return;
                const trId = lane.dataset.trackId;
                const rect = lane.getBoundingClientRect();
                const t = (ev.clientX - rect.left) / this.pxPerSecond;
                this._createEntry(trId, Math.max(0, t));
            };
            lane.oncontextmenu = (ev) => {
                if (ev.target !== lane) return;
                ev.preventDefault();
                const trId = lane.dataset.trackId;
                const rect = lane.getBoundingClientRect();
                const t = (ev.clientX - rect.left) / this.pxPerSecond;
                const tr = this._subs()?.tracks.find(x => x.id === trId);
                const isTextOverlay = tr && tr.kind === 'textOverlay';
                const items = [
                    { label: '＋ 新建' + (isTextOverlay ? '文字' : '字幕'), action: () => this._createEntry(trId, Math.max(0, t)) },
                ];
                if (isTextOverlay) {
                    // Offer template quick-create
                    items.push({ divider: true });
                    Object.entries(TEXT_OVERLAY_TEMPLATES).forEach(([k, v]) => {
                        items.push({ label: `${v.icon} ${v.label}`, action: () => this._createEntryFromTemplate(trId, Math.max(0, t), k) });
                    });
                }
                this._showContextMenu(ev.clientX, ev.clientY, items);
            };
        });
    }

    _showContextMenu(x, y, items) {
        this._hideContextMenu();
        const menu = document.createElement('div');
        menu.className = 'ce-context-menu';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        items.forEach(item => {
            if (item.divider) {
                const div = document.createElement('div');
                div.className = 'ce-context-divider';
                menu.appendChild(div);
                return;
            }
            const el = document.createElement('div');
            el.className = 'ce-context-item';
            el.textContent = item.label;
            el.onclick = (e) => { e.stopPropagation(); this._hideContextMenu(); item.action(); };
            menu.appendChild(el);
        });
        document.body.appendChild(menu);
        // Adjust if off-screen
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
            if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
        });
        const close = (e) => { if (!menu.contains(e.target)) { this._hideContextMenu(); document.removeEventListener('mousedown', close); } };
        setTimeout(() => document.addEventListener('mousedown', close), 0);
        this._ctxMenu = menu;
    }

    _hideContextMenu() {
        if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; }
    }

    _duplicateEntry(id) {
        const subs = this._subs();
        const e = subs?.entries.find(x => x.id === id);
        if (!e) return;
        this._pushUndo();
        const clone = JSON.parse(JSON.stringify(e));
        clone.id = crypto.randomUUID();
        clone.startTime = e.endTime;
        clone.endTime = e.endTime + (e.endTime - e.startTime);
        clone.sourceShortId = null;
        subs.entries.push(clone);
        this.selection = { kind: 'entry', id: clone.id };
        this._renderTimeline();
        this._renderInspector();
        this._scheduleSave();
    }

    _createEntryFromTemplate(trackId, startT, tplKey) {
        const tpl = TEXT_OVERLAY_TEMPLATES[tplKey];
        if (!tpl) return;
        const subs = this._subs();
        if (!subs) return;
        this._pushUndo();
        const entry = {
            id: crypto.randomUUID(),
            trackId, startTime: startT, endTime: startT + 3,
            text: tpl.defaultLines.map(l => l.text).join('\n'),
            lines: JSON.parse(JSON.stringify(tpl.defaultLines)),
            style: { ...tpl.style },
            template: tplKey,
            sourceShortId: null,
        };
        subs.entries.push(entry);
        this.selection = { kind: 'entry', id: entry.id };
        this._renderTimeline();
        this._renderInspector();
        this._renderCurrentFrame();
        this._scheduleSave();
    }

    _updatePlayhead() {
        const ph = this.container.querySelector('#ceTlPlayhead');
        if (!ph) return;
        const clip = this.clips[this.currentIndex];
        const cur = clip?.video ? (clip.video.currentTime - (clip.trimStart || 0)) : 0;
        const t = this._clipStartTime(this.currentIndex) + Math.max(0, cur);
        ph.style.left = (t * this.pxPerSecond) + 'px';
        const subs2 = this._subs();
        const subCount = subs2 ? subs2.tracks.filter(t => t.kind !== 'textOverlay').length : 0;
        const textCount = subs2 ? subs2.tracks.filter(t => t.kind === 'textOverlay').length : 0;
        ph.style.height = (RULER_H + VIDEO_LANE_H + subCount * SUB_LANE_H + textCount * TEXT_LANE_H) + 'px';
        const handle = this.container.querySelector('#ceTlPlayheadHandle');
        if (handle && !handle._wired) {
            handle._wired = true;
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._playheadDrag = { startX: e.clientX, startLeft: parseFloat(ph.style.left) || 0 };
            });
        }
    }

    // ---- Drag (move + edge trim) ----

    _beginDrag(e, el, kind) {
        e.preventDefault();
        e.stopPropagation();
        const handle = e.target.closest('.ce-clip-handle');
        const mode = handle ? (handle.dataset.handle === 'l' ? 'trimL' : 'trimR') : 'move';
        this._dragState = {
            kind, mode, el,
            startX: e.clientX,
            initialLeft: parseFloat(el.style.left) || 0,
            initialWidth: parseFloat(el.style.width) || 0,
            id: kind === 'entry' ? el.dataset.entryId : el.dataset.clipId,
            idx: kind === 'clip' ? parseInt(el.dataset.clipIdx) : -1,
            moved: false,
        };
    }

    _onDocMouseMove = (e) => {
        // Playhead drag
        if (this._playheadDrag) {
            const dx = e.clientX - this._playheadDrag.startX;
            const ph = this.container.querySelector('#ceTlPlayhead');
            if (ph) {
                const newLeft = Math.max(0, this._playheadDrag.startLeft + dx);
                ph.style.left = newLeft + 'px';
            }
            return;
        }
        const ds = this._dragState;
        if (!ds) return;
        const dx = e.clientX - ds.startX;
        if (Math.abs(dx) > 2) ds.moved = true;
        if (ds.mode === 'move') {
            ds.el.style.left = Math.max(0, ds.initialLeft + dx) + 'px';
        } else if (ds.mode === 'trimR') {
            ds.el.style.width = Math.max(12, ds.initialWidth + dx) + 'px';
        } else if (ds.mode === 'trimL') {
            const newLeft = Math.max(0, ds.initialLeft + dx);
            const delta = newLeft - ds.initialLeft;
            const newWidth = Math.max(12, ds.initialWidth - delta);
            ds.el.style.left = newLeft + 'px';
            ds.el.style.width = newWidth + 'px';
        }
    };

    _onDocMouseUp = () => {
        // Playhead drag end
        if (this._playheadDrag) {
            const ph = this.container.querySelector('#ceTlPlayhead');
            if (ph) {
                const t = Math.max(0, parseFloat(ph.style.left) / this.pxPerSecond);
                this._playheadDrag = null;
                this.seekToTime(t);
            } else {
                this._playheadDrag = null;
            }
            return;
        }
        const ds = this._dragState;
        if (!ds) return;
        this._dragState = null;
        if (!ds.moved) {
            if (ds.kind === 'entry') { this.selection = { kind: 'entry', id: ds.id }; this._renderTimeline(); this._renderInspector(); }
            else if (ds.kind === 'clip') {
                this.selection = { kind: 'clip', id: ds.id };
                // Always select and show first frame (paused)
                this.pause();
                const idx = this.clips.findIndex(c => c.short.id === ds.id);
                if (idx >= 0) {
                    this.currentIndex = idx;
                    const clip = this.clips[idx];
                    if (clip.hasVideo && clip.video) {
                        const seekTime = clip.trimStart || 0;
                        try { clip.video.currentTime = seekTime; } catch {}
                        if (clip.video.readyState >= 2) {
                            this._renderCurrentFrame();
                        } else {
                            const onSeeked = () => {
                                clip.video.removeEventListener('seeked', onSeeked);
                                clip.video.removeEventListener('loadeddata', onSeeked);
                                if (!this._destroyed) this._renderCurrentFrame();
                            };
                            clip.video.addEventListener('seeked', onSeeked);
                            clip.video.addEventListener('loadeddata', onSeeked);
                        }
                    } else {
                        this._renderCurrentFrame();
                    }
                }
                this._renderInspector();
                this._renderTimeline();
            }
            return;
        }
        const left = parseFloat(ds.el.style.left) || 0;
        const width = parseFloat(ds.el.style.width) || 0;
        const startT = left / this.pxPerSecond;
        const endT = (left + width) / this.pxPerSecond;
        if (ds.kind === 'entry') this._commitEntryDrag(ds.id, ds.mode, startT, endT);
        else if (ds.kind === 'clip') this._commitClipDrag(ds.idx, ds.mode, startT, endT);
    };

    _commitEntryDrag(id, mode, startT, endT) {
        const subs = this._subs();
        const e = subs.entries.find(x => x.id === id);
        if (!e) return;
        this._pushUndo();
        if (mode === 'move') { const dur = e.endTime - e.startTime; e.startTime = Math.max(0, startT); e.endTime = e.startTime + dur; }
        else if (mode === 'trimL') { e.startTime = Math.max(0, Math.min(startT, e.endTime - 0.2)); }
        else if (mode === 'trimR') { e.endTime = Math.max(e.startTime + 0.2, endT); }
        if (e.sourceShortId && mode === 'move') e.sourceShortId = null;
        this._renderTimeline();
        this._renderCurrentFrame();
        this._scheduleSave();
    }

    _commitClipDrag(idx, mode, startT, endT) {
        const clip = this.clips[idx];
        if (!clip) return;
        this._pushUndo();
        if (mode === 'move') {
            const mid = (startT + endT) / 2;
            let acc = 0, targetIdx = 0;
            for (let i = 0; i < this.clips.length; i++) {
                if (i === idx) continue;
                const d = this.clips[i].duration || this.defaultDuration;
                if (mid < acc + d / 2) break;
                acc += d;
                targetIdx++;
            }
            if (targetIdx !== idx) {
                const [moved] = this.clips.splice(idx, 1);
                this.clips.splice(targetIdx, 0, moved);
                this.clips.forEach((c, i) => { c.short.order = i + 1; });
                if (idx === this.currentIndex) this.currentIndex = targetIdx;
                this._syncDialogueEntries();
                this._scheduleSave();
            }
        } else if (mode === 'trimL' || mode === 'trimR') {
            const fullDur = clip.duration || this.defaultDuration;
            if (mode === 'trimL') {
                const newTrimStart = Math.max(0, Math.min(startT - this._clipStartTime(idx) + (clip.trimStart || 0), fullDur - 0.5));
                clip.trimStart = newTrimStart;
                clip.short._trimStart = newTrimStart;
            } else {
                const visDur = Math.max(0.5, endT - this._clipStartTime(idx));
                const newTrimEnd = Math.min(fullDur, (clip.trimStart || 0) + visDur);
                clip.trimEnd = newTrimEnd;
                clip.short._trimEnd = newTrimEnd;
            }
            this._syncDialogueEntries();
            this._scheduleSave();
        }
        this._renderTimeline();
        this._renderCurrentFrame();
    }

    // ---- Subtitle CRUD ----

    _createEntry(trackId, startT) {
        const subs = this._subs();
        const tr = subs.tracks.find(t => t.id === trackId);
        if (!tr) return;
        this._pushUndo();
        const isTextOverlay = tr.kind === 'textOverlay';
        const entry = {
            id: crypto.randomUUID(),
            trackId, startTime: startT, endTime: startT + (isTextOverlay ? 3 : 2),
            text: isTextOverlay ? '新文字' : '新字幕',
            lines: isTextOverlay ? [{ text: '新文字' }] : undefined,
            style: isTextOverlay ? { ...DEFAULT_OVERLAY_STYLE } : null,
            template: isTextOverlay ? null : undefined,
            sourceShortId: null,
        };
        subs.entries.push(entry);
        this.selection = { kind: 'entry', id: entry.id };
        this._renderTimeline();
        this._renderInspector();
        this._renderCurrentFrame();
        this._scheduleSave();
    }

    _deleteEntry(id) {
        const subs = this._subs();
        const e = subs.entries.find(x => x.id === id);
        if (!e) return;
        this._pushUndo();
        const tr = subs.tracks.find(t => t.id === e.trackId);
        if (e.sourceShortId && tr) {
            const sh = this.shorts.find(s => s.id === e.sourceShortId);
            if (sh) {
                if (tr.kind === 'dialogue') sh.dialogue = '';
                if (tr.kind === 'narration') sh.narration = '';
            }
        }
        subs.entries = subs.entries.filter(x => x.id !== id);
        this.selection = { kind: null, id: null };
        this._renderTimeline();
        this._renderInspector();
        this._renderCurrentFrame();
        this._scheduleSave();
    }

    _addCustomTrack() {
        const subs = this._subs();
        if (!subs) { showToast('请先打开一个项目', 'error'); return; }
        this._pushUndo();
        subs.tracks.push({
            id: crypto.randomUUID(), name: '自定义字幕', kind: 'custom',
            visible: true, locked: false,
            defaultStyle: { ...DEFAULT_STYLE },
        });
        this._renderTimeline();
        this._scheduleSave();
    }

    _addTextOverlayTrack() {
        const subs = this._subs();
        if (!subs) { showToast('请先打开一个项目', 'error'); return; }
        this._pushUndo();
        subs.tracks.push({
            id: crypto.randomUUID(), name: '文字覆盖', kind: 'textOverlay',
            visible: true, locked: false,
            defaultStyle: { ...DEFAULT_OVERLAY_STYLE },
        });
        this._renderTimeline();
        this._scheduleSave();
    }

    _deleteTrack(tr) {
        if (!confirm(`确认删除轨道"${tr.name}"及其所有字幕？`)) return;
        this._pushUndo();
        const subs = this._subs();
        subs.entries = subs.entries.filter(e => e.trackId !== tr.id);
        subs.tracks = subs.tracks.filter(t => t.id !== tr.id);
        if (this.selection.kind === 'track' && this.selection.id === tr.id) this.selection = { kind: null, id: null };
        this._renderTimeline();
        this._renderInspector();
        this._renderCurrentFrame();
        this._scheduleSave();
    }

    _clearTrack(tr) {
        if (!confirm(`清空轨道"${tr.name}"中的所有字幕？`)) return;
        this._pushUndo();
        const subs = this._subs();
        if (tr.kind === 'dialogue') this.shorts.forEach(s => { s.dialogue = ''; });
        if (tr.kind === 'narration') this.shorts.forEach(s => { s.narration = ''; });
        subs.entries = subs.entries.filter(e => e.trackId !== tr.id);
        this._renderTimeline();
        this._renderCurrentFrame();
        this._scheduleSave();
    }

    async _aiGenerateForTrack(tr) {
        if (!this.project) { showToast('缺少项目上下文', 'error'); return; }
        if (tr.kind === 'dialogue') {
            this._syncDialogueEntries();
            this._renderTimeline();
            this._renderCurrentFrame();
            this._scheduleSave();
            showToast('已从台词字段同步', 'success');
            return;
        }
        if (!this.generateSubtitlesFn) { showToast('AI 字幕生成器不可用', 'error'); return; }
        this._pushUndo();
        const btn = this.container.querySelector(`[data-th-action="ai"][data-th-id="${tr.id}"]`);
        if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
        try {
            const results = await this.generateSubtitlesFn(this.project, 'narration');
            const subs = this._subs();
            subs.entries = subs.entries.filter(e => e.trackId !== tr.id);
            results.forEach(r => {
                const idx = this.clips.findIndex(c => c.short.id === r.shortId);
                if (idx < 0 || !r.text || !r.text.trim()) return;
                const start = this._clipStartTime(idx);
                const end = start + this._clipVisibleDuration(this.clips[idx]);
                subs.entries.push({
                    id: crypto.randomUUID(), trackId: tr.id,
                    startTime: start, endTime: end,
                    text: r.text.trim(), style: null, sourceShortId: r.shortId,
                });
                if (tr.kind === 'narration') {
                    const sh = this.shorts.find(s => s.id === r.shortId);
                    if (sh) sh.narration = r.text.trim();
                }
            });
            this._renderTimeline();
            this._renderCurrentFrame();
            this._scheduleSave();
            showToast(`AI 生成了 ${results.length} 条字幕`, 'success');
        } catch (err) {
            showToast(`AI 生成失败: ${err.message}`, 'error');
        } finally {
            if (btn) { btn.textContent = '🤖'; btn.disabled = false; }
        }
    }

    // ---- Inspector ----

    _renderInspector() {
        const host = this.container.querySelector('#ceInspector');
        if (!host) return;
        const subs = this._subs();
        if (this.selection.kind === 'entry' && subs) {
            const e = subs.entries.find(x => x.id === this.selection.id);
            if (e) {
                const tr = subs.tracks.find(t => t.id === e.trackId);
                if (tr && tr.kind === 'textOverlay') {
                    host.innerHTML = this._textOverlayInspectorHTML(e);
                    this._wireTextOverlayInspector(e);
                    return;
                }
                host.innerHTML = this._entryInspectorHTML(e);
                this._wireEntryInspector(e);
                return;
            }
        }
        if (this.selection.kind === 'track' && subs) {
            const tr = subs.tracks.find(x => x.id === this.selection.id);
            if (tr) { host.innerHTML = this._trackInspectorHTML(tr); this._wireTrackInspector(tr); return; }
        }
        if (this.selection.kind === 'clip') {
            const sh = this.shorts.find(s => s.id === this.selection.id);
            if (sh) { host.innerHTML = this._clipInspectorHTML(sh); this._wireClipInspector(sh); return; }
        }
        host.innerHTML = `<div class="ce-insp-empty">点击时间线上的片段或字幕进行编辑<br><br>操作提示：<ul><li>拖动 = 移动</li><li>边缘拖动 = 调整时长</li><li>双击空白处 = 新建字幕/文字</li><li>双击片段 = 跳转</li></ul></div>`;
    }

    _styleFieldsHTML(style) {
        const s = { ...DEFAULT_STYLE, ...(style || {}) };
        return `
            <div class="ce-insp-row"><label>字号</label><input type="range" min="12" max="96" value="${s.fontSize}" data-style="fontSize"><span class="ce-insp-val">${s.fontSize}</span></div>
            <div class="ce-insp-row"><label>字体</label>
                <select data-style="fontFamily">${Object.keys(FONT_FAMILIES).map(k => `<option value="${k}" ${s.fontFamily === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
            </div>
            <div class="ce-insp-row"><label>样式</label>
                <label class="ce-insp-chk"><input type="checkbox" data-style="fontWeight" ${s.fontWeight === 'bold' ? 'checked' : ''}> 粗体</label>
                <label class="ce-insp-chk"><input type="checkbox" data-style="italic" ${s.italic ? 'checked' : ''}> 斜体</label>
            </div>
            <div class="ce-insp-row"><label>颜色</label><input type="color" value="${s.color}" data-style="color"></div>
            <div class="ce-insp-row"><label>描边</label><input type="color" value="${s.outlineColor}" data-style="outlineColor"><input type="number" min="0" max="8" value="${s.outlineWidth}" data-style="outlineWidth" style="width:46px"></div>
            <div class="ce-insp-row"><label>阴影</label><label class="ce-insp-chk"><input type="checkbox" data-style="shadow" ${s.shadow ? 'checked' : ''}> 启用</label></div>
            <div class="ce-insp-row"><label>背景</label><input type="color" value="${s.bg}" data-style="bg"><input type="range" min="0" max="100" value="${Math.round(s.bgOpacity * 100)}" data-style="bgOpacity" style="flex:1"><span class="ce-insp-val">${Math.round(s.bgOpacity * 100)}%</span></div>
            <div class="ce-insp-row"><label>位置</label>
                <select data-style="position">
                    <option value="top" ${s.position === 'top' ? 'selected' : ''}>顶部</option>
                    <option value="middle" ${s.position === 'middle' ? 'selected' : ''}>中部</option>
                    <option value="bottom" ${s.position === 'bottom' ? 'selected' : ''}>底部</option>
                </select>
                <input type="number" value="${s.offsetY}" data-style="offsetY" style="width:60px" title="Y 偏移 px">
            </div>`;
    }

    _entryInspectorHTML(e) {
        const subs = this._subs();
        const trackOpts = subs.tracks.map(t => `<option value="${t.id}" ${t.id === e.trackId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
        return `
            <div class="ce-insp-title">字幕</div>
            <div class="ce-insp-row"><label>文本</label><textarea data-field="text" rows="3">${escapeHtml(e.text)}</textarea></div>
            <div class="ce-insp-row"><label>轨道</label><select data-field="trackId">${trackOpts}</select></div>
            <div class="ce-insp-row"><label>开始</label><input type="number" step="0.1" min="0" value="${e.startTime.toFixed(2)}" data-field="startTime"><span class="ce-insp-val">${this._fmt(e.startTime)}</span></div>
            <div class="ce-insp-row"><label>结束</label><input type="number" step="0.1" min="0" value="${e.endTime.toFixed(2)}" data-field="endTime"><span class="ce-insp-val">${this._fmt(e.endTime)}</span></div>
            <div class="ce-insp-section">样式覆盖 <span class="ce-insp-hint">(留空使用轨道默认)</span></div>
            ${this._styleFieldsHTML(e.style)}
            <div class="ce-insp-actions">
                <button class="clipeditor-btn-sm" data-action="reset">重置为轨道默认</button>
                <button class="clipeditor-btn-sm ce-th-btn-danger" data-action="delete">删除</button>
            </div>`;
    }

    _trackInspectorHTML(tr) {
        return `
            <div class="ce-insp-title">轨道默认样式 · ${escapeHtml(tr.name)}</div>
            ${this._styleFieldsHTML(tr.defaultStyle)}`;
    }

    _clipInspectorHTML(sh) {
        const clip = this.clips.find(c => c.short.id === sh.id);
        const isTrimmed = clip && this._isClipTrimmed(clip);
        const fullDur = clip ? (clip.duration || this.defaultDuration) : this.defaultDuration;
        const trimStart = clip ? (clip.trimStart || 0) : 0;
        const trimEnd = clip ? (clip.trimEnd ?? fullDur) : fullDur;
        const visDur = clip ? this._clipVisibleDuration(clip).toFixed(1) : '';
        const isVideo = clip && clip.hasVideo;
        return `
            <div class="ce-insp-title">片段 #${sh.order}</div>
            <div class="ce-insp-row"><label>原始时长</label>${isVideo ? `<span class="ce-insp-val">${fullDur.toFixed ? fullDur.toFixed(1) : fullDur}s</span>` : `<input type="number" step="0.5" min="0.5" max="120" value="${fullDur}" data-field="baseDuration" style="width:70px"><span class="ce-insp-val">s</span>`}</div>
            <div class="ce-insp-row"><label>开始裁剪</label><input type="number" step="0.1" min="0" max="${(fullDur - 0.5).toFixed(1)}" value="${trimStart.toFixed(1)}" data-field="trimStart" style="width:70px"><span class="ce-insp-val">s</span></div>
            <div class="ce-insp-row"><label>结束裁剪</label><input type="number" step="0.1" min="0.5" max="${fullDur.toFixed ? fullDur.toFixed(1) : fullDur}" value="${trimEnd.toFixed(1)}" data-field="trimEnd" style="width:70px"><span class="ce-insp-val">s</span></div>
            <div class="ce-insp-row"><label>显示时长</label><span class="ce-insp-val">${visDur}s${isTrimmed ? ' ⚠️' : ''}</span></div>
            ${isTrimmed ? '<div class="ce-insp-actions"><button class="clipeditor-btn-sm" data-action="resetLength">↺ 重置为原始时长</button></div>' : ''}
            <div class="ce-insp-row"><label>角色台词</label><textarea data-field="dialogue" rows="3" placeholder="(此台词会内嵌到视频音频中)">${escapeHtml(sh.dialogue || '')}</textarea></div>
            <div class="ce-insp-row"><label>旁白</label><textarea data-field="narration" rows="3" placeholder="(后期叠加字幕)">${escapeHtml(sh.narration || '')}</textarea></div>
            <div class="ce-insp-hint">📌 修改台词/旁白后会自动同步到对应字幕轨。</div>`;
    }

    _wireEntryInspector(e) {
        const host = this.container.querySelector('#ceInspector');
        host.querySelectorAll('[data-field]').forEach(el => {
            el.onfocus = () => this._pushUndo();
            el.oninput = () => {
                const f = el.dataset.field;
                if (f === 'text') e.text = el.value;
                else if (f === 'trackId') e.trackId = el.value;
                else if (f === 'startTime') e.startTime = Math.max(0, Number(el.value) || 0);
                else if (f === 'endTime') e.endTime = Math.max(e.startTime + 0.1, Number(el.value) || 0);
                this._renderTimeline();
                this._renderCurrentFrame();
                this._scheduleSave();
                if (e.sourceShortId && f === 'text') {
                    const tr = this._subs().tracks.find(t => t.id === e.trackId);
                    const sh = this.shorts.find(s => s.id === e.sourceShortId);
                    if (sh && tr) {
                        if (tr.kind === 'dialogue') sh.dialogue = e.text;
                        if (tr.kind === 'narration') sh.narration = e.text;
                    }
                }
            };
        });
        this._wireStyleFields(host, (key, val) => {
            if (!e.style) e.style = {};
            e.style[key] = val;
            this._renderCurrentFrame();
            this._scheduleSave();
        });
        host.querySelector('[data-action="reset"]').onclick = () => { this._pushUndo(); e.style = null; this._renderInspector(); this._renderCurrentFrame(); this._scheduleSave(); };
        host.querySelector('[data-action="delete"]').onclick = () => this._deleteEntry(e.id);
    }

    // ---- Text Overlay Inspector ----

    _textOverlayLineEditorHTML(lines) {
        if (!lines || !lines.length) lines = [{ text: '' }];
        return lines.map((l, i) => {
            const ls = { ...DEFAULT_OVERLAY_STYLE, ...l };
            return `
            <div class="ce-line-editor" data-line-idx="${i}">
                <div class="ce-insp-row">
                    <label>行${i + 1}</label>
                    <input type="text" data-line-field="text" value="${escapeHtml(l.text || '')}" style="flex:1">
                    <button class="ce-th-btn ce-th-btn-danger" data-line-action="del" data-line-idx="${i}" title="删除行"${lines.length <= 1 ? ' disabled' : ''}>✕</button>
                </div>
                <div class="ce-insp-row ce-line-style-row">
                    <input type="number" min="8" max="120" value="${ls.fontSize || 32}" data-line-field="fontSize" style="width:46px" title="字号">
                    <select data-line-field="fontFamily" title="字体">${Object.keys(FONT_FAMILIES).map(k => `<option value="${k}" ${(ls.fontFamily || 'system') === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
                    <input type="color" value="${ls.color || '#ffffff'}" data-line-field="color" title="颜色">
                    <label class="ce-insp-chk"><input type="checkbox" data-line-field="fontWeight" ${ls.fontWeight === 'bold' ? 'checked' : ''}> B</label>
                    <label class="ce-insp-chk"><input type="checkbox" data-line-field="italic" ${ls.italic ? 'checked' : ''}> I</label>
                    <input type="number" min="0" max="20" value="${ls.letterSpacing || 0}" data-line-field="letterSpacing" style="width:42px" title="字间距">
                </div>
            </div>`;
        }).join('');
    }

    _textOverlayInspectorHTML(e) {
        const s = { ...DEFAULT_OVERLAY_STYLE, ...(e.style || {}) };
        const templateOpts = Object.entries(TEXT_OVERLAY_TEMPLATES).map(([k, v]) =>
            `<option value="${k}" ${e.template === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`
        ).join('');
        const lines = e.lines && e.lines.length ? e.lines : [{ text: e.text || '' }];
        return `
            <div class="ce-insp-title">🔤 文字覆盖</div>
            <div class="ce-insp-row"><label>模板</label>
                <select data-field="template">
                    <option value="" ${!e.template ? 'selected' : ''}>自定义</option>
                    ${templateOpts}
                </select>
            </div>
            <div class="ce-insp-section">文字行 <button class="ce-th-btn" id="ceAddLineBtn" title="添加行">＋行</button></div>
            <div id="ceLineEditors">${this._textOverlayLineEditorHTML(lines)}</div>
            <div class="ce-insp-row"><label>开始</label><input type="number" step="0.1" min="0" value="${e.startTime.toFixed(2)}" data-field="startTime"><span class="ce-insp-val">${this._fmt(e.startTime)}</span></div>
            <div class="ce-insp-row"><label>结束</label><input type="number" step="0.1" min="0" value="${e.endTime.toFixed(2)}" data-field="endTime"><span class="ce-insp-val">${this._fmt(e.endTime)}</span></div>
            <div class="ce-insp-section">整体位置 <span class="ce-insp-hint">(百分比)</span></div>
            <div class="ce-insp-row"><label>X</label><input type="range" min="0" max="100" value="${s.posX}" data-style="posX"><span class="ce-insp-val">${s.posX}%</span></div>
            <div class="ce-insp-row"><label>Y</label><input type="range" min="0" max="100" value="${s.posY}" data-style="posY"><span class="ce-insp-val">${s.posY}%</span></div>
            <div class="ce-insp-row"><label>宽度</label><input type="range" min="10" max="100" value="${s.width || 60}" data-style="width"><span class="ce-insp-val">${s.width || 60}%</span></div>
            <div class="ce-insp-section">整体效果</div>
            <div class="ce-insp-row"><label>描边</label><input type="color" value="${s.outlineColor}" data-style="outlineColor"><input type="number" min="0" max="8" value="${s.outlineWidth}" data-style="outlineWidth" style="width:46px"></div>
            <div class="ce-insp-row"><label>阴影</label><label class="ce-insp-chk"><input type="checkbox" data-style="shadow" ${s.shadow ? 'checked' : ''}> 启用</label></div>
            <div class="ce-insp-row"><label>背景</label><input type="color" value="${s.bg}" data-style="bg"><input type="range" min="0" max="100" value="${Math.round(s.bgOpacity * 100)}" data-style="bgOpacity" style="flex:1"><span class="ce-insp-val">${Math.round(s.bgOpacity * 100)}%</span></div>
            <div class="ce-insp-actions">
                <button class="clipeditor-btn-sm" data-action="reset">重置样式</button>
                <button class="clipeditor-btn-sm ce-th-btn-danger" data-action="delete">删除</button>
            </div>`;
    }

    _wireTextOverlayInspector(e) {
        const host = this.container.querySelector('#ceInspector');
        // Ensure lines array exists
        if (!e.lines || !e.lines.length) e.lines = [{ text: e.text || '' }];

        // Template selector
        const tplSelect = host.querySelector('[data-field="template"]');
        if (tplSelect) {
            tplSelect.onchange = () => {
                this._pushUndo();
                const tplKey = tplSelect.value;
                if (tplKey && TEXT_OVERLAY_TEMPLATES[tplKey]) {
                    const tpl = TEXT_OVERLAY_TEMPLATES[tplKey];
                    e.template = tplKey;
                    e.style = { ...tpl.style };
                    e.lines = JSON.parse(JSON.stringify(tpl.defaultLines));
                    e.text = e.lines.map(l => l.text).join('\n');
                } else {
                    e.template = null;
                }
                this._renderInspector();
                this._renderTimeline();
                this._renderCurrentFrame();
                this._scheduleSave();
            };
        }

        // Add line button
        const addLineBtn = host.querySelector('#ceAddLineBtn');
        if (addLineBtn) {
            addLineBtn.onclick = () => {
                this._pushUndo();
                e.lines.push({ text: '新行', fontSize: 24 });
                e.text = e.lines.map(l => l.text).join('\n');
                this._renderInspector();
                this._renderCurrentFrame();
                this._scheduleSave();
            };
        }

        // Wire per-line editors
        this._wireLineEditors(host, e);

        // Time fields
        host.querySelectorAll('[data-field]').forEach(el => {
            if (el.dataset.field === 'template') return;
            el.onfocus = () => this._pushUndo();
            el.oninput = () => {
                const f = el.dataset.field;
                if (f === 'startTime') e.startTime = Math.max(0, Number(el.value) || 0);
                else if (f === 'endTime') e.endTime = Math.max(e.startTime + 0.1, Number(el.value) || 0);
                this._renderTimeline();
                this._renderCurrentFrame();
                this._scheduleSave();
            };
        });

        // Style fields
        this._wireStyleFields(host, (key, val) => {
            if (!e.style) e.style = { ...DEFAULT_OVERLAY_STYLE };
            e.style[key] = val;
            this._renderCurrentFrame();
            this._scheduleSave();
        });
        host.querySelector('[data-action="reset"]').onclick = () => {
            this._pushUndo();
            e.style = { ...DEFAULT_OVERLAY_STYLE };
            e.lines = [{ text: e.text || '新文字' }];
            e.template = null;
            this._renderInspector();
            this._renderCurrentFrame();
            this._scheduleSave();
        };
        host.querySelector('[data-action="delete"]').onclick = () => this._deleteEntry(e.id);
    }

    _wireLineEditors(host, e) {
        host.querySelectorAll('.ce-line-editor').forEach(editor => {
            const idx = parseInt(editor.dataset.lineIdx);
            const line = e.lines[idx];
            if (!line) return;

            editor.querySelectorAll('[data-line-field]').forEach(el => {
                el.oninput = () => {
                    const f = el.dataset.lineField;
                    if (f === 'text') line.text = el.value;
                    else if (f === 'fontSize') line.fontSize = Math.max(8, Number(el.value) || 24);
                    else if (f === 'fontFamily') line.fontFamily = el.value;
                    else if (f === 'color') line.color = el.value;
                    else if (f === 'fontWeight') line.fontWeight = el.checked ? 'bold' : 'normal';
                    else if (f === 'italic') line.italic = el.checked;
                    else if (f === 'letterSpacing') line.letterSpacing = Math.max(0, Number(el.value) || 0);
                    e.text = e.lines.map(l => l.text).join('\n');
                    this._renderTimeline();
                    this._renderCurrentFrame();
                    this._scheduleSave();
                };
            });

            const delBtn = editor.querySelector('[data-line-action="del"]');
            if (delBtn) {
                delBtn.onclick = () => {
                    if (e.lines.length <= 1) return;
                    this._pushUndo();
                    e.lines.splice(idx, 1);
                    e.text = e.lines.map(l => l.text).join('\n');
                    this._renderInspector();
                    this._renderCurrentFrame();
                    this._scheduleSave();
                };
            }
        });
    }

    _wireTrackInspector(tr) {
        const host = this.container.querySelector('#ceInspector');
        this._wireStyleFields(host, (key, val) => {
            if (!tr.defaultStyle) tr.defaultStyle = { ...DEFAULT_STYLE };
            tr.defaultStyle[key] = val;
            this._renderCurrentFrame();
            this._scheduleSave();
        });
    }

    _wireClipInspector(sh) {
        const host = this.container.querySelector('#ceInspector');
        const resetBtn = host.querySelector('[data-action="resetLength"]');
        if (resetBtn) {
            resetBtn.onclick = () => {
                const clip = this.clips.find(c => c.short.id === sh.id);
                if (clip) this._resetClipLength(clip);
            };
        }
        host.querySelectorAll('[data-field]').forEach(el => {
            el.onfocus = () => this._pushUndo();
            el.oninput = () => {
                const f = el.dataset.field;
                const clip = this.clips.find(c => c.short.id === sh.id);
                if (f === 'dialogue') sh.dialogue = el.value;
                else if (f === 'narration') sh.narration = el.value;
                else if (f === 'baseDuration' && clip && !clip.hasVideo) {
                    const val = Math.max(0.5, Math.min(120, Number(el.value) || this.defaultDuration));
                    clip.duration = val;
                    sh.duration = val;
                    clip.trimEnd = clip.trimEnd != null ? Math.min(clip.trimEnd, val) : null;
                    sh._trimEnd = clip.trimEnd;
                }
                else if (f === 'trimStart' && clip) {
                    const fullDur = clip.duration || this.defaultDuration;
                    const val = Math.max(0, Math.min(Number(el.value) || 0, fullDur - 0.5));
                    clip.trimStart = val;
                    sh._trimStart = val;
                    if (clip.trimEnd != null && clip.trimEnd <= val + 0.5) {
                        clip.trimEnd = Math.min(fullDur, val + 0.5);
                        sh._trimEnd = clip.trimEnd;
                    }
                }
                else if (f === 'trimEnd' && clip) {
                    const fullDur = clip.duration || this.defaultDuration;
                    const val = Math.max((clip.trimStart || 0) + 0.5, Math.min(Number(el.value) || fullDur, fullDur));
                    clip.trimEnd = val;
                    sh._trimEnd = val;
                }
                this._syncDialogueEntries();
                this._syncNarrationEntries(sh);
                this._renderTimeline();
                this._renderCurrentFrame();
                this._scheduleSave();
            };
        });
    }

    _syncNarrationEntries(sh) {
        const subs = this._subs();
        const tr = this._narrationTrack();
        if (!subs || !tr) return;
        const idx = this.clips.findIndex(c => c.short.id === sh.id);
        if (idx < 0) return;
        const start = this._clipStartTime(idx);
        const end = start + this._clipVisibleDuration(this.clips[idx]);
        let entry = subs.entries.find(e => e.trackId === tr.id && e.sourceShortId === sh.id);
        if (sh.narration && sh.narration.trim()) {
            if (entry) { entry.text = sh.narration.trim(); entry.startTime = start; entry.endTime = end; }
            else subs.entries.push({ id: crypto.randomUUID(), trackId: tr.id, startTime: start, endTime: end, text: sh.narration.trim(), style: null, sourceShortId: sh.id });
        } else if (entry) {
            subs.entries = subs.entries.filter(e => e.id !== entry.id);
        }
    }

    _wireStyleFields(host, onChange) {
        host.querySelectorAll('[data-style]').forEach(el => {
            el.oninput = () => {
                const k = el.dataset.style;
                let v;
                if (el.type === 'checkbox') v = (k === 'fontWeight') ? (el.checked ? 'bold' : 'normal') : el.checked;
                else if (el.type === 'number' || el.type === 'range') {
                    v = Number(el.value);
                    if (k === 'bgOpacity') v = v / 100;
                } else v = el.value;
                onChange(k, v);
                const valSpan = el.parentElement.querySelector('.ce-insp-val');
                if (valSpan) {
                    if (k === 'bgOpacity') valSpan.textContent = `${Math.round(v * 100)}%`;
                    else if (k === 'posX' || k === 'posY' || k === 'width') valSpan.textContent = `${v}%`;
                    else valSpan.textContent = v;
                }
            };
        });
    }

    // ---- Subtitle drawing on canvas ----

    _drawActiveSubtitles(globalT) {
        const subs = this._subs();
        if (!subs) return;
        subs.tracks.forEach(tr => {
            if (!tr.visible) return;
            const active = subs.entries.filter(e => e.trackId === tr.id && globalT >= e.startTime && globalT < e.endTime);
            // If no entries found with strict <, check if we're exactly at an endTime (show last frame)
            const display = active.length > 0 ? active : subs.entries.filter(e => e.trackId === tr.id && globalT === e.endTime && !subs.entries.some(e2 => e2.trackId === tr.id && e2.startTime === globalT));
            if (tr.kind === 'textOverlay') {
                display.forEach(e => this._drawTextOverlay(this.ctx, this.canvas, e, { ...tr.defaultStyle, ...(e.style || {}) }));
            } else {
                display.forEach(e => this._drawSubtitle(this.ctx, this.canvas, e.text, { ...tr.defaultStyle, ...(e.style || {}) }));
            }
        });
    }

    _drawSubtitle(ctx, canvas, text, style) {
        if (!text) return;
        const s = { ...DEFAULT_STYLE, ...style };
        const fontSize = Math.max(12, Math.round(s.fontSize * (canvas.width / 1280)));
        const family = FONT_FAMILIES[s.fontFamily] || FONT_FAMILIES.system;
        const weight = s.fontWeight === 'bold' ? 'bold' : '';
        const italic = s.italic ? 'italic' : '';
        ctx.font = `${italic} ${weight} ${fontSize}px ${family}`.trim();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const maxW = canvas.width * 0.86;
        const lines = this._wrapText(ctx, text, maxW, 4);
        const lineHeight = Math.round(fontSize * 1.3);
        const totalH = lines.length * lineHeight;
        let yAnchor;
        if (s.position === 'top') yAnchor = canvas.height * 0.1 + totalH / 2;
        else if (s.position === 'middle') yAnchor = canvas.height * 0.5;
        else yAnchor = canvas.height * 0.9 - totalH / 2;
        yAnchor += s.offsetY || 0;

        if (s.bgOpacity > 0) {
            const padX = Math.round(fontSize * 0.5);
            const padY = Math.round(fontSize * 0.25);
            const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
            const bx = canvas.width / 2 - widest / 2 - padX;
            const by = yAnchor - totalH / 2 - padY;
            ctx.fillStyle = this._withAlpha(s.bg, s.bgOpacity);
            ctx.fillRect(bx, by, widest + padX * 2, totalH + padY * 2);
        }
        if (s.shadow) {
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 6; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 2;
        }
        lines.forEach((line, i) => {
            const y = yAnchor - totalH / 2 + lineHeight / 2 + i * lineHeight;
            if (s.outlineWidth > 0) {
                ctx.lineWidth = s.outlineWidth;
                ctx.strokeStyle = s.outlineColor;
                ctx.lineJoin = 'round';
                ctx.strokeText(line, canvas.width / 2, y);
            }
            ctx.fillStyle = s.color;
            ctx.fillText(line, canvas.width / 2, y);
        });
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }

    _drawTextOverlay(ctx, canvas, entry, style) {
        const entryLines = entry.lines;
        const text = entry.text;
        if (!entryLines?.length && !text) return;
        const s = { ...DEFAULT_OVERLAY_STYLE, ...style };
        const scale = canvas.width / 1280;
        const posX = (s.posX ?? 50) / 100;
        const posY = (s.posY ?? 50) / 100;
        const maxW = canvas.width * ((s.width || 60) / 100);
        const anchorX = canvas.width * posX;

        // Build renderable lines: each has own font/color/size
        const renderLines = [];
        const lineDefs = (entryLines && entryLines.length > 0) ? entryLines : (text || '').split('\n').map(t => ({ text: t }));
        lineDefs.forEach(ld => {
            const ls = { ...s, ...ld };
            const fontSize = Math.max(12, Math.round((ls.fontSize || s.fontSize) * scale));
            const family = FONT_FAMILIES[ls.fontFamily || s.fontFamily] || FONT_FAMILIES.system;
            const weight = (ls.fontWeight === 'bold') ? 'bold' : '';
            const italic = ls.italic ? 'italic' : '';
            const font = `${italic} ${weight} ${fontSize}px ${family}`.trim();
            const lineHeight = Math.round(fontSize * 1.4);
            renderLines.push({
                text: ld.text || '',
                font, fontSize, lineHeight,
                color: ls.color || s.color,
                outlineColor: ls.outlineColor ?? s.outlineColor,
                outlineWidth: ls.outlineWidth ?? s.outlineWidth,
                letterSpacing: ls.letterSpacing || 0,
            });
        });

        // Measure total block height
        const totalH = renderLines.reduce((sum, l) => sum + l.lineHeight, 0);
        const anchorY = canvas.height * posY;
        let curY = anchorY - totalH / 2;

        // Measure widest line for background
        let widest = 0;
        renderLines.forEach(l => {
            ctx.font = l.font;
            const w = l.letterSpacing > 0
                ? this._measureSpacedText(ctx, l.text, l.letterSpacing * scale)
                : ctx.measureText(l.text).width;
            if (w > widest) widest = w;
        });
        widest = Math.min(widest, maxW);

        // Background box with rounded corners
        if (s.bgOpacity > 0) {
            const padX = Math.round(renderLines[0].fontSize * 0.6);
            const padY = Math.round(renderLines[0].fontSize * 0.35);
            const bx = anchorX - widest / 2 - padX;
            const by = curY - padY;
            const bw = widest + padX * 2;
            const bh = totalH + padY * 2;
            const radius = Math.round(renderLines[0].fontSize * 0.2);
            ctx.fillStyle = this._withAlpha(s.bg, s.bgOpacity);
            ctx.beginPath();
            ctx.moveTo(bx + radius, by);
            ctx.lineTo(bx + bw - radius, by);
            ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius);
            ctx.lineTo(bx + bw, by + bh - radius);
            ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - radius, by + bh);
            ctx.lineTo(bx + radius, by + bh);
            ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - radius);
            ctx.lineTo(bx, by + radius);
            ctx.quadraticCurveTo(bx, by, bx + radius, by);
            ctx.closePath();
            ctx.fill();
        }

        if (s.shadow) {
            ctx.shadowColor = 'rgba(0,0,0,0.7)';
            ctx.shadowBlur = 8; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 3;
        }

        // Draw each line
        renderLines.forEach(l => {
            const y = curY + l.lineHeight / 2;
            ctx.font = l.font;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (l.outlineWidth > 0) {
                ctx.lineWidth = l.outlineWidth;
                ctx.strokeStyle = l.outlineColor;
                ctx.lineJoin = 'round';
                if (l.letterSpacing > 0) this._drawSpacedText(ctx, l.text, anchorX, y, l.letterSpacing * scale, 'stroke');
                else ctx.strokeText(l.text, anchorX, y);
            }
            ctx.fillStyle = l.color;
            if (l.letterSpacing > 0) this._drawSpacedText(ctx, l.text, anchorX, y, l.letterSpacing * scale, 'fill');
            else ctx.fillText(l.text, anchorX, y);
            curY += l.lineHeight;
        });

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }

    _measureSpacedText(ctx, text, spacing) {
        let w = 0;
        for (const ch of text) w += ctx.measureText(ch).width + spacing;
        return w - spacing; // remove trailing
    }

    _drawSpacedText(ctx, text, cx, cy, spacing, mode) {
        const totalW = this._measureSpacedText(ctx, text, spacing);
        let x = cx - totalW / 2;
        ctx.textAlign = 'left';
        for (const ch of text) {
            if (mode === 'stroke') ctx.strokeText(ch, x, cy);
            else ctx.fillText(ch, x, cy);
            x += ctx.measureText(ch).width + spacing;
        }
        ctx.textAlign = 'center';
    }

    _withAlpha(hex, alpha) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex);
        if (!m) return `rgba(0,0,0,${alpha})`;
        const n = parseInt(m[1], 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
    }

    _wrapText(ctx, text, maxWidth, maxLines) {
        const lines = [];
        let line = '';
        for (const ch of text) {
            const test = line + ch;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = ch;
                if (lines.length >= maxLines) break;
            } else {
                line = test;
            }
        }
        if (line && lines.length < maxLines) lines.push(line);
        if (lines.length === maxLines && line && line.length < text.length) {
            lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
        }
        return lines;
    }

    // ---- Stage rendering ----

    _showFirstFrame() {
        const clip = this.clips[this.currentIndex];
        if (!clip) return;
        if (clip.hasVideo && clip.video) {
            try { clip.video.currentTime = clip.trimStart || 0; } catch {}
            const onReady = () => { if (this._destroyed) return; clip.video.removeEventListener('seeked', onReady); this._renderCurrentFrame(); };
            if (clip.video.readyState >= 2) this._renderCurrentFrame();
            else clip.video.addEventListener('seeked', onReady);
        } else {
            this._renderCurrentFrame();
        }
    }

    _renderCurrentFrame() {
        const clip = this.clips[this.currentIndex];
        if (!clip) return;
        const { canvas, ctx } = this;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (clip.hasVideo && clip.video && clip.video.readyState >= 2) {
            ctx.drawImage(clip.video, 0, 0, canvas.width, canvas.height);
        } else if (clip.isPicturebook && clip.image && clip.image.complete && clip.image.naturalWidth) {
            this._drawImageCover(ctx, canvas, clip.image);
        } else if (!clip.hasVideo && !clip.isPicturebook) {
            this._drawPlaceholder(ctx, canvas, clip.short);
        }
        const cur = clip.video ? (clip.video.currentTime - (clip.trimStart || 0)) : 0;
        const globalT = this._clipStartTime(this.currentIndex) + Math.max(0, cur);
        this._drawActiveSubtitles(globalT);
        this._drawOverlayHandles();
        this._updateTotalTime();
        this._updatePlayhead();
    }

    _drawPlaceholder(ctx, canvas, short) {
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#333';
        ctx.font = `${Math.round(canvas.height * 0.12)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('🎬', canvas.width / 2, canvas.height * 0.35);
        ctx.fillStyle = '#888';
        ctx.font = `bold ${Math.round(canvas.height * 0.06)}px sans-serif`;
        ctx.fillText(`短片 #${short.order}`, canvas.width / 2, canvas.height * 0.48);
        const desc = short.prompt || short.description || '未生成';
        ctx.fillStyle = '#666';
        ctx.font = `${Math.round(canvas.height * 0.035)}px sans-serif`;
        const lines = this._wrapText(ctx, desc, canvas.width * 0.8, 3);
        lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, canvas.height * 0.56 + i * Math.round(canvas.height * 0.05)));
        const statusLabel = { pending: '待生成', running: '生成中', failed: '生成失败' }[short.status] || '未生成';
        ctx.fillStyle = short.status === 'failed' ? '#f87171' : '#555';
        ctx.font = `${Math.round(canvas.height * 0.03)}px sans-serif`;
        ctx.fillText(statusLabel, canvas.width / 2, canvas.height * 0.82);
        ctx.textAlign = 'start';
    }

    _drawImageCover(ctx, canvas, img) {
        const cw = canvas.width, ch = canvas.height;
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const scale = Math.max(cw / iw, ch / ih);
        const sw = cw / scale, sh = ch / scale;
        const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    }

    // ---- Playback ----

    _playCurrentClip() {
        if (this._destroyed || !this.playing) return;
        const clip = this.clips[this.currentIndex];
        if (!clip) { this.pause(); return; }
        if (clip.hasVideo && clip.video) {
            const trimStart = clip.trimStart || 0;
            const trimEnd = clip.trimEnd ?? clip.duration;
            if (clip.video.currentTime < trimStart) {
                try { clip.video.currentTime = trimStart; } catch {}
            }
            clip.video.play().catch(() => {});
            clip.video.onended = () => this._advanceClip();
            // Also check trimEnd during render loop
            clip.video.ontimeupdate = () => {
                if (trimEnd != null && clip.video.currentTime >= trimEnd) {
                    clip.video.ontimeupdate = null;
                    this._advanceClip();
                }
            };
            this._startRenderLoop();
        } else {
            this._renderCurrentFrame();
            this._placeholderTimer = setTimeout(() => this._advanceClip(), this._clipVisibleDuration(clip) * 1000);
            this._startRenderLoop();
        }
    }

    _startRenderLoop() {
        const loop = () => {
            if (this._destroyed || !this.playing) return;
            this._renderCurrentFrame();
            this._raf = requestAnimationFrame(loop);
        };
        cancelAnimationFrame(this._raf);
        loop();
    }

    _advanceClip() {
        if (this._destroyed) return;
        clearTimeout(this._placeholderTimer);
        const prevClip = this.clips[this.currentIndex];
        if (prevClip?.video) { prevClip.video.pause(); prevClip.video.onended = null; prevClip.video.ontimeupdate = null; }
        if (this.currentIndex + 1 >= this.clips.length) {
            // Interactive plot: check if current branch has choices to offer
            if (this._onPlotBranchEnd && this._onPlotBranchEnd()) return;
            this.playing = false;
            this._updatePlayBtn();
            this._updateTotalTime();
            return;
        }
        const nextIndex = this.currentIndex + 1;
        const trans = TRANSITIONS[this.transition] || TRANSITIONS.cut;
        if (this.transition === 'cut') {
            this.currentIndex = nextIndex;
            this._renderTimeline();
            this._playCurrentClip();
            return;
        }
        this.transitionActive = true;
        const prevFrame = this._captureFrame(prevClip);
        const nextClip = this.clips[nextIndex];
        let nextFrame = null;
        if (nextClip.hasVideo && nextClip.video) { try { nextClip.video.currentTime = nextClip.trimStart || 0; } catch {} nextFrame = nextClip.video; }
        else if (nextClip.isPicturebook && nextClip.image?.complete && nextClip.image.naturalWidth) nextFrame = nextClip.image;
        const start = performance.now();
        const animate = (now) => {
            if (this._destroyed) return;
            const t = Math.min((now - start) / TRANSITION_DURATION_MS, 1);
            const { canvas, ctx } = this;
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (t < 0.5 && prevFrame) ctx.drawImage(prevFrame, 0, 0, canvas.width, canvas.height);
            else if (nextClip.hasVideo && nextFrame && nextFrame.readyState >= 2) ctx.drawImage(nextFrame, 0, 0, canvas.width, canvas.height);
            else if (nextClip.isPicturebook && nextFrame) this._drawImageCover(ctx, canvas, nextFrame);
            else if (!nextClip.hasVideo && !nextClip.isPicturebook) this._drawPlaceholder(ctx, canvas, nextClip.short);
            const ready = nextFrame ? (nextFrame instanceof HTMLImageElement ? true : nextFrame.readyState >= 2) : null;
            trans.apply(canvas, ctx, prevFrame, ready ? nextFrame : null, t);
            const globalT = this._clipStartTime(nextIndex);
            this._drawActiveSubtitles(globalT);
            if (t < 1) this._raf = requestAnimationFrame(animate);
            else {
                this.transitionActive = false;
                this.currentIndex = nextIndex;
                this._renderTimeline();
                this._playCurrentClip();
            }
        };
        cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(animate);
    }

    _captureFrame(clip) {
        if (!clip) return null;
        try {
            const off = document.createElement('canvas');
            off.width = this.canvas.width; off.height = this.canvas.height;
            const o = off.getContext('2d');
            if (clip.hasVideo && clip.video && clip.video.readyState >= 2) o.drawImage(clip.video, 0, 0, off.width, off.height);
            else if (clip.isPicturebook && clip.image?.complete && clip.image.naturalWidth) this._drawImageCover(o, off, clip.image);
            else { o.fillStyle = '#111'; o.fillRect(0, 0, off.width, off.height); }
            return off;
        } catch { return null; }
    }

    // ---- Misc UI ----

    _updateTotalTime() {
        const el = this.container.querySelector('#ceTime');
        if (!el) return;
        const clip = this.clips[this.currentIndex];
        const cur = clip?.video ? clip.video.currentTime : 0;
        el.textContent = `${this._fmt(this._clipStartTime(this.currentIndex) + cur)} / ${this._fmt(this._totalDuration())}`;
    }

    _fmt(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    _updatePlayBtn() {
        const btn = this.container.querySelector('.clipeditor-play-btn');
        if (btn) btn.textContent = this.playing ? '⏸' : '▶';
    }

    // ---- Canvas overlay drag & resize ----

    _wireCanvasOverlayDrag() {
        this.canvas.addEventListener('mousedown', this._onCanvasMouseDown);
        this.canvas.addEventListener('mousemove', this._onCanvasMouseHover);
    }

    _getActiveTextOverlays() {
        const subs = this._subs();
        if (!subs) return [];
        const clip = this.clips[this.currentIndex];
        const cur = clip?.video ? (clip.video.currentTime - (clip.trimStart || 0)) : 0;
        const globalT = this._clipStartTime(this.currentIndex) + Math.max(0, cur);
        const results = [];
        subs.tracks.forEach(tr => {
            if (!tr.visible || tr.kind !== 'textOverlay') return;
            subs.entries.filter(e => e.trackId === tr.id && globalT >= e.startTime && globalT < e.endTime).forEach(e => {
                const s = { ...DEFAULT_OVERLAY_STYLE, ...(tr.defaultStyle || {}), ...(e.style || {}) };
                results.push({ entry: e, style: s });
            });
        });
        return results;
    }

    _overlayBounds(entry, style) {
        const s = { ...DEFAULT_OVERLAY_STYLE, ...style };
        const scale = this.canvas.width / 1280;
        const posX = (s.posX ?? 50) / 100;
        const posY = (s.posY ?? 50) / 100;
        const maxW = this.canvas.width * ((s.width || 60) / 100);
        const anchorX = this.canvas.width * posX;
        const anchorY = this.canvas.height * posY;

        const lineDefs = (entry.lines && entry.lines.length > 0) ? entry.lines : (entry.text || '').split('\n').map(t => ({ text: t }));
        let totalH = 0;
        let widest = 0;
        const ctx = this.ctx;
        lineDefs.forEach(ld => {
            const ls = { ...s, ...ld };
            const fontSize = Math.max(12, Math.round((ls.fontSize || s.fontSize) * scale));
            const family = FONT_FAMILIES[ls.fontFamily || s.fontFamily] || FONT_FAMILIES.system;
            const weight = (ls.fontWeight === 'bold') ? 'bold' : '';
            const italic = ls.italic ? 'italic' : '';
            ctx.font = `${italic} ${weight} ${fontSize}px ${family}`.trim();
            const lineHeight = Math.round(fontSize * 1.4);
            totalH += lineHeight;
            const w = ls.letterSpacing > 0
                ? this._measureSpacedText(ctx, ld.text || '', (ls.letterSpacing || 0) * scale)
                : ctx.measureText(ld.text || '').width;
            if (w > widest) widest = w;
        });
        widest = Math.min(widest, maxW);
        const padX = Math.round((lineDefs[0]?.fontSize || s.fontSize) * scale * 0.6);
        const padY = Math.round((lineDefs[0]?.fontSize || s.fontSize) * scale * 0.35);
        return {
            x: anchorX - widest / 2 - padX,
            y: anchorY - totalH / 2 - padY,
            w: widest + padX * 2,
            h: totalH + padY * 2,
        };
    }

    _hitTestOverlays(mx, my) {
        const overlays = this._getActiveTextOverlays();
        const HANDLE_SIZE = 8;
        // Check in reverse order (top-most first)
        for (let i = overlays.length - 1; i >= 0; i--) {
            const { entry, style } = overlays[i];
            const b = this._overlayBounds(entry, style);
            // Check right edge resize handle
            if (mx >= b.x + b.w - HANDLE_SIZE && mx <= b.x + b.w + HANDLE_SIZE && my >= b.y && my <= b.y + b.h) {
                return { entry, style, mode: 'resize' };
            }
            // Check left edge resize handle
            if (mx >= b.x - HANDLE_SIZE && mx <= b.x + HANDLE_SIZE && my >= b.y && my <= b.y + b.h) {
                return { entry, style, mode: 'resize' };
            }
            // Check within bounds (move)
            if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
                return { entry, style, mode: 'move' };
            }
        }
        return null;
    }

    _onCanvasMouseDown = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const hit = this._hitTestOverlays(mx, my);
        if (!hit) return;
        e.preventDefault();
        e.stopPropagation();
        const s = { ...DEFAULT_OVERLAY_STYLE, ...(hit.entry.style || {}) };
        this._pushUndo();
        this._canvasOverlayDrag = {
            entryId: hit.entry.id,
            mode: hit.mode,
            startX: e.clientX,
            startY: e.clientY,
            origPosX: s.posX ?? 50,
            origPosY: s.posY ?? 50,
            origWidth: s.width || 60,
        };
        // Select this entry
        this.selection = { kind: 'entry', id: hit.entry.id };
        this._renderTimeline();
        this._renderInspector();
        this._renderCurrentFrame();
        document.addEventListener('mousemove', this._onCanvasDragMove);
        document.addEventListener('mouseup', this._onCanvasDragEnd);
    };

    _onCanvasDragMove = (e) => {
        const ds = this._canvasOverlayDrag;
        if (!ds) return;
        const subs = this._subs();
        const entry = subs?.entries.find(x => x.id === ds.entryId);
        if (!entry) return;
        if (!entry.style) entry.style = { ...DEFAULT_OVERLAY_STYLE };
        const dx = e.clientX - ds.startX;
        const dy = e.clientY - ds.startY;
        if (ds.mode === 'move') {
            const dPctX = (dx / this.canvas.width) * 100;
            const dPctY = (dy / this.canvas.height) * 100;
            entry.style.posX = Math.max(0, Math.min(100, ds.origPosX + dPctX));
            entry.style.posY = Math.max(0, Math.min(100, ds.origPosY + dPctY));
        } else if (ds.mode === 'resize') {
            const dPctW = (dx / this.canvas.width) * 200; // *2 since width extends both sides from center
            entry.style.width = Math.max(10, Math.min(100, ds.origWidth + dPctW));
        }
        this._renderCurrentFrame();
        this._renderInspector();
    };

    _onCanvasDragEnd = () => {
        this._canvasOverlayDrag = null;
        document.removeEventListener('mousemove', this._onCanvasDragMove);
        document.removeEventListener('mouseup', this._onCanvasDragEnd);
        this._renderCurrentFrame();
        this._scheduleSave();
    };

    _onCanvasMouseHover = (e) => {
        if (this._canvasOverlayDrag) return;
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const hit = this._hitTestOverlays(mx, my);
        if (hit) {
            this.canvas.style.cursor = hit.mode === 'resize' ? 'ew-resize' : 'move';
        } else {
            this.canvas.style.cursor = '';
        }
    };

    _drawOverlayHandles() {
        if (this.selection.kind !== 'entry') return;
        const subs = this._subs();
        if (!subs) return;
        const entry = subs.entries.find(x => x.id === this.selection.id);
        if (!entry) return;
        const tr = subs.tracks.find(t => t.id === entry.trackId);
        if (!tr || tr.kind !== 'textOverlay' || !tr.visible) return;
        const style = { ...(tr.defaultStyle || {}), ...(entry.style || {}) };
        const b = this._overlayBounds(entry, style);
        const ctx = this.ctx;
        // Draw selection border
        ctx.save();
        ctx.strokeStyle = 'rgba(99,102,241,0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.setLineDash([]);
        // Draw corner/edge handles
        const HS = 6;
        ctx.fillStyle = 'rgba(99,102,241,0.9)';
        // Left-center
        ctx.fillRect(b.x - HS / 2, b.y + b.h / 2 - HS / 2, HS, HS);
        // Right-center
        ctx.fillRect(b.x + b.w - HS / 2, b.y + b.h / 2 - HS / 2, HS, HS);
        // Top-left corner
        ctx.fillRect(b.x - HS / 2, b.y - HS / 2, HS, HS);
        // Top-right corner
        ctx.fillRect(b.x + b.w - HS / 2, b.y - HS / 2, HS, HS);
        // Bottom-left corner
        ctx.fillRect(b.x - HS / 2, b.y + b.h - HS / 2, HS, HS);
        // Bottom-right corner
        ctx.fillRect(b.x + b.w - HS / 2, b.y + b.h - HS / 2, HS, HS);
        ctx.restore();
    }
}
