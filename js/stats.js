// ============ Stats — LLM & Generation Usage Tracking ============

import { escapeHtml, $ } from './utils.js';
import { state } from './state.js';

/**
 * Lightweight token estimator: ~1 token per 4 chars for English, ~1 token per 2 chars for CJK mixed text.
 */
function estimateTokens(text) {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const rest = text.length - cjk;
    return Math.ceil(cjk / 1.5 + rest / 4);
}

// ---- In-memory call log (session-scoped, persisted to project) ----

const _callLog = [];

/**
 * Record an LLM call.
 * @param {object} entry
 * @param {string} entry.type - 'llm' | 'image' | 'video'
 * @param {string} entry.label - human-readable label (e.g. "分析剧本")
 * @param {string} [entry.model] - model name
 * @param {number} [entry.promptTokens] - from API usage, or estimated
 * @param {number} [entry.completionTokens] - from API usage, or estimated
 * @param {number} [entry.totalTokens] - from API usage, or sum
 * @param {boolean} [entry.success]
 * @param {string} [entry.error]
 * @param {number} [entry.durationMs] - wall-clock time
 */
export function recordCall(entry) {
    const record = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        type: entry.type || 'llm',
        label: entry.label || '',
        model: entry.model || '',
        promptTokens: entry.promptTokens || 0,
        completionTokens: entry.completionTokens || 0,
        totalTokens: entry.totalTokens || (entry.promptTokens || 0) + (entry.completionTokens || 0),
        success: entry.success !== false,
        error: entry.error || null,
        durationMs: entry.durationMs || 0,
    };
    _callLog.push(record);
    _refreshStatsPanel();
    return record;
}

/**
 * Helper to record an LLM call, estimating tokens from prompt + response text.
 */
export function recordLLMCall({ label, model, promptText, responseText, promptTokens, completionTokens, success, error, durationMs }) {
    const pt = promptTokens || estimateTokens(promptText);
    const ct = completionTokens || estimateTokens(responseText);
    return recordCall({
        type: 'llm',
        label,
        model,
        promptTokens: pt,
        completionTokens: ct,
        totalTokens: pt + ct,
        success,
        error,
        durationMs,
    });
}

export function recordImageCall({ label, model, success, error, durationMs }) {
    return recordCall({ type: 'image', label, model: model || 'jimeng', success, error, durationMs });
}

export function recordVideoCall({ label, model, duration, success, error, durationMs }) {
    return recordCall({
        type: 'video',
        label,
        model: model || '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        success,
        error,
        durationMs,
    });
}

export function getCallLog() { return _callLog; }

export function clearCallLog() {
    _callLog.length = 0;
    _refreshStatsPanel();
}

// ---- Aggregation helpers ----

function aggregate() {
    const llm = _callLog.filter(c => c.type === 'llm');
    const img = _callLog.filter(c => c.type === 'image');
    const vid = _callLog.filter(c => c.type === 'video');
    return {
        llm: {
            count: llm.length,
            success: llm.filter(c => c.success).length,
            failed: llm.filter(c => !c.success).length,
            promptTokens: llm.reduce((s, c) => s + c.promptTokens, 0),
            completionTokens: llm.reduce((s, c) => s + c.completionTokens, 0),
            totalTokens: llm.reduce((s, c) => s + c.totalTokens, 0),
        },
        image: {
            count: img.length,
            success: img.filter(c => c.success).length,
            failed: img.filter(c => !c.success).length,
        },
        video: {
            count: vid.length,
            success: vid.filter(c => c.success).length,
            failed: vid.filter(c => !c.success).length,
        },
        total: _callLog.length,
    };
}

// ---- Save / Load from project ----

export function saveStatsToProject(project) {
    if (!project) return;
    project.callStats = {
        log: [..._callLog],
        savedAt: new Date().toISOString(),
    };
}

export function loadStatsFromProject(project) {
    _callLog.length = 0;
    if (project?.callStats?.log) {
        _callLog.push(...project.callStats.log);
    }
    _refreshStatsPanel();
}

// ---- Sidebar Panel Rendering ----

let _collapsed = true;

export function renderStatsPanel() {
    const a = aggregate();
    const hasData = a.total > 0;

    return `
    <div id="statsPanel" class="stats-panel" style="border-top:1px solid var(--border);padding:8px 10px 6px;flex-shrink:0">
        <div class="flex items-center justify-between cursor-pointer" id="statsPanelToggle">
            <span class="text-xs font-semibold" style="color:var(--text-muted)">📊 用量统计</span>
            <div class="flex items-center gap-2">
                ${hasData ? `<span class="text-xs" style="color:var(--text-faint)">${a.total} 次调用</span>` : ''}
                <span class="text-xs" style="color:var(--text-faint)">${_collapsed ? '▶' : '▼'}</span>
            </div>
        </div>
        ${!_collapsed ? `
        <div class="mt-2 space-y-1" style="font-size:11px;color:var(--text-secondary)">
            ${a.llm.count > 0 ? `
            <div class="flex items-center justify-between">
                <span>🤖 LLM 调用</span>
                <span>${a.llm.success}${a.llm.failed ? `<span style="color:#fca5a5">/${a.llm.failed}失败</span>` : ''}</span>
            </div>
            <div class="flex items-center justify-between" style="padding-left:16px;color:var(--text-muted);font-size:10px">
                <span>Prompt 令牌</span><span>~${formatNumber(a.llm.promptTokens)}</span>
            </div>
            <div class="flex items-center justify-between" style="padding-left:16px;color:var(--text-muted);font-size:10px">
                <span>Completion 令牌</span><span>~${formatNumber(a.llm.completionTokens)}</span>
            </div>
            <div class="flex items-center justify-between" style="padding-left:16px;font-size:10px;font-weight:600">
                <span>总令牌</span><span>~${formatNumber(a.llm.totalTokens)}</span>
            </div>
            ` : ''}
            ${a.image.count > 0 ? `
            <div class="flex items-center justify-between">
                <span>🎨 图片生成</span>
                <span>${a.image.success}${a.image.failed ? `<span style="color:#fca5a5">/${a.image.failed}失败</span>` : ''}</span>
            </div>
            ` : ''}
            ${a.video.count > 0 ? `
            <div class="flex items-center justify-between">
                <span>🎬 视频生成</span>
                <span>${a.video.success}${a.video.failed ? `<span style="color:#fca5a5">/${a.video.failed}失败</span>` : ''}</span>
            </div>
            ` : ''}
            ${!hasData ? '<div style="color:var(--text-faint);text-align:center;padding:4px 0">暂无数据</div>' : ''}
            <div class="flex gap-2 mt-1">
                ${hasData ? '<button class="btn-text text-xs" id="statsDetailBtn">详情</button>' : ''}
                ${hasData ? '<button class="btn-text text-xs" id="statsClearBtn" style="color:#fca5a5">清空</button>' : ''}
            </div>
        </div>` : ''}
    </div>`;
}

export function attachStatsPanelEvents() {
    const toggle = $('statsPanelToggle');
    if (toggle) toggle.onclick = () => { _collapsed = !_collapsed; _refreshStatsPanel(); };
    if ($('statsDetailBtn')) $('statsDetailBtn').onclick = () => showStatsDetail();
    if ($('statsClearBtn')) $('statsClearBtn').onclick = () => {
        clearCallLog();
        const proj = state.currentProject;
        if (proj) { delete proj.callStats; }
    };
}

function _refreshStatsPanel() {
    const container = $('statsPanel');
    if (!container) return;
    const parent = container.parentElement;
    if (!parent) return;
    // Re-render just the stats panel in place
    const tmp = document.createElement('div');
    tmp.innerHTML = renderStatsPanel();
    const newPanel = tmp.firstElementChild;
    parent.replaceChild(newPanel, container);
    attachStatsPanelEvents();
}

function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

// ---- Detail Modal ----

function _ensureStatsModal() {
    let modal = $('statsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'statsModal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center hidden';
    modal.style.cssText = 'background:#0a0a0f';
    modal.innerHTML = `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;width:90vw;max-width:1100px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.5)">
            <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border);flex-shrink:0">
                <h3 class="text-lg font-semibold">📊 用量统计</h3>
                <span id="statsModalClose" class="cursor-pointer text-xl" style="color:var(--text-muted)">&times;</span>
            </div>
            <div id="statsModalBody" class="px-6 py-4" style="overflow-y:auto;flex:1;min-height:0"></div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#statsModalClose').onclick = () => modal.classList.add('hidden');
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
    return modal;
}

function showStatsDetail() {
    const modal = _ensureStatsModal();
    const body = modal.querySelector('#statsModalBody');
    const log = [..._callLog].reverse();
    const a = aggregate();
    const rows = log.map(c => {
        const statusStyle = c.success ? 'color:#6ee7b7' : 'color:#fca5a5';
        const typeIcon = { llm: '🤖', image: '🎨', video: '🎬' }[c.type] || '❓';
        const time = new Date(c.timestamp).toLocaleTimeString();
        return `<tr style="border-bottom:1px solid var(--border-secondary)">
            <td class="px-2 py-1.5">${typeIcon}</td>
            <td class="px-2 py-1.5">${escapeHtml(c.label)}</td>
            <td class="px-2 py-1.5">${escapeHtml(c.model || '-')}</td>
            <td class="px-2 py-1.5 text-right">${c.type === 'llm' ? '~' + formatNumber(c.promptTokens) : '-'}</td>
            <td class="px-2 py-1.5 text-right">${c.type === 'llm' ? '~' + formatNumber(c.completionTokens) : '-'}</td>
            <td class="px-2 py-1.5 text-right font-semibold">${c.type === 'llm' ? '~' + formatNumber(c.totalTokens) : '-'}</td>
            <td class="px-2 py-1.5 text-center" style="${statusStyle}">${c.success ? '✓' : '✗'}</td>
            <td class="px-2 py-1.5 text-right">${c.durationMs ? (c.durationMs / 1000).toFixed(1) + 's' : '-'}</td>
            <td class="px-2 py-1.5">${time}</td>
        </tr>`;
    }).join('');

    body.innerHTML = `
        <div class="flex items-center gap-6 mb-4 flex-wrap">
            <div class="flex items-center gap-2 px-4 py-2 rounded-lg" style="background:var(--bg-pill)">
                <span style="font-size:20px">🤖</span>
                <div>
                    <div class="text-xs" style="color:var(--text-muted)">LLM 调用</div>
                    <div class="text-sm font-bold">${a.llm.count} 次</div>
                </div>
            </div>
            <div class="flex items-center gap-2 px-4 py-2 rounded-lg" style="background:var(--bg-pill)">
                <span style="font-size:20px">🔤</span>
                <div>
                    <div class="text-xs" style="color:var(--text-muted)">总 Tokens (估算)</div>
                    <div class="text-sm font-bold">~${formatNumber(a.llm.totalTokens)}</div>
                </div>
            </div>
            <div class="flex items-center gap-2 px-4 py-2 rounded-lg" style="background:var(--bg-pill)">
                <span style="font-size:20px">🎨</span>
                <div>
                    <div class="text-xs" style="color:var(--text-muted)">图片生成</div>
                    <div class="text-sm font-bold">${a.image.count} 次</div>
                </div>
            </div>
            <div class="flex items-center gap-2 px-4 py-2 rounded-lg" style="background:var(--bg-pill)">
                <span style="font-size:20px">🎬</span>
                <div>
                    <div class="text-xs" style="color:var(--text-muted)">视频生成</div>
                    <div class="text-sm font-bold">${a.video.count} 次</div>
                </div>
            </div>
        </div>
        <div class="mb-3 flex items-center gap-3">
            <span class="text-xs font-semibold" style="color:var(--text-muted)">调用记录 (${log.length})</span>
            ${log.length > 0 ? '<button class="btn-text text-xs" id="statsClearAllBtn" style="color:#fca5a5">清空全部</button>' : ''}
        </div>
        <div style="overflow-y:auto;max-height:calc(85vh - 240px)">
            <table class="w-full text-sm" style="border-collapse:collapse">
                <thead><tr style="border-bottom:2px solid var(--border-primary);color:var(--text-muted);position:sticky;top:0;background:var(--bg-card)">
                    <th class="px-2 py-2 text-left">类型</th>
                    <th class="px-2 py-2 text-left">操作</th>
                    <th class="px-2 py-2 text-left">模型</th>
                    <th class="px-2 py-2 text-right">Prompt Token</th>
                    <th class="px-2 py-2 text-right">完成 Token</th>
                    <th class="px-2 py-2 text-right">总 Token</th>
                    <th class="px-2 py-2 text-center">状态</th>
                    <th class="px-2 py-2 text-right">耗时</th>
                    <th class="px-2 py-2 text-left">时间</th>
                </tr></thead>
                <tbody style="color:var(--text-secondary)">${rows || '<tr><td colspan="9" class="text-center py-6" style="color:var(--text-faint)">暂无调用记录</td></tr>'}</tbody>
            </table>
        </div>
        <div class="flex gap-2 mt-4 pt-3" style="border-top:1px solid var(--border)">
            <button class="btn-secondary" id="statsDetailCloseBtn2">关闭</button>
        </div>`;
    modal.classList.remove('hidden');
    body.querySelector('#statsDetailCloseBtn2').onclick = () => modal.classList.add('hidden');
    if (body.querySelector('#statsClearAllBtn')) {
        body.querySelector('#statsClearAllBtn').onclick = () => {
            clearCallLog();
            const proj = state.currentProject;
            if (proj) delete proj.callStats;
            showStatsDetail();
        };
    }
}

// re-export estimateTokens for use in api.js
export { estimateTokens };

/** Show stats modal — callable from the icon sidebar */
export function showStatsModal() {
    showStatsDetail();
}

/** Attach hover tooltip to sidebar stats button */
export function attachStatsHover(btnEl) {
    if (!btnEl) return;
    let tooltip = null;
    let hideTimer = null;

    function show() {
        clearTimeout(hideTimer);
        if (tooltip) { tooltip.remove(); tooltip = null; }
        const a = aggregate();
        const hasData = a.total > 0;
        tooltip = document.createElement('div');
        tooltip.className = 'stats-hover-tooltip';
        tooltip.innerHTML = `
            <div style="font-size:11px;font-weight:600;color:var(--text-primary);margin-bottom:6px">📊 用量统计</div>
            ${hasData ? `
            <div style="font-size:11px;color:var(--text-secondary);display:flex;flex-direction:column;gap:3px">
                ${a.llm.count > 0 ? `<div style="display:flex;justify-content:space-between;gap:16px"><span>🤖 LLM</span><span>${a.llm.success} 次${a.llm.failed ? ` / <span style="color:#fca5a5">${a.llm.failed}失败</span>` : ''}</span></div>
                <div style="display:flex;justify-content:space-between;gap:16px;padding-left:8px;font-size:10px;color:var(--text-muted)"><span>Tokens</span><span>~${formatNumber(a.llm.totalTokens)}</span></div>` : ''}
                ${a.image.count > 0 ? `<div style="display:flex;justify-content:space-between;gap:16px"><span>🎨 图片</span><span>${a.image.success} 次${a.image.failed ? ` / <span style="color:#fca5a5">${a.image.failed}失败</span>` : ''}</span></div>` : ''}
                ${a.video.count > 0 ? `<div style="display:flex;justify-content:space-between;gap:16px"><span>🎬 视频</span><span>${a.video.success} 次${a.video.failed ? ` / <span style="color:#fca5a5">${a.video.failed}失败</span>` : ''}</span></div>` : ''}
                <div style="margin-top:3px;font-size:10px;color:var(--text-faint)">共 ${a.total} 次调用 · 点击查看详情</div>
            </div>` : '<div style="font-size:11px;color:var(--text-faint)">暂无数据</div>'}`;
        document.body.appendChild(tooltip);
        const rect = btnEl.getBoundingClientRect();
        tooltip.style.left = (rect.right + 8) + 'px';
        tooltip.style.top = rect.top + 'px';
        // keep tooltip alive when hovering over it
        tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        tooltip.addEventListener('mouseleave', hide);
    }

    function hide() {
        hideTimer = setTimeout(() => { if (tooltip) { tooltip.remove(); tooltip = null; } }, 150);
    }

    btnEl.addEventListener('mouseenter', show);
    btnEl.addEventListener('mouseleave', hide);
}
