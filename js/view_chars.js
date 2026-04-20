// ============ Characters Gallery View ============

import { state, getFolders } from './state.js';
import { escapeHtml, resolveUrl } from './utils.js';
import { getCategoryFromType } from './tree.js';

/**
 * Render a visual gallery of all characters into the detail panel.
 * @param {HTMLElement} panel - the #detailPanel element
 * @param {Object} proj - current project
 * @param {Function} onSelectItem - callback(id, type) to select a character
 * @param {Function} onAddItem - callback() to add a new character
 * @param {Function} onAddFolder - callback(category) to add a folder
 * @param {Function} onRegenGroup - callback() to regenerate the group
 * @param {Function} onGenMissing - callback() to generate missing images
 */
export function renderCharactersGallery(panel, proj, { onSelectItem, onAddItem, onAddFolder, onRegenGroup, onGenMissing }) {
    const chars = proj.characters || [];
    const folders = getFolders(proj, 'characters');
    const missingCount = chars.filter(c => !c.imageUrl && c.description).length;

    // Group by folder
    const folderMap = new Map();
    folders.forEach(f => folderMap.set(f.id, { folder: f, items: [] }));
    const ungrouped = [];
    chars.forEach(c => {
        if (c.folderId && folderMap.has(c.folderId)) {
            folderMap.get(c.folderId).items.push(c);
        } else {
            ungrouped.push(c);
        }
    });

    let html = `<div class="asset-gallery fade-in">
        <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-semibold">👥 角色 (${chars.length})</h3>
            <div class="flex gap-2 flex-wrap">
                ${missingCount > 0 ? `<button class="btn-secondary text-xs" id="galleryGenMissing">🎨 生成缺失图片 (${missingCount})</button>` : ''}
                <button class="btn-secondary text-xs" id="galleryRegenGroup">🔄 重新生成</button>
                <button class="btn-secondary text-xs" id="galleryAddItem">+ 添加角色</button>
                <button class="btn-secondary text-xs" id="galleryAddFolder">📁 新建文件夹</button>
            </div>
        </div>
        <div id="genMissingProgress" class="hidden mt-1 mb-3 card-flat" style="padding:10px;font-size:12px;line-height:1.6;color:var(--text-secondary);max-height:200px;overflow-y:auto"></div>`;

    // Render folder groups
    for (const [, { folder, items }] of folderMap) {
        if (items.length === 0) continue;
        html += `<div class="mb-4">
            <div class="text-xs font-semibold mb-2" style="color:var(--text-muted)">📁 ${escapeHtml(folder.name)}</div>
            <div class="asset-gallery-grid">${items.map(c => charCard(c)).join('')}</div>
        </div>`;
    }

    // Ungrouped
    if (ungrouped.length > 0) {
        if (folderMap.size > 0) {
            html += `<div class="mb-4">
                <div class="text-xs font-semibold mb-2" style="color:var(--text-muted)">未分组</div>
                <div class="asset-gallery-grid">${ungrouped.map(c => charCard(c)).join('')}</div>
            </div>`;
        } else {
            html += `<div class="asset-gallery-grid mb-4">${ungrouped.map(c => charCard(c)).join('')}</div>`;
        }
    }

    if (chars.length === 0) {
        html += `<div class="flex items-center justify-center py-12" style="color:var(--text-faint)">暂无角色，点击"+ 添加角色"创建</div>`;
    }

    html += `</div>`;
    panel.innerHTML = html;

    // Attach events
    panel.querySelectorAll('[data-gallery-id]').forEach(el => {
        el.onclick = () => onSelectItem(el.dataset.galleryId, 'character');
    });
    if (document.getElementById('galleryAddItem')) document.getElementById('galleryAddItem').onclick = onAddItem;
    if (document.getElementById('galleryAddFolder')) document.getElementById('galleryAddFolder').onclick = () => onAddFolder('characters');
    if (document.getElementById('galleryRegenGroup')) document.getElementById('galleryRegenGroup').onclick = onRegenGroup;
    if (document.getElementById('galleryGenMissing')) document.getElementById('galleryGenMissing').onclick = onGenMissing;
}

function charCard(c) {
    const hasImage = !!c.imageUrl;
    const verified = c.anchorVerified;
    return `<div class="asset-card" data-gallery-id="${escapeHtml(c.id)}">
        <div class="asset-card-thumb">
            ${hasImage
                ? `<img src="${escapeHtml(resolveUrl(c.imageUrl))}" alt="${escapeHtml(c.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="asset-card-placeholder" style="display:none">👤</div>`
                : `<div class="asset-card-placeholder">👤</div>`}
            ${verified ? '<div class="asset-card-badge asset-card-badge-verified">✅</div>' : ''}
        </div>
        <div class="asset-card-info">
            <div class="asset-card-name">${escapeHtml(c.name)}</div>
            ${c.description ? `<div class="asset-card-desc">${escapeHtml(c.description.slice(0, 50))}${c.description.length > 50 ? '…' : ''}</div>` : ''}
        </div>
    </div>`;
}
