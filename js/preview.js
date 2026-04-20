// ============ Preview View ============

import { state } from './state.js';
import { escapeHtml, $, resolveUrl } from './utils.js';
import { navigateTo, setViewContainerPadding } from './views.js';

async function openInteractivePlayer(proj) {
    try {
        const { exportPlotFile, getPlotFileName } = await import('./storage.js');
        const { showToast } = await import('./utils.js');
        let fileName = getPlotFileName(proj);
        // Always refresh the plot file on open so player sees latest
        try { ({ fileName } = await exportPlotFile(proj)); } catch (_) {}
        const url = `player.html?file=${encodeURIComponent(fileName)}`;
        window.open(url, '_blank');
    } catch (e) {
        const { showToast } = await import('./utils.js');
        showToast('无法打开播放器: ' + (e.message || e), 'error');
    }
}

export function renderPreview() {
    const proj = state.currentProject;
    const videos = proj.shorts.filter(s => s.status === 'succeeded' && s.videoUrl).sort((a, b) => a.order - b.order);
    const container = $('viewContainer');
    setViewContainerPadding('default');

    if (!videos.length) {
        container.innerHTML = `<div class="max-w-3xl mx-auto text-center py-16"><p style="color:var(--text-muted)">暂无生成完成的视频</p><button class="btn-secondary mt-4" id="backToGen">返回生成页</button></div>`;
        $('backToGen').onclick = () => navigateTo('generation');
        return;
    }

    container.innerHTML = `
        <div class="max-w-4xl mx-auto">
            <div class="flex items-center justify-between mb-4" style="flex-wrap:wrap;gap:8px">
                <div class="flex items-center gap-3" style="flex-wrap:wrap">
                    <button class="btn-secondary" id="backToGen2">← 生成</button>
                    <h2 class="text-lg font-bold">${escapeHtml(proj.title)}</h2>
                    <span class="text-xs" style="color:var(--text-muted)">${videos.length} 个片段</span>
                </div>
                <div class="flex items-center gap-2" style="flex-wrap:wrap">
                    <button class="btn-secondary" id="openClipEditorBtn2">🎬 剪辑编辑器</button>
                    ${proj.isInteractive ? '<button class="btn-secondary" id="playInteractiveBtn">🌿 播放互动电影</button>' : ''}
                    <button class="btn-primary" id="playFullBtn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>连续播放</button>
                </div>
            </div>
            <div class="mb-6">
                <video id="mainPlayer" controls class="w-full rounded-xl" style="max-height:60vh;background:#000"></video>
                <p id="mainPlayerLabel" class="text-sm mt-2 text-center" style="color:var(--text-muted)">点击下方片段或"连续播放"开始</p>
            </div>
            <div class="grid grid-cols-4 md:grid-cols-6 gap-3" id="previewGrid">
                ${videos.map((v, i) => `<div class="cursor-pointer card-flat p-1" data-preview-idx="${i}"><video src="${escapeHtml(resolveUrl(v.videoUrl))}" class="w-full rounded-lg" style="aspect-ratio:16/9;object-fit:cover" muted onerror="this.onerror=null;this.removeAttribute('src');this.outerHTML='<div class=\'flex items-center justify-center\' style=\'aspect-ratio:16/9;color:#fca5a5;font-size:12px\'>视频不可用</div>'"></video><p class="text-xs text-center mt-1" style="color:var(--text-secondary)">#${v.order}</p></div>`).join('')}
            </div>
        </div>`;

    window._previewVideos = videos;
    window._currentPreviewIdx = -1;

    $('backToGen2').onclick = () => navigateTo('generation');
    if ($('openClipEditorBtn2')) $('openClipEditorBtn2').onclick = () => navigateTo('clipEditor');
    $('playFullBtn').onclick = () => playFullMovie();
    const interactiveBtn = $('playInteractiveBtn');
    if (interactiveBtn) interactiveBtn.onclick = () => openInteractivePlayer(proj);
    $('previewGrid').addEventListener('click', (e) => {
        const card = e.target.closest('[data-preview-idx]');
        if (card) playShortInMain(parseInt(card.dataset.previewIdx));
    });
}

function playShortInMain(idx) {
    const videos = window._previewVideos;
    if (!videos?.[idx]) return;
    const player = $('mainPlayer');
    player.src = resolveUrl(videos[idx].videoUrl);
    $('mainPlayerLabel').textContent = `短片 #${videos[idx].order}`;
    player.play();
    window._currentPreviewIdx = idx;
}

function playFullMovie() {
    const videos = window._previewVideos;
    if (!videos?.length) return;
    window._currentPreviewIdx = 0;
    const player = $('mainPlayer');
    player.onended = () => { window._currentPreviewIdx++; playNext(); };
    function playNext() {
        const idx = window._currentPreviewIdx;
        if (idx >= videos.length) { $('mainPlayerLabel').textContent = '播放完毕'; return; }
        player.src = resolveUrl(videos[idx].videoUrl);
        $('mainPlayerLabel').textContent = `短片 #${videos[idx].order} / ${videos.length}`;
        player.play();
    }
    playNext();
}
