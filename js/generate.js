// ============ Generation View ============

import { CONFIG } from './config.js';
import { state } from './state.js';
import { escapeHtml, showToast, $, resolveUrl } from './utils.js';
import { saveProject, appendTaskLogEntry } from './storage.js';
import { submitGenVideo, startPolling, stopPolling, runConsistencyReview } from './api.js';
import { getGlobalVideoModel } from './global_settings.js';
import { navigateTo, setViewContainerPadding } from './views.js';

export async function onGenerationUpdate(proj, updatedShort) {
    await saveProject(proj);
    if (proj.status === 'generating') tryGenerateNext(proj);
    if (state.currentView === 'generation') renderGeneration();
    if (state.currentView === 'breakdown') {
        // Dynamically call renderBreakdown to avoid circular dependency at module level
        const { renderBreakdown } = await import('./views.js');
        renderBreakdown();
    }
}

export async function onStartGeneration() {
    const proj = state.currentProject;
    if (!proj.shorts.length) { showToast('没有短片可生成', 'error'); return; }
    if (!state.token) { showToast('请先登录', 'error'); return; }
    proj.status = 'generating';
    proj.pipelineStage = 'generating';
    // Build generation queue from all pending/failed shorts
    state.generationQueue = [];
    proj.shorts.forEach(s => {
        if (s.status === 'pending' || s.status === 'failed') {
            // Preserve current video as candidate
            if (s.videoUrl) {
                if (!s.videoCandidates) s.videoCandidates = [];
                if (!s.videoCandidates.some(c => c.url === s.videoUrl)) {
                    s.videoCandidates.push({ url: s.videoUrl, path: s.videoPath || null, sourceUrl: s.sourceVideoUrl || null, createdAt: new Date().toISOString() });
                }
            }
            s.status = 'pending'; s.taskId = null; s.error = null;
            state.generationQueue.push(s.id);
        }
    });
    await saveProject(proj);
    const { renderBreakdown } = await import('./views.js');
    renderBreakdown();
    tryGenerateNext(proj);
}

export async function tryGenerateNext(proj) {
    // Use the generation queue to determine what to run
    const queue = state.generationQueue;
    const queuedShorts = queue.map(id => proj.shorts.find(s => s.id === id)).filter(Boolean);
    const running = queuedShorts.filter(s => s.status === 'running').length;
    if (running >= CONFIG.MAX_CONCURRENT) return;

    const pending = queuedShorts.filter(s => s.status === 'pending');
    const toStart = pending.slice(0, CONFIG.MAX_CONCURRENT - running);

    for (const short of toStart) {
        try {
            short.status = 'running';
            const promptOverride = state.videoPromptOverrides?.[short.id];
            let taskId;
            try {
                taskId = await submitGenVideo(short, proj, { promptOverride });
            } finally {
                if (promptOverride) delete state.videoPromptOverrides[short.id];
            }
            short.taskId = taskId;
            await saveProject(proj);
            // Persist task entry to log file immediately
            appendTaskLogEntry(proj, {
                taskId,
                projectId: proj.id,
                shortId: short.id,
                shortOrder: short.order,
                prompt: (short.prompt || '').slice(0, 200),
                model: getGlobalVideoModel(),
                duration: short.duration || proj.settings?.defaultDuration || 0,
                status: 'running',
            });
            startPolling(taskId, proj.id, onGenerationUpdate);
            if (state.currentView === 'generation') renderGeneration();
        } catch (err) {
            short.status = 'failed';
            short.error = err.message;
            await saveProject(proj);
            showToast(`短片 #${short.order} 提交失败: ${err.message}`, 'error');
        }
    }

    const allDone = queuedShorts.every(s => s.status === 'succeeded' || s.status === 'failed');
    if (allDone && queuedShorts.length > 0) {
        const succeeded = queuedShorts.filter(s => s.status === 'succeeded').length;
        state.generationQueue = [];
        if (!proj.shorts.some(s => s.status === 'running' || s.status === 'pending')) {
            proj.status = succeeded > 0 ? 'completed' : 'editing';
        }
        await saveProject(proj);
        showToast(`生成完成: ${succeeded}/${queuedShorts.length} 成功`, succeeded > 0 ? 'success' : 'error');
        if (state.currentView === 'generation') renderGeneration();
    }
}

export function renderGeneration() {
    const proj = state.currentProject;
    const container = $('viewContainer');
    setViewContainerPadding('default');
    const total = proj.shorts.length;
    const succeeded = proj.shorts.filter(s => s.status === 'succeeded').length;
    const running = proj.shorts.filter(s => s.status === 'running').length;
    const failed = proj.shorts.filter(s => s.status === 'failed').length;
    const allDone = proj.shorts.every(s => s.status === 'succeeded' || s.status === 'failed');

    // Video generation usage stats
    const usage = proj.videoGenUsage || { totalTasks: 0, succeededTasks: 0, failedTasks: 0, totalDuration: 0, details: [] };
    const usageHtml = usage.totalTasks > 0
        ? `<div class="flex items-center gap-3 text-xs px-3 py-1.5 rounded-lg mb-4" style="background:var(--bg-pill);color:var(--text-muted)">
            <span>📊 视频生成统计:</span>
            <span>提交 <b style="color:var(--text-primary)">${usage.totalTasks}</b> 次</span>
            <span>成功 <b style="color:#6ee7b7">${usage.succeededTasks}</b></span>
            <span>失败 <b style="color:#fca5a5">${usage.failedTasks}</b></span>
            <span>累计时长 <b style="color:var(--text-primary)">${usage.totalDuration}s</b></span>
            ${usage.details.length > 0 ? `<button class="btn-text text-xs" id="showUsageDetailsBtn" style="margin-left:auto">详情</button>` : ''}
          </div>`
        : '';

    container.innerHTML = `
        <div class="max-w-5xl mx-auto">
            <div class="flex items-center justify-between mb-4" style="flex-wrap:wrap;gap:8px">
                <div class="flex items-center gap-3" style="flex-wrap:wrap">
                    <button class="btn-secondary" id="backToBreakdown">← 分镜</button>
                    <h2 class="text-lg font-bold">${escapeHtml(proj.title)}</h2>
                </div>
                <div class="flex gap-2 items-center" style="flex-wrap:wrap">
                    <span class="text-xs" style="color:var(--text-muted)">${succeeded}/${total} 完成${running ? ` · ${running} 生成中` : ''}${failed ? ` · ${failed} 失败` : ''}</span>
                    <button class="btn-secondary" id="openClipEditorBtn">🎬 剪辑编辑器</button>
                    ${allDone && succeeded > 0 ? '<button class="btn-secondary" id="reviewConsistencyBtn">🔍 一致性审核</button>' : ''}
                    ${allDone && succeeded > 0 ? '<button class="btn-primary" id="goPreviewBtn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>预览影片</button>' : ''}
                    ${!allDone && proj.status === 'generating' ? '<button class="btn-danger" id="stopAllGenBtn">⏹ 停止生成</button>' : ''}
                    ${failed > 0 ? '<button class="btn-secondary" id="retryFailedBtn">重试失败</button>' : ''}
                </div>
            </div>
            <div class="w-full h-2 rounded-full mb-6" style="background:var(--bg-pill)">
                <div class="h-2 rounded-full transition-all" style="width:${total ? (succeeded / total * 100) : 0}%;background:linear-gradient(90deg,#6366f1,#818cf8)"></div>
            </div>
            ${usageHtml}
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" id="genGrid">
                ${proj.shorts.sort((a, b) => a.order - b.order).map(s => renderGenCard(s)).join('')}
            </div>
        </div>`;

    $('backToBreakdown').onclick = () => navigateTo('breakdown');
    if ($('openClipEditorBtn')) $('openClipEditorBtn').onclick = () => navigateTo('clipEditor');
    if ($('goPreviewBtn')) $('goPreviewBtn').onclick = () => navigateTo('preview');
    if ($('reviewConsistencyBtn')) $('reviewConsistencyBtn').onclick = () => onConsistencyReview();
    if ($('showUsageDetailsBtn')) $('showUsageDetailsBtn').onclick = () => showUsageDetails(proj);
    if ($('stopAllGenBtn')) $('stopAllGenBtn').onclick = async () => {
        Object.keys(state.pollingIntervals).forEach(id => stopPolling(id));
        proj.shorts.forEach(s => {
            if (s.status === 'running' || s.status === 'pending') {
                s.status = 'failed';
                s.error = '已手动停止';
                s.taskId = null;
            }
        });
        proj.status = 'editing';
        await saveProject(proj);
        showToast('已停止所有生成任务', 'info');
        renderGeneration();
    };
    if ($('retryFailedBtn')) $('retryFailedBtn').onclick = async () => {
        proj.shorts.forEach(s => { if (s.status === 'failed') { s.status = 'pending'; s.taskId = null; s.error = null; } });
        await saveProject(proj);
        renderGeneration();
        tryGenerateNext(proj);
    };

    document.querySelectorAll('[data-retry-id]').forEach(btn => {
        btn.onclick = async () => {
            const s = proj.shorts.find(x => x.id === btn.dataset.retryId);
            if (!s) return;
            s.status = 'pending'; s.taskId = null; s.error = null;
            await saveProject(proj);
            renderGeneration();
            tryGenerateNext(proj);
        };
    });

    document.querySelectorAll('[data-play-url]').forEach(el => {
        el.onclick = () => {
            $('videoPreview').src = resolveUrl(el.dataset.playUrl);
            $('videoModal').classList.remove('hidden');
            $('videoPreview').play();
        };
    });
}

async function onConsistencyReview() {
    const proj = state.currentProject;
    if (!state.token) { showToast('请先登录', 'error'); return; }

    const modal = $('editModal');
    $('editModalTitle').textContent = '🔍 一致性审核';
    $('editModalBody').innerHTML = `
        <p class="text-xs mb-3" style="color:var(--text-muted)">AI 将检查生成结果是否与角色/场景设定一致。</p>
        <div id="reviewStreamPreview" class="card-flat" style="max-height:400px;overflow-y:auto;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);font-family:monospace">正在审核...</div>
        <div class="flex gap-2 mt-3">
            <button class="btn-secondary" id="reviewCloseBtn">关闭</button>
        </div>`;
    modal.classList.remove('hidden');
    $('reviewCloseBtn').onclick = () => modal.classList.add('hidden');

    try {
        proj.pipelineStage = 'reviewing';
        const result = await runConsistencyReview(proj, (text) => {
            const preview = $('reviewStreamPreview');
            if (preview) { preview.textContent = text; preview.scrollTop = preview.scrollHeight; }
        });

        const issuesHTML = (result.issues || []).length === 0
            ? '<p class="text-sm mt-2" style="color:#6ee7b7">未发现一致性问题。</p>'
            : (result.issues || []).map(i => `
                <div class="preflight-issue ${(i.severity || 'P2').toLowerCase()}">
                    <span class="preflight-badge ${(i.severity || 'P2').toLowerCase()}">${i.severity || 'P2'}</span>
                    <div class="flex-1">
                        <div class="font-semibold text-xs">${escapeHtml(i.target || '')}</div>
                        <div class="text-xs" style="color:var(--text-secondary)">${escapeHtml(i.message || '')}</div>
                        ${i.fix_suggestion ? `<div class="text-xs mt-1" style="color:var(--text-faint)">💡 ${escapeHtml(i.fix_suggestion)}</div>` : ''}
                    </div>
                </div>`).join('');

        $('editModalBody').innerHTML = `
            <div class="mb-2"><span class="text-sm font-semibold">${escapeHtml(result.status || 'unknown')}</span></div>
            ${result.summary ? `<p class="text-xs mb-3" style="color:var(--text-muted)">${escapeHtml(result.summary)}</p>` : ''}
            <div style="max-height:400px;overflow-y:auto">${issuesHTML}</div>
            <div class="flex gap-2 mt-4">
                <button class="btn-primary" id="reviewDoneBtn">确认完成</button>
                <button class="btn-secondary" id="reviewBackBtn">返回修改</button>
            </div>`;
        $('reviewDoneBtn').onclick = async () => {
            proj.pipelineStage = 'completed';
            await saveProject(proj);
            modal.classList.add('hidden');
            showToast('审核完成', 'success');
        };
        $('reviewBackBtn').onclick = () => {
            modal.classList.add('hidden');
            navigateTo('breakdown');
        };
    } catch (err) {
        proj.pipelineStage = 'generating';
        $('reviewStreamPreview').textContent = `审核失败: ${err.message}`;
        showToast(`审核失败: ${err.message}`, 'error');
    }
}

function showUsageDetails(proj) {
    const usage = proj.videoGenUsage;
    if (!usage || !usage.details.length) return;
    const modal = $('editModal');
    const rows = usage.details.map(d => {
        const short = proj.shorts.find(s => s.id === d.shortId);
        const shortLabel = short ? `#${short.order}` : d.shortId?.slice(0, 6);
        const statusCls = d.status === 'succeeded' ? 'color:#6ee7b7' : d.status === 'failed' ? 'color:#fca5a5' : 'color:var(--text-muted)';
        const time = d.submittedAt ? new Date(d.submittedAt).toLocaleString() : '-';
        return `<tr>
            <td class="px-2 py-1">${escapeHtml(shortLabel)}</td>
            <td class="px-2 py-1">${escapeHtml(d.model || '-')}</td>
            <td class="px-2 py-1">${d.duration || '-'}s</td>
            <td class="px-2 py-1">${escapeHtml(d.ratio || '-')}</td>
            <td class="px-2 py-1" style="${statusCls}">${d.status || '-'}</td>
            <td class="px-2 py-1">${time}</td>
        </tr>`;
    }).join('');
    $('editModalTitle').textContent = '📊 视频生成用量详情';
    $('editModalBody').innerHTML = `
        <div class="text-xs mb-3" style="color:var(--text-muted)">
            共 ${usage.totalTasks} 次提交，成功 ${usage.succeededTasks}，失败 ${usage.failedTasks}，累计生成时长 ${usage.totalDuration}s
        </div>
        <div style="max-height:400px;overflow-y:auto">
            <table class="w-full text-xs" style="border-collapse:collapse">
                <thead><tr style="border-bottom:1px solid var(--border-primary);color:var(--text-muted)">
                    <th class="px-2 py-1 text-left">短片</th><th class="px-2 py-1 text-left">模型</th>
                    <th class="px-2 py-1 text-left">时长</th><th class="px-2 py-1 text-left">比例</th>
                    <th class="px-2 py-1 text-left">状态</th><th class="px-2 py-1 text-left">提交时间</th>
                </tr></thead>
                <tbody style="color:var(--text-secondary)">${rows}</tbody>
            </table>
        </div>
        <div class="flex gap-2 mt-3">
            <button class="btn-danger text-xs" id="clearUsageBtn">清空统计</button>
            <button class="btn-secondary" id="closeUsageBtn">关闭</button>
        </div>`;
    modal.classList.remove('hidden');
    $('closeUsageBtn').onclick = () => modal.classList.add('hidden');
    $('clearUsageBtn').onclick = async () => {
        proj.videoGenUsage = { totalTasks: 0, succeededTasks: 0, failedTasks: 0, totalDuration: 0, details: [] };
        await saveProject(proj);
        modal.classList.add('hidden');
        renderGeneration();
        showToast('已清空生成统计', 'info');
    };
}

function renderGenCard(s) {
    const statusBadge = `<span class="status-badge status-${s.status}">${{ pending: '待生成', running: '生成中', succeeded: '完成', failed: '失败' }[s.status]}</span>`;
    const parallelTasks = s.parallelTasks || [];
    const hasParallel = parallelTasks.length > 0;
    const parallelRunning = parallelTasks.filter(t => t.status === 'running').length;
    const parallelSucceeded = parallelTasks.filter(t => t.status === 'succeeded').length;
    let body = '';
    if (s.status === 'succeeded' && s.videoUrl) {
        body = `<div class="relative cursor-pointer" data-play-url="${escapeHtml(s.videoUrl)}">
            <video src="${escapeHtml(resolveUrl(s.videoUrl))}" class="w-full rounded-lg" style="aspect-ratio:16/9;object-fit:cover" muted onerror="this.onerror=null;this.removeAttribute('src');this.parentElement.innerHTML='<div class=\'py-4 text-center text-xs\' style=\'color:#fca5a5\'>视频加载失败</div>'"></video>
            <div class="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg hover:bg-black/40 transition-colors">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div></div>`;
    } else if (s.status === 'running') {
        const runInfo = hasParallel ? `并行生成中 (${parallelRunning} 运行${parallelSucceeded ? `, ${parallelSucceeded} 完成` : ''})` : '生成中...';
        body = `<div class="flex items-center justify-center py-8" style="color:var(--text-muted)"><div class="spinner mr-2"></div>${runInfo}</div>`;
    } else if (s.status === 'failed') {
        body = `<div class="py-4 px-3 text-center"><p class="text-xs" style="color:#fca5a5">${escapeHtml(s.error || '未知错误')}</p><button class="btn-secondary text-xs mt-2" data-retry-id="${s.id}">重试</button></div>`;
    } else {
        const isGenerating = state.currentProject?.status === 'generating';
        body = `<div class="flex items-center justify-center py-8" style="color:var(--text-faint)">${isGenerating ? '等待中' : '未启动'}</div>`;
    }
    const parallelBadge = hasParallel ? `<span class="text-xs" style="color:#c084fc;margin-left:4px" title="并行生成 ${parallelTasks.length} 个变体">⚡${parallelTasks.length}</span>` : '';
    const candidateCount = (s.videoCandidates || []).length;
    const candidateBadge = candidateCount > 1 ? `<span class="text-xs" style="color:var(--text-faint);margin-left:4px">${candidateCount} 版本</span>` : '';
    return `<div class="card-flat"><div class="flex items-center justify-between mb-2"><span class="text-xs font-semibold" style="color:var(--text-secondary)">短片 #${s.order}${parallelBadge}${candidateBadge}</span>${statusBadge}</div>${body}<p class="text-xs mt-2 line-clamp-2" style="color:var(--text-muted)">${escapeHtml(s.prompt).slice(0, 80)}</p></div>`;
}
