// ============ Props Gallery View ============

import { state, getFolders } from './state.js';
import { escapeHtml, resolveUrl } from './utils.js';

/**
 * Render a visual gallery of all props into the detail panel.
 * @param {HTMLElement} panel - the #detailPanel element
 * @param {Object} proj - current project
 * @param {Function} onSelectItem - callback(id, type) to select a prop
 * @param {Function} onAddItem - callback() to add a new prop
 * @param {Function} onAddFolder - callback(category) to add a folder
 * @param {Function} onRegenGroup - callback() to regenerate the group
 * @param {Function} onGenMissing - callback() to generate missing images
 */
export function renderPropsGallery(panel, proj, { onSelectItem, onAddItem, onAddFolder, onRegenGroup, onGenMissing }) {
    const props = proj.props || [];
    const folders = getFolders(proj, 'props');
    const missingCount = props.filter(p => !p.imageUrl && p.description).length;

    const folderMap = new Map();
    folders.forEach(f => folderMap.set(f.id, { folder: f, items: [] }));
    const ungrouped = [];
    props.forEach(p => {
        if (p.folderId && folderMap.has(p.folderId)) {
            folderMap.get(p.folderId).items.push(p);
        } else {
            ungrouped.push(p);
        }
    });

    let html = `<div class="asset-gallery fade-in">
        <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-semibold">🎒 道具 (${props.length})</h3>
            <div class="flex gap-2 flex-wrap">
                ${missingCount > 0 ? `<button class="btn-secondary text-xs" id="galleryGenMissing">🎨 生成缺失图片 (${missingCount})</button>` : ''}
                <button class="btn-secondary text-xs" id="galleryRegenGroup">🔄 重新生成</button>
                <button class="btn-secondary text-xs" id="galleryAddItem">+ 添加道具</button>
                <button class="btn-secondary text-xs" id="galleryAddFolder">📁 新建文件夹</button>
            </div>
        </div>
        <div id="genMissingProgress" class="hidden mt-1 mb-3 card-flat" style="padding:10px;font-size:12px;line-height:1.6;color:var(--text-secondary);max-height:200px;overflow-y:auto"></div>`;

    for (const [, { folder, items }] of folderMap) {
        if (items.length === 0) continue;
        html += `<div class="mb-4">
            <div class="text-xs font-semibold mb-2" style="color:var(--text-muted)">📁 ${escapeHtml(folder.name)}</div>
            <div class="asset-gallery-grid">${items.map(p => propCard(p)).join('')}</div>
        </div>`;
    }

    if (ungrouped.length > 0) {
        if (folderMap.size > 0) {
            html += `<div class="mb-4">
                <div class="text-xs font-semibold mb-2" style="color:var(--text-muted)">未分组</div>
                <div class="asset-gallery-grid">${ungrouped.map(p => propCard(p)).join('')}</div>
            </div>`;
        } else {
            html += `<div class="asset-gallery-grid mb-4">${ungrouped.map(p => propCard(p)).join('')}</div>`;
        }
    }

    if (props.length === 0) {
        html += `<div class="flex items-center justify-center py-12" style="color:var(--text-faint)">暂无道具，点击"+ 添加道具"创建</div>`;
    }

    html += `</div>`;
    panel.innerHTML = html;

    panel.querySelectorAll('[data-gallery-id]').forEach(el => {
        el.onclick = () => onSelectItem(el.dataset.galleryId, 'prop');
    });
    if (document.getElementById('galleryAddItem')) document.getElementById('galleryAddItem').onclick = onAddItem;
    if (document.getElementById('galleryAddFolder')) document.getElementById('galleryAddFolder').onclick = () => onAddFolder('props');
    if (document.getElementById('galleryRegenGroup')) document.getElementById('galleryRegenGroup').onclick = onRegenGroup;
    if (document.getElementById('galleryGenMissing')) document.getElementById('galleryGenMissing').onclick = onGenMissing;
}

function propCard(p) {
    const hasImage = !!p.imageUrl;
    const verified = p.anchorVerified;
    return `<div class="asset-card" data-gallery-id="${escapeHtml(p.id)}">
        <div class="asset-card-thumb">
            ${hasImage
                ? `<img src="${escapeHtml(resolveUrl(p.imageUrl))}" alt="${escapeHtml(p.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="asset-card-placeholder" style="display:none">🎒</div>`
                : `<div class="asset-card-placeholder">🎒</div>`}
            ${verified ? '<div class="asset-card-badge asset-card-badge-verified">✅</div>' : ''}
        </div>
        <div class="asset-card-info">
            <div class="asset-card-name">${escapeHtml(p.name)}</div>
            ${p.description ? `<div class="asset-card-desc">${escapeHtml(p.description.slice(0, 50))}${p.description.length > 50 ? '…' : ''}</div>` : ''}
        </div>
    </div>`;
}
