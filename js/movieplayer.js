// ============ Interactive Movie Player ============
// Standalone runtime for playing interactive movies.
// Accepts either a full project JSON (*.aimovie.md) or a plot export (*.aiplot.md).
// Plays shorts belonging to the current plot node; at node end, shows choices
// and navigates to the chosen next node. Supports linear single-node playback too.

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default class MoviePlayer {
    /**
     * @param {Object} opts
     * @param {HTMLElement} opts.container
     * @param {Object} [opts.project]        full project JSON
     * @param {Object} [opts.plot]           exported plot payload
     * @param {boolean} [opts.autoplay=false]
     */
    constructor({ container, project = null, plot = null, autoplay = false }) {
        this.container = container;
        this._history = [];  // stack of visited nodeIds
        this._listeners = {};
        this._destroyed = false;
        this.load({ project, plot });
        this._build();
        if (autoplay) this.play();
    }

    // ---- Public API ----
    on(event, cb) { (this._listeners[event] ||= []).push(cb); return this; }
    _emit(event, ...args) { (this._listeners[event] || []).forEach(cb => { try { cb(...args); } catch {} }); }

    load({ project = null, plot = null }) {
        // Normalize: we always compute a `state` with nodes map + shorts by id
        if (plot && plot.format === 'aiplot') {
            this._title = plot.title || '';
            this._synopsis = plot.synopsis || '';
            this._ratio = plot.settings?.ratio || '16:9';
            this._nodes = new Map((plot.plot?.nodes || []).map(n => [n.id, n]));
            this._rootId = plot.plot?.rootNodeId || (plot.plot?.nodes?.[0]?.id || null);
            this._shorts = new Map((plot.shorts || []).map(s => [s.id, s]));
        } else if (project) {
            this._title = project.title || '';
            this._synopsis = project.synopsis || '';
            this._ratio = project.settings?.ratio || '16:9';
            const plotNodes = project.plot?.nodes || [];
            this._nodes = new Map(plotNodes.map(n => [n.id, n]));
            this._rootId = project.plot?.rootNodeId || plotNodes[0]?.id || null;
            this._shorts = new Map((project.shorts || []).map(s => [s.id, s]));
            // Linear fallback: if no plot, synthesize a single node with all shorts
            if (!this._nodes.size) {
                const syntheticId = 'root';
                const sortedShorts = [...(project.shorts || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
                this._nodes.set(syntheticId, {
                    id: syntheticId,
                    name: project.title || '影片',
                    parentId: null,
                    childIds: [],
                    choices: [],
                    shortIds: sortedShorts.map(s => s.id),
                });
                this._rootId = syntheticId;
            }
        } else {
            throw new Error('MoviePlayer needs either project or plot');
        }
        this._currentNodeId = null;
        this._clipIndex = 0;
    }

    play() {
        if (this._destroyed) return;
        if (!this._currentNodeId) {
            this._currentNodeId = this._rootId;
            this._clipIndex = 0;
        }
        this._playCurrentClip();
        this._updatePlayBtn(true);
    }

    pause() {
        if (this._video) this._video.pause();
        this._clearImageTimer();
        this._updatePlayBtn(false);
    }

    jumpTo(nodeId) {
        const node = this._nodes.get(nodeId);
        if (!node) return;
        this._history.push(this._currentNodeId);
        this._currentNodeId = nodeId;
        this._clipIndex = 0;
        this._hideChoices();
        this._playCurrentClip();
        this._emit('nodeEnter', node);
    }

    back() {
        const prev = this._history.pop();
        if (!prev) return;
        this._currentNodeId = prev;
        this._clipIndex = 0;
        this._hideChoices();
        this._playCurrentClip();
    }

    restart() {
        this._history = [];
        this._currentNodeId = this._rootId;
        this._clipIndex = 0;
        this._hideChoices();
        this._playCurrentClip();
    }

    destroy() {
        this._destroyed = true;
        this.pause();
        this.container.innerHTML = '';
    }

    // ---- Build ----
    _build() {
        this.container.innerHTML = `
            <div class="mp-root" style="display:flex;flex-direction:column;height:100%;min-height:0;background:#000;color:#fff;font-family:system-ui,sans-serif;position:relative">
                <div class="mp-stage" style="flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden">
                    <video class="mp-video" style="max-width:100%;max-height:100%;display:none" playsinline></video>
                    <img class="mp-image" style="max-width:100%;max-height:100%;display:none;object-fit:contain">
                    <div class="mp-placeholder" style="color:#888;font-size:14px;display:none;text-align:center;padding:24px">
                        <div>该片段尚未生成视频</div>
                    </div>
                    <div class="mp-subtitle" style="position:absolute;left:0;right:0;bottom:8%;text-align:center;color:#fff;text-shadow:0 0 4px #000, 0 0 4px #000;font-size:clamp(14px,2.2vw,24px);padding:0 16px;pointer-events:none"></div>
                    <div class="mp-narration" style="position:absolute;left:0;right:0;top:6%;text-align:center;color:#ffe9a8;font-style:italic;text-shadow:0 0 4px #000;font-size:clamp(12px,1.8vw,20px);padding:0 16px;pointer-events:none"></div>
                    <div class="mp-choices" style="position:absolute;inset:0;background:rgba(0,0,0,0.65);display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px"></div>
                </div>
                <div class="mp-bar" style="flex:0 0 auto;padding:10px 14px;background:#0d0d14;border-top:1px solid #222;display:flex;gap:8px;align-items:center">
                    <button class="mp-play" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:600">▶</button>
                    <button class="mp-back" style="background:#1a1a2e;color:#ccc;border:1px solid #333;border-radius:8px;padding:8px 12px;cursor:pointer">↩ 返回</button>
                    <button class="mp-restart" style="background:#1a1a2e;color:#ccc;border:1px solid #333;border-radius:8px;padding:8px 12px;cursor:pointer">⟲ 重新开始</button>
                    <div style="flex:1"></div>
                    <div class="mp-title" style="font-size:13px;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%">${escapeHtml(this._title)}</div>
                </div>
            </div>
        `;
        this._video = this.container.querySelector('.mp-video');
        this._image = this.container.querySelector('.mp-image');
        this._placeholder = this.container.querySelector('.mp-placeholder');
        this._subtitleEl = this.container.querySelector('.mp-subtitle');
        this._narrationEl = this.container.querySelector('.mp-narration');
        this._choicesEl = this.container.querySelector('.mp-choices');
        this._playBtn = this.container.querySelector('.mp-play');
        this._backBtn = this.container.querySelector('.mp-back');
        this._restartBtn = this.container.querySelector('.mp-restart');
        this._playBtn.onclick = () => { if (this._video && !this._video.paused) this.pause(); else this.play(); };
        this._backBtn.onclick = () => this.back();
        this._restartBtn.onclick = () => this.restart();
        this._video.addEventListener('ended', () => this._onClipEnded());
        this._video.addEventListener('error', () => this._onClipEnded());
    }

    _updatePlayBtn(isPlaying) {
        if (this._playBtn) this._playBtn.textContent = isPlaying ? '⏸' : '▶';
    }

    _clearImageTimer() {
        if (this._imageTimer) { clearTimeout(this._imageTimer); this._imageTimer = null; }
    }

    _currentNode() { return this._currentNodeId ? this._nodes.get(this._currentNodeId) : null; }

    _currentClipShort() {
        const node = this._currentNode();
        if (!node) return null;
        const id = node.shortIds?.[this._clipIndex];
        return id ? this._shorts.get(id) : null;
    }

    _playCurrentClip() {
        if (this._destroyed) return;
        this._hideChoices();
        this._clearImageTimer();
        const node = this._currentNode();
        if (!node) return;
        if (this._clipIndex >= (node.shortIds?.length || 0)) {
            this._onNodeFinished();
            return;
        }
        const short = this._currentClipShort();
        if (!short) { this._clipIndex++; return this._playCurrentClip(); }
        this._renderSubtitle(short);
        // Prefer video, fall back to picturebook image, then placeholder
        if (short.videoUrl) {
            this._image.style.display = 'none';
            this._placeholder.style.display = 'none';
            this._video.style.display = 'block';
            this._video.src = short.videoUrl;
            this._video.currentTime = 0;
            this._video.play().catch(() => {});
        } else if (short.picturebookUrl || short.firstFrameUrl) {
            this._video.pause();
            this._video.style.display = 'none';
            this._placeholder.style.display = 'none';
            this._image.style.display = 'block';
            this._image.src = short.picturebookUrl || short.firstFrameUrl;
            const dur = (short.duration || 5) * 1000;
            this._imageTimer = setTimeout(() => this._onClipEnded(), dur);
        } else {
            this._video.style.display = 'none';
            this._image.style.display = 'none';
            this._placeholder.style.display = 'block';
            const dur = (short.duration || 5) * 1000;
            this._imageTimer = setTimeout(() => this._onClipEnded(), dur);
        }
        this._emit('clipStart', { node, short, clipIndex: this._clipIndex });
    }

    _renderSubtitle(short) {
        this._subtitleEl.textContent = short.dialogue || '';
        this._narrationEl.textContent = short.narration || '';
    }

    _onClipEnded() {
        if (this._destroyed) return;
        this._clipIndex++;
        const node = this._currentNode();
        if (!node || this._clipIndex >= (node.shortIds?.length || 0)) {
            this._onNodeFinished();
            return;
        }
        this._playCurrentClip();
    }

    _onNodeFinished() {
        const node = this._currentNode();
        if (!node) return;
        const choices = (node.choices || []).filter(c => c.targetNodeId && this._nodes.has(c.targetNodeId));
        this._emit('nodeEnd', { node, choices });
        if (choices.length === 0) {
            // Ending
            this._showEndScreen(node);
            return;
        }
        if (choices.length === 1) {
            this.jumpTo(choices[0].targetNodeId);
            return;
        }
        this._showChoices(choices);
    }

    _showChoices(choices) {
        this._choicesEl.innerHTML = `
            <div style="font-size:16px;font-weight:600;margin-bottom:8px">请选择你的行动</div>
            ${choices.map((c, i) => `<button class="mp-choice-btn" data-ci="${i}" style="background:#6366f1;color:#fff;border:none;border-radius:10px;padding:12px 28px;cursor:pointer;font-size:15px;font-weight:600;min-width:260px">${escapeHtml(c.label || '选项 ' + (i + 1))}</button>`).join('')}
        `;
        this._choicesEl.style.display = 'flex';
        this._choicesEl.querySelectorAll('.mp-choice-btn').forEach(btn => {
            btn.onclick = () => {
                const idx = Number(btn.getAttribute('data-ci'));
                const c = choices[idx];
                if (c?.targetNodeId) this.jumpTo(c.targetNodeId);
            };
        });
    }

    _showEndScreen(node) {
        const endingLabel = node.endingType === 'good' ? '🌟 好结局' : node.endingType === 'bad' ? '💔 坏结局' : node.endingType === 'neutral' ? '🔹 结局' : '🎬 完';
        this._choicesEl.innerHTML = `
            <div style="font-size:28px;font-weight:700;margin-bottom:4px">${escapeHtml(endingLabel)}</div>
            <div style="font-size:15px;color:#ccc;margin-bottom:16px">${escapeHtml(node.name || '')}</div>
            <button class="mp-end-restart" style="background:#6366f1;color:#fff;border:none;border-radius:10px;padding:12px 24px;cursor:pointer;font-weight:600">⟲ 重新开始</button>
            ${this._history.length ? '<button class="mp-end-back" style="background:#1a1a2e;color:#ccc;border:1px solid #333;border-radius:10px;padding:10px 20px;cursor:pointer">↩ 返回上一节点</button>' : ''}
        `;
        this._choicesEl.style.display = 'flex';
        const r = this._choicesEl.querySelector('.mp-end-restart');
        if (r) r.onclick = () => this.restart();
        const b = this._choicesEl.querySelector('.mp-end-back');
        if (b) b.onclick = () => this.back();
        this._emit('end', node);
    }

    _hideChoices() {
        if (this._choicesEl) { this._choicesEl.style.display = 'none'; this._choicesEl.innerHTML = ''; }
    }
}
