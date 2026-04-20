// ============ Scenes Gallery View ============

import { state, getFolders } from './state.js';
import { escapeHtml, resolveUrl } from './utils.js';

/**
 * Render a visual gallery of all scenes into the detail panel.
 * @param {HTMLElement} panel - the #detailPanel element
 * @param {Object} proj - current project
 * @param {Function} onSelectItem - callback(id, type) to select a scene
 * @param {Function} onAddItem - callback() to add a new scene
 * @param {Function} onAddFolder - callback(category) to add a folder
 * @param {Function} onRegenGroup - callback() to regenerate the group
 * @param {Function} onGenMissing - callback() to generate missing images
 */
export function renderScenesGallery(panel, proj, { onSelectItem, onAddItem, onAddFolder, onRegenGroup, onGenMissing }) {
    const scenes = proj.scenes || [];
    const folders = getFolders(proj, 'scenes');
    const missingCount = scenes.filter(s => !s.imageUrl && s.description).length;

    const folderMap = new Map();
    folders.forEach(f => folderMap.set(f.id, { folder: f, items: [] }));
    const ungrouped = [];
    scenes.forEach(s => {
        if (s.folderId && folderMap.has(s.folderId)) {
            folderMap.get(s.folderId).items.push(s);
        } else {
            ungrouped.push(s);
        }
    });

    let html = `<div class="asset-gallery fade-in">
        <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-semibold">🎬 场景 (${scenes.length})</h3>
            <div class="flex gap-2 flex-wrap">
                ${missingCount > 0 ? `<button class="btn-secondary text-xs" id="galleryGenMissing">🎨 生成缺失图片 (${missingCount})</button>` : ''}
                <button class="btn-secondary text-xs" id="galleryRegenGroup">🔄 重新生成</button>
                <button class="btn-secondary text-xs" id="galleryAddItem">+ 添加场景</button>
                <button class="btn-secondary text-xs" id="galleryAddFolder">📁 新建文件夹</button>
            </div>
        </div>
        <div id="genMissingProgress" class="hidden mt-1 mb-3 card-flat" style="padding:10px;font-size:12px;line-height:1.6;color:var(--text-secondary);max-height:200px;overflow-y:auto"></div>`;

    for (const [, { folder, items }] of folderMap) {
        if (items.length === 0) continue;
        html += `<div class="mb-4">
            <div class="text-xs font-semibold mb-2" style="color:var(--text-muted)">📁 ${escapeHtml(folder.name)}</div>
            <div class="asset-gallery-grid asset-gallery-grid-wide">${items.map(s => sceneCard(s)).join('')}</div>
        </div>`;
    }

    if (ungrouped.length > 0) {
        if (folderMap.size > 0) {
            html += `<div class="mb-4">
                <div class="text-xs font-semibold mb-2" style="color:var(--text-muted)">未分组</div>
                <div class="asset-gallery-grid asset-gallery-grid-wide">${ungrouped.map(s => sceneCard(s)).join('')}</div>
            </div>`;
        } else {
            html += `<div class="asset-gallery-grid asset-gallery-grid-wide mb-4">${ungrouped.map(s => sceneCard(s)).join('')}</div>`;
        }
    }

    if (scenes.length === 0) {
        html += `<div class="flex items-center justify-center py-12" style="color:var(--text-faint)">暂无场景，点击"+ 添加场景"创建</div>`;
    }

    html += `</div>`;
    panel.innerHTML = html;

    panel.querySelectorAll('[data-gallery-id]').forEach(el => {
        el.onclick = () => onSelectItem(el.dataset.galleryId, 'scene');
    });
    if (document.getElementById('galleryAddItem')) document.getElementById('galleryAddItem').onclick = onAddItem;
    if (document.getElementById('galleryAddFolder')) document.getElementById('galleryAddFolder').onclick = () => onAddFolder('scenes');
    if (document.getElementById('galleryRegenGroup')) document.getElementById('galleryRegenGroup').onclick = onRegenGroup;
    if (document.getElementById('galleryGenMissing')) document.getElementById('galleryGenMissing').onclick = onGenMissing;
}

function sceneCard(s) {
    const hasImage = !!s.imageUrl;
    const meta = [s.lighting, s.timeOfDay, s.weather, s.mood].filter(Boolean);
    return `<div class="asset-card asset-card-wide" data-gallery-id="${escapeHtml(s.id)}">
        <div class="asset-card-thumb asset-card-thumb-wide">
            ${hasImage
                ? `<img src="${escapeHtml(resolveUrl(s.imageUrl))}" alt="${escapeHtml(s.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="asset-card-placeholder" style="display:none">🎬</div>`
                : `<div class="asset-card-placeholder">🎬</div>`}
        </div>
        <div class="asset-card-info">
            <div class="asset-card-name">${escapeHtml(s.name)}</div>
            ${meta.length ? `<div class="asset-card-meta">${meta.map(m => `<span class="shot-meta-tag">${escapeHtml(m)}</span>`).join('')}</div>` : ''}
            ${s.description ? `<div class="asset-card-desc">${escapeHtml(s.description.slice(0, 60))}${s.description.length > 60 ? '…' : ''}</div>` : ''}
        </div>
    </div>`;
}
