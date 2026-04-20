// ============ Plot Graph Editor ============
// Lightweight SVG DAG renderer/editor for interactive movie plot graphs.
// Consumes project.plot.nodes; emits events on select/edit/play/structureChange.

import {
    getPlotNode, getPlotNodes, getPlotRoot, plotNodePath,
    createPlotNode, addPlotChoice, removePlotNode, syncPlotFolders,
} from './state.js';
import { escapeHtml } from './utils.js';

const NODE_W = 160;
const NODE_H = 64;
const H_GAP = 48;
const V_GAP = 28;

export default class PlotGraph {
    /**
     * @param {Object} opts
     * @param {HTMLElement} opts.container
     * @param {Object} opts.project
     * @param {Function} [opts.onSelect]       (nodeId) => void
     * @param {Function} [opts.onPlay]         (nodeId) => void  user clicked play-from-node
     * @param {Function} [opts.onChange]       () => void        structure/name changed; parent should save
     */
    constructor({ container, project, onSelect, onPlay, onChange }) {
        this.container = container;
        this.project = project;
        this.onSelect = onSelect || (() => {});
        this.onPlay = onPlay || (() => {});
        this.onChange = onChange || (() => {});
        this.selectedId = null;
        this._connectFrom = null;     // when user is drawing an edge
        this._build();
        this.render();
    }

    setProject(project) { this.project = project; this.render(); }
    selectNode(id) { this.selectedId = id; this.render(); this.onSelect(id); }

    destroy() {
        this.container.innerHTML = '';
    }

    _build() {
        this.container.innerHTML = `
            <div class="plotgraph-wrap" style="display:flex;flex-direction:column;height:100%;min-height:0">
                <div class="plotgraph-toolbar" style="display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border-card);align-items:center;flex-wrap:wrap">
                    <button class="clipeditor-btn-sm" id="pgAddChild" title="为当前节点添加子节点">+ 子节点</button>
                    <button class="clipeditor-btn-sm" id="pgAddSibling" title="添加同级节点">+ 同级</button>
                    <button class="clipeditor-btn-sm" id="pgConnect" title="连接到其它节点（创建选项）">🔗 连接</button>
                    <button class="clipeditor-btn-sm" id="pgDelete" title="删除所选节点">🗑 删除</button>
                    <div style="flex:1"></div>
                    <button class="clipeditor-btn-sm" id="pgPlay" title="从所选节点开始播放">▶ 播放分支</button>
                    <button class="clipeditor-btn-sm" id="pgExport" title="导出互动电影文件 (.aiplot.md)">💾 导出 .aiplot</button>
                </div>
                <div class="plotgraph-canvas-wrap" style="flex:1;min-height:0;overflow:auto;position:relative;background:rgba(0,0,0,0.12)">
                    <svg class="plotgraph-svg" xmlns="http://www.w3.org/2000/svg" style="display:block"></svg>
                </div>
                <div class="plotgraph-inspector" id="pgInspector" style="border-top:1px solid var(--border-card);padding:8px;max-height:200px;overflow-y:auto;font-size:12px"></div>
            </div>
        `;
        this.svg = this.container.querySelector('.plotgraph-svg');
        this.inspector = this.container.querySelector('#pgInspector');
        this.container.querySelector('#pgAddChild').onclick = () => this._addChild();
        this.container.querySelector('#pgAddSibling').onclick = () => this._addSibling();
        this.container.querySelector('#pgConnect').onclick = () => this._startConnect();
        this.container.querySelector('#pgDelete').onclick = () => this._deleteSelected();
        this.container.querySelector('#pgPlay').onclick = () => { if (this.selectedId) this.onPlay(this.selectedId); };
        this.container.querySelector('#pgExport').onclick = () => this._exportPlot();
    }

    _ensurePlot() {
        if (!this.project.plot) this.project.plot = { rootNodeId: null, nodes: [] };
        if (!this.project.plot.nodes.length) {
            const root = createPlotNode(this.project, { name: '序幕' });
            this.selectedId = root.id;
            syncPlotFolders(this.project);
            this.onChange();
        }
    }

    // ---- Layout ----
    _layout() {
        this._ensurePlot();
        const nodes = getPlotNodes(this.project);
        const byId = new Map(nodes.map(n => [n.id, n]));
        const root = getPlotRoot(this.project);
        if (!root) return { positions: new Map(), width: 0, height: 0 };

        // Build depth per node + order within depth.
        const depthOf = new Map();
        const visited = new Set();
        const queue = [[root, 0]];
        const rows = []; // rows[d] = [nodeId,...]
        while (queue.length) {
            const [n, d] = queue.shift();
            if (visited.has(n.id)) continue;
            visited.add(n.id);
            depthOf.set(n.id, d);
            (rows[d] ||= []).push(n.id);
            n.childIds.forEach(cid => {
                const c = byId.get(cid);
                if (c && !visited.has(cid)) queue.push([c, d + 1]);
            });
        }
        // Any orphans → bottom row
        nodes.forEach(n => {
            if (!visited.has(n.id)) {
                const d = (rows.length || 0);
                depthOf.set(n.id, d);
                (rows[d] ||= []).push(n.id);
            }
        });

        // Compute positions
        const positions = new Map();
        const cols = Math.max(1, Math.max(...rows.map(r => r?.length || 0)));
        const width = Math.max(800, cols * (NODE_W + H_GAP) + H_GAP);
        rows.forEach((row, d) => {
            if (!row) return;
            const totalW = row.length * NODE_W + (row.length - 1) * H_GAP;
            const x0 = Math.max(H_GAP, (width - totalW) / 2);
            row.forEach((id, i) => {
                positions.set(id, {
                    x: x0 + i * (NODE_W + H_GAP),
                    y: V_GAP + d * (NODE_H + V_GAP + 20),
                });
            });
        });
        const height = Math.max(320, rows.length * (NODE_H + V_GAP + 20) + V_GAP);
        return { positions, width, height };
    }

    // ---- Render ----
    render() {
        this._ensurePlot();
        const nodes = getPlotNodes(this.project);
        const { positions, width, height } = this._layout();
        this.svg.setAttribute('width', String(width));
        this.svg.setAttribute('height', String(height));
        this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        let svg = '';
        // Defs: arrow marker
        svg += `<defs>
            <marker id="pg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#818cf8"/>
            </marker>
        </defs>`;

        // Edges (choices)
        nodes.forEach(n => {
            const src = positions.get(n.id);
            if (!src) return;
            n.choices.forEach(ch => {
                const dst = positions.get(ch.targetNodeId);
                if (!dst) return;
                const x1 = src.x + NODE_W / 2;
                const y1 = src.y + NODE_H;
                const x2 = dst.x + NODE_W / 2;
                const y2 = dst.y;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                const labelText = escapeHtml(ch.label || '');
                svg += `<path d="M ${x1} ${y1} C ${x1} ${y1 + 30}, ${x2} ${y2 - 30}, ${x2} ${y2}"
                    stroke="#818cf8" stroke-width="1.5" fill="none" marker-end="url(#pg-arrow)" opacity="0.85"/>`;
                if (labelText) {
                    svg += `<g>
                        <rect x="${mx - 50}" y="${my - 10}" width="100" height="20" rx="4" fill="#1a1a2e" stroke="#818cf8" stroke-width="0.5"/>
                        <text x="${mx}" y="${my + 4}" fill="#a5b4fc" font-size="11" text-anchor="middle" style="pointer-events:none">${labelText}</text>
                    </g>`;
                }
            });
            // Implicit edges (childIds without a matching choice)
            n.childIds.forEach(cid => {
                if (n.choices.some(c => c.targetNodeId === cid)) return;
                const dst = positions.get(cid);
                if (!dst) return;
                const x1 = src.x + NODE_W / 2;
                const y1 = src.y + NODE_H;
                const x2 = dst.x + NODE_W / 2;
                const y2 = dst.y;
                svg += `<path d="M ${x1} ${y1} C ${x1} ${y1 + 30}, ${x2} ${y2 - 30}, ${x2} ${y2}"
                    stroke="#555" stroke-width="1" stroke-dasharray="4 4" fill="none" opacity="0.6"/>`;
            });
        });

        // Nodes
        nodes.forEach(n => {
            const p = positions.get(n.id);
            if (!p) return;
            const selected = n.id === this.selectedId;
            const isConnectSrc = this._connectFrom === n.id;
            const isEnding = !!n.endingType;
            const path = plotNodePath(this.project, n.id);
            const title = escapeHtml(n.name || '');
            const shots = n.shortIds.length;
            const fill = isEnding ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.18)';
            const stroke = selected ? '#fbbf24' : isConnectSrc ? '#60a5fa' : isEnding ? '#10b981' : 'rgba(99,102,241,0.8)';
            const strokeW = selected ? 2.5 : 1.5;
            svg += `<g class="pg-node" data-id="${n.id}" style="cursor:pointer">
                <rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="10"
                    fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"/>
                <text x="${p.x + 8}" y="${p.y + 18}" fill="#a5b4fc" font-size="10">plot${path}${isEnding ? ' · ' + n.endingType : ''}</text>
                <text x="${p.x + 8}" y="${p.y + 38}" fill="#e0e0e0" font-size="13" font-weight="600">${title}</text>
                <text x="${p.x + 8}" y="${p.y + 56}" fill="#888" font-size="10">${shots} 个镜头 · ${n.choices.length} 个选项</text>
            </g>`;
        });

        this.svg.innerHTML = svg;
        this._wireNodeEvents();
        this._renderInspector();
    }

    _wireNodeEvents() {
        this.svg.querySelectorAll('.pg-node').forEach(g => {
            g.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = g.getAttribute('data-id');
                if (this._connectFrom && this._connectFrom !== id) {
                    addPlotChoice(this.project, this._connectFrom, id, '选项');
                    this._connectFrom = null;
                    syncPlotFolders(this.project);
                    this.onChange();
                    this.render();
                    return;
                }
                this.selectNode(id);
            });
        });
        this.svg.addEventListener('click', () => {
            if (this._connectFrom) { this._connectFrom = null; this.render(); }
        });
    }

    // ---- Inspector ----
    _renderInspector() {
        if (!this.selectedId) {
            this.inspector.innerHTML = `<div style="color:var(--text-muted);font-size:12px">点击节点查看/编辑详情。使用 <b>+ 子节点</b> 构建分支，用 <b>🔗 连接</b> 创建跨支选项。</div>`;
            return;
        }
        const node = getPlotNode(this.project, this.selectedId);
        if (!node) { this.inspector.innerHTML = ''; return; }
        const path = plotNodePath(this.project, node.id);
        const shorts = this.project.shorts || [];
        const shortOptions = shorts
            .slice()
            .sort((a, b) => a.order - b.order)
            .map(s => `<option value="${s.id}" ${node.shortIds.includes(s.id) ? 'selected' : ''}>#${s.order} · ${escapeHtml((s.prompt || '').slice(0, 40))}</option>`)
            .join('');
        const choicesHtml = node.choices.map((c, i) => {
            const targets = getPlotNodes(this.project)
                .filter(n => n.id !== node.id)
                .map(n => `<option value="${n.id}" ${c.targetNodeId === n.id ? 'selected' : ''}>plot${plotNodePath(this.project, n.id)} · ${escapeHtml(n.name)}</option>`)
                .join('');
            return `<div class="ce-insp-row" data-cidx="${i}">
                <input data-field="label" type="text" value="${escapeHtml(c.label)}" placeholder="选项文字"/>
                <select data-field="targetNodeId">${targets}</select>
                <button class="clipeditor-btn-sm pg-del-choice" data-cidx="${i}" title="删除">×</button>
            </div>`;
        }).join('');
        this.inspector.innerHTML = `
            <div class="ce-insp-title">plot${path} · ${escapeHtml(node.name)}</div>
            <div class="ce-insp-row">
                <label>名称</label>
                <input id="pgName" type="text" value="${escapeHtml(node.name)}"/>
            </div>
            <div class="ce-insp-row">
                <label>结局</label>
                <select id="pgEnding">
                    <option value="" ${!node.endingType ? 'selected' : ''}>(非结局)</option>
                    <option value="good" ${node.endingType === 'good' ? 'selected' : ''}>好结局</option>
                    <option value="neutral" ${node.endingType === 'neutral' ? 'selected' : ''}>中性结局</option>
                    <option value="bad" ${node.endingType === 'bad' ? 'selected' : ''}>坏结局</option>
                </select>
            </div>
            <div class="ce-insp-section">镜头 (${node.shortIds.length})</div>
            <div class="ce-insp-row">
                <label>包含</label>
                <select id="pgShorts" multiple size="5" style="min-height:90px">${shortOptions}</select>
            </div>
            <div class="ce-insp-hint">按住 Ctrl/Cmd 多选；镜头会被加入 plot${path} 文件夹。</div>
            <div class="ce-insp-section">选项 (${node.choices.length})</div>
            ${choicesHtml || '<div class="ce-insp-hint">暂无选项 — 点击工具栏 “🔗 连接” 可连向其他节点。</div>'}
            <div class="ce-insp-actions">
                <button class="clipeditor-btn-sm" id="pgAddChoice">+ 选项</button>
            </div>
        `;

        const nameEl = this.inspector.querySelector('#pgName');
        nameEl.oninput = () => { node.name = nameEl.value; syncPlotFolders(this.project); this.onChange(); this._redrawSoon(); };

        const endEl = this.inspector.querySelector('#pgEnding');
        endEl.onchange = () => { node.endingType = endEl.value || null; this.onChange(); this._redrawSoon(); };

        const shortsEl = this.inspector.querySelector('#pgShorts');
        shortsEl.onchange = () => {
            const ids = Array.from(shortsEl.selectedOptions).map(o => o.value);
            // Remove from other nodes first (a short lives in only one plot node)
            getPlotNodes(this.project).forEach(n => {
                if (n.id === node.id) return;
                n.shortIds = n.shortIds.filter(id => !ids.includes(id));
            });
            node.shortIds = ids;
            syncPlotFolders(this.project);
            this.onChange();
            this._redrawSoon();
        };

        this.inspector.querySelectorAll('[data-cidx]').forEach(row => {
            const idx = Number(row.getAttribute('data-cidx'));
            if (Number.isNaN(idx)) return;
            const labelEl = row.querySelector('[data-field="label"]');
            const targetEl = row.querySelector('[data-field="targetNodeId"]');
            if (labelEl) labelEl.oninput = () => { node.choices[idx].label = labelEl.value; this.onChange(); this._redrawSoon(); };
            if (targetEl) targetEl.onchange = () => {
                node.choices[idx].targetNodeId = targetEl.value || null;
                // keep childIds in sync
                node.childIds = Array.from(new Set([
                    ...node.choices.map(c => c.targetNodeId).filter(Boolean),
                ]));
                this.onChange();
                this._redrawSoon();
            };
        });
        this.inspector.querySelectorAll('.pg-del-choice').forEach(btn => {
            btn.onclick = () => {
                const idx = Number(btn.getAttribute('data-cidx'));
                node.choices.splice(idx, 1);
                node.childIds = Array.from(new Set([
                    ...node.choices.map(c => c.targetNodeId).filter(Boolean),
                ]));
                this.onChange();
                this.render();
            };
        });
        const addChoice = this.inspector.querySelector('#pgAddChoice');
        if (addChoice) addChoice.onclick = () => {
            node.choices.push({ id: crypto.randomUUID(), label: '选项 ' + (node.choices.length + 1), targetNodeId: null });
            this.onChange();
            this.render();
        };
    }

    _redrawSoon() {
        clearTimeout(this._redrawTimer);
        this._redrawTimer = setTimeout(() => this.render(), 60);
    }

    // ---- Toolbar actions ----
    _addChild() {
        this._ensurePlot();
        const parentId = this.selectedId || getPlotRoot(this.project)?.id || null;
        const node = createPlotNode(this.project, { parentId, name: '新分支' });
        if (parentId) addPlotChoice(this.project, parentId, node.id, '选项 ' + (getPlotNode(this.project, parentId).choices.length));
        this.selectedId = node.id;
        syncPlotFolders(this.project);
        this.onChange();
        this.render();
    }

    _addSibling() {
        const cur = this.selectedId ? getPlotNode(this.project, this.selectedId) : null;
        const parentId = cur?.parentId || null;
        const node = createPlotNode(this.project, { parentId, name: '同级分支' });
        if (parentId) addPlotChoice(this.project, parentId, node.id, '选项 ' + (getPlotNode(this.project, parentId).choices.length));
        this.selectedId = node.id;
        syncPlotFolders(this.project);
        this.onChange();
        this.render();
    }

    _startConnect() {
        if (!this.selectedId) return;
        this._connectFrom = this.selectedId;
        this.render();
    }

    _deleteSelected() {
        if (!this.selectedId) return;
        if (!confirm('删除所选节点？其子节点会被重新挂到父节点上。')) return;
        removePlotNode(this.project, this.selectedId);
        this.selectedId = this.project.plot?.rootNodeId || null;
        syncPlotFolders(this.project);
        this.onChange();
        this.render();
    }

    async _exportPlot() {
        try {
            const mod = await import('./storage.js');
            const { fileName } = await mod.exportPlotFile(this.project);
            const { showToast } = await import('./utils.js');
            showToast(`已导出: ${fileName}`, 'success');
        } catch (err) {
            const { showToast } = await import('./utils.js');
            showToast('导出失败: ' + (err.message || err), 'error');
        }
    }
}
