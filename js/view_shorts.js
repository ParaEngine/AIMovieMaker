// ============ Shorts Gallery View ============

import { state, getFolders } from './state.js';
import { escapeHtml, truncate, resolveUrl } from './utils.js';

const STATUS_LABELS = {
    pending:   { cls: 'status-pending',   text: '待处理' },
    running:   { cls: 'status-running',   text: '生成中' },
    succeeded: { cls: 'status-succeeded', text: '已完成' },
    failed:    { cls: 'status-failed',    text: '失败' },
};

/**
 * Render a visual gallery of all shorts into the detail panel.
 */
export function renderShortsGallery(panel, proj, { onSelectItem, onAddItem, onAddFolder, onRegenGroup }) {
    const shorts = (proj.shorts || []).sort((a, b) => a.order - b.order);
    const folders = getFolders(proj, 'shorts');

    const folderMap = new Map();
    folders.forEach(f => folderMap.set(f.id, { folder: f, items: [] }));
    const ungrouped = [];
    shorts.forEach(s => {
        if (s.folderId && folderMap.has(s.folderId)) {
            folderMap.get(s.folderId).items.push(s);
        } else {
            ungrouped.push(s);
        }
    });

    // Stats
    const succeededCount = shorts.filter(s => s.status === 'succeeded').length;
    const pendingCount = shorts.filter(s => s.status === 'pending').length;
    const runningCount = shorts.filter(s => s.status === 'running').length;
    const failedCount = shorts.filter(s => s.status === 'failed').length;

    let html = `<div class="asset-gallery fade-in">
        <div class="flex items-center justify-between mb-4">
            <div>
                <h3 class="text-base font-semibold">📋 分镜 (${shorts.length})</h3>
                <div class="flex gap-3 mt-1 text-xs" style="color:var(--text-muted)">
                    ${succeededCount ? `<span style="color:#6ee7b7">✅ ${succeededCount}</span>` : ''}
                    ${runningCount ? `<span style="color:#818cf8">⏳ ${runningCount}</span>` : ''}
                    ${pendingCount ? `<span>⬜ ${pendingCount}</span>` : ''}
                    ${failedCount ? `<span style="color:#fca5a5">❌ ${failedCount}</span>` : ''}
                </div>
            </div>
            <div class="flex gap-2 flex-wrap">
                <button class="btn-secondary text-xs" id="galleryRegenGroup">🔄 重新生成</button>
                <button class="btn-secondary text-xs" id="galleryAddItem">+ 添加短片</button>
                <button class="btn-secondary text-xs" id="galleryAddFolder">📁 新建文件夹</button>
            </div>
        </div>`;

    // Render folder groups
    for (const [, { folder, items }] of folderMap) {
        if (items.length === 0) continue;
        html += `<div class="mb-4">
            <div class="text-xs font-semibold mb-2" style="color:var(--text-muted)">📁 ${escapeHtml(folder.name)}</div>
            <div class="asset-gallery-grid asset-gallery-grid-wide">${items.map(s => shortCard(s, proj)).join('')}</div>
        </div>`;
    }

    // Ungrouped
    if (ungrouped.length > 0) {
        if (folderMap.size > 0) {
            html += `<div class="mb-4">
                <div class="text-xs font-semibold mb-2" style="color:var(--text-muted)">未分组</div>
                <div class="asset-gallery-grid asset-gallery-grid-wide">${ungrouped.map(s => shortCard(s, proj)).join('')}</div>
            </div>`;
        } else {
            html += `<div class="asset-gallery-grid asset-gallery-grid-wide mb-4">${ungrouped.map(s => shortCard(s, proj)).join('')}</div>`;
        }
    }

    if (shorts.length === 0) {
        html += `<div class="flex items-center justify-center py-12" style="color:var(--text-faint)">暂无分镜，点击"+ 添加短片"创建</div>`;
    }

    html += `</div>`;
    panel.innerHTML = html;

    // Attach events
    panel.querySelectorAll('[data-gallery-id]').forEach(el => {
        el.onclick = () => onSelectItem(el.dataset.galleryId, 'short');
    });
    if (document.getElementById('galleryAddItem')) document.getElementById('galleryAddItem').onclick = onAddItem;
    if (document.getElementById('galleryAddFolder')) document.getElementById('galleryAddFolder').onclick = () => onAddFolder('shorts');
    if (document.getElementById('galleryRegenGroup')) document.getElementById('galleryRegenGroup').onclick = onRegenGroup;
}

function shortCard(sh, proj) {
    const scene = proj.scenes.find(sc => sc.id === sh.sceneId);
    const chars = (sh.characterIds || []).map(cid => proj.characters.find(c => c.id === cid)).filter(Boolean);

    // Thumbnail: video frame > picturebook image > first image > scene image > placeholder
    const thumbUrl = sh.videoUrl || sh.picturebookUrl || (sh.imageUrls && sh.imageUrls[0]) || (sh.firstFrameUrl) || (scene && scene.imageUrl);
    const hasThumb = !!thumbUrl;
    const isVideo = !!sh.videoUrl;

    const statusInfo = STATUS_LABELS[sh.status] || STATUS_LABELS.pending;
    const meta = [sh.shotType, sh.emotion, sh.cameraMovement].filter(Boolean);

    return `<div class="asset-card asset-card-wide" data-gallery-id="${escapeHtml(sh.id)}">
        <div class="asset-card-thumb asset-card-thumb-wide" style="position:relative">
            ${hasThumb
                ? (isVideo
                    ? `<video src="${escapeHtml(resolveUrl(thumbUrl))}" muted preload="metadata" style="width:100%;height:100%;object-fit:cover" onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>`
                    : `<img src="${escapeHtml(resolveUrl(thumbUrl))}" alt="#${sh.order}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="asset-card-placeholder" style="display:none">📋</div>`)
                : `<div class="asset-card-placeholder">📋</div>`}
            <div style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.6);color:white;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px">#${sh.order}</div>
            <div style="position:absolute;top:4px;right:4px"><span class="status-badge ${statusInfo.cls}" style="font-size:10px;padding:1px 6px">${statusInfo.text}</span></div>
            ${sh.enhanced ? '<div style="position:absolute;bottom:4px;right:4px;font-size:12px">✨</div>' : ''}
            ${sh.picturebookUrl && sh.picturebookStatus === 'succeeded' ? '<div style="position:absolute;bottom:4px;right:' + (sh.enhanced ? '20' : '4') + 'px;font-size:12px" title="绘本插画">📖</div>' : ''}
            ${sh.duration ? `<div style="position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,0.6);color:white;font-size:10px;padding:1px 5px;border-radius:3px">${sh.duration}s</div>` : ''}
        </div>
        <div class="asset-card-info">
            <div class="flex items-center gap-1 mb-1">
                ${chars.slice(0, 3).map(c => c.imageUrl
                    ? `<img src="${escapeHtml(resolveUrl(c.imageUrl))}" style="width:18px;height:18px;border-radius:50%;object-fit:cover;border:1px solid var(--border-card)" title="${escapeHtml(c.name)}">`
                    : `<span style="width:18px;height:18px;border-radius:50%;background:var(--bg-card);display:inline-flex;align-items:center;justify-content:center;font-size:10px;border:1px solid var(--border-card)" title="${escapeHtml(c.name)}">👤</span>`
                ).join('')}
                ${chars.length > 3 ? `<span class="text-xs" style="color:var(--text-faint)">+${chars.length - 3}</span>` : ''}
                ${scene ? `<span class="text-xs" style="color:var(--text-muted);margin-left:auto">${escapeHtml(truncate(scene.name, 12))}</span>` : ''}
            </div>
            ${meta.length ? `<div class="asset-card-meta">${meta.map(m => `<span class="shot-meta-tag" style="font-size:10px">${escapeHtml(m)}</span>`).join('')}</div>` : ''}
            ${sh.prompt ? `<div class="asset-card-desc">${escapeHtml(sh.prompt.slice(0, 60))}${sh.prompt.length > 60 ? '…' : ''}</div>` : ''}
        </div>
    </div>`;
}
