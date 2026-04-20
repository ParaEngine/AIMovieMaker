// ============ Tree View Component ============

import { state, getFolders } from './state.js';
import { escapeHtml, truncate } from './utils.js';

function buildFolderHierarchy(items, folders, itemNodeFn, folderType) {
    const children = [];
    // Sort folders: natural numeric sort so plot1 comes before plot1.1
    const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    sorted.forEach(f => {
        const folderItems = items.filter(item => item.folderId === f.id);
        // Hide empty plot folders (auto-generated from plot nodes)
        if (folderItems.length === 0 && f.plotNodeId) return;
        children.push({
            id: f.id, type: folderType,
            icon: '📁', label: `${f.name} (${folderItems.length})`,
            children: folderItems.map(itemNodeFn),
            droppable: true,
        });
    });
    items.filter(item => !item.folderId).forEach(item => {
        children.push(itemNodeFn(item));
    });
    return children;
}

/**
 * Build tree data from a project.
 * Returns an array of tree nodes.
 */
export function buildTree(project) {
    if (!project) return [];
    const nodes = [];

    // Script & Settings
    nodes.push({
        id: 'script-section', type: 'script-section',
        icon: '📄', label: '剧本 & 设置',
        children: [],
    });

    // Synopsis
    nodes.push({
        id: 'synopsis', type: 'synopsis',
        icon: '📝', label: '概要',
        preview: truncate(project.synopsis, 40),
        children: [],
    });

    // Characters group
    const charFolders = getFolders(project, 'characters');
    const charNodes = buildFolderHierarchy(
        project.characters, charFolders,
        c => ({
            id: c.id, type: 'character',
            icon: c.anchorVerified ? '✅' : (c.imageUrl ? '🖼️' : ''), label: c.name,
            preview: truncate(c.description, 30),
            children: [], draggable: true,
        }),
        'character-folder'
    );
    nodes.push({
        id: 'characters-group', type: 'characters-group',
        icon: '👥', label: `角色 (${project.characters.length})`,
        children: charNodes, isCategory: true, category: 'characters',
    });

    // Props group
    const propFolders = getFolders(project, 'props');
    const propNodes = buildFolderHierarchy(
        project.props, propFolders,
        p => ({
            id: p.id, type: 'prop',
            icon: p.anchorVerified ? '✅' : (p.imageUrl ? '🖼️' : ''), label: p.name,
            preview: truncate(p.description, 30),
            children: [], draggable: true,
        }),
        'prop-folder'
    );
    nodes.push({
        id: 'props-group', type: 'props-group',
        icon: '🎒', label: `道具 (${project.props.length})`,
        children: propNodes, isCategory: true, category: 'props',
    });

    // Scenes group
    const sceneFolders = getFolders(project, 'scenes');
    const sceneNodes = buildFolderHierarchy(
        project.scenes, sceneFolders,
        s => ({
            id: s.id, type: 'scene',
            icon: s.imageUrl ? '🖼️' : '', label: s.name,
            preview: truncate(s.description, 30),
            children: [], draggable: true,
        }),
        'scene-folder'
    );
    nodes.push({
        id: 'scenes-group', type: 'scenes-group',
        icon: '🎬', label: `场景 (${project.scenes.length})`,
        children: sceneNodes, isCategory: true, category: 'scenes',
    });

    // Shorts group
    const shortFolders = getFolders(project, 'shorts');
    const allShorts = project.shorts.sort((a, b) => a.order - b.order);
    function shortNode(s) {
        let icon = '';
        if (s.status === 'succeeded') icon = '🎬';
        else if (s.status === 'running') icon = '⏳';
        else if (s.status === 'failed') icon = '❌';
        else if (s.picturebookUrl && s.picturebookStatus === 'succeeded') icon = '📖';
        else if (s.enhanced) icon = '✨';
        return {
            id: s.id, type: 'short',
            icon, label: `#${s.order}`,
            preview: s.emotion ? `${s.emotion} · ${truncate(s.prompt, 20)}` : truncate(s.prompt, 30),
            children: [], draggable: true,
        };
    }
    const shortChildren = buildFolderHierarchy(allShorts, shortFolders, shortNode, 'short-folder');
    nodes.push({
        id: 'shorts-group', type: 'shorts-group',
        icon: '📋', label: `分镜 (${project.shorts.length})`,
        children: shortChildren, isCategory: true, category: 'shorts',
    });

    return nodes;
}

/** Check if a node type is a folder */
export function isFolder(type) {
    return type && type.endsWith('-folder');
}

/** Get category from a folder or group type */
export function getCategoryFromType(type) {
    if (type === 'characters-group' || type === 'character' || type === 'character-folder') return 'characters';
    if (type === 'props-group' || type === 'prop' || type === 'prop-folder') return 'props';
    if (type === 'scenes-group' || type === 'scene' || type === 'scene-folder') return 'scenes';
    if (type === 'shorts-group' || type === 'short' || type === 'short-folder') return 'shorts';
    return null;
}

/** Get item type from category */
export function getItemType(category) {
    return { characters: 'character', props: 'prop', scenes: 'scene', shorts: 'short' }[category];
}

export function renderTreeHTML(nodes, depth = 0) {
    return nodes.map(node => {
        const hasChildren = node.children && node.children.length > 0;
        const defaultExpanded = node.type !== 'characters-group' && node.type !== 'props-group' && node.type !== 'scenes-group';
        const isExpanded = state.treeExpanded[node.id] !== undefined ? state.treeExpanded[node.id] : defaultExpanded;
        const isSelected = state.selectedNodeId === node.id;
        const isMultiSelected = state.selectedNodeIds.has(node.id);
        const indent = depth * 16;
        const isGroup = node.type.endsWith('-group');
        const isFolderNode = isFolder(node.type);
        const isRegenerable = !isFolderNode && node.type !== 'root';
        const isDraggable = node.draggable;
        const isDroppable = node.droppable || isGroup;
        const showHoverActions = isGroup || isFolderNode;

        let html = `<div class="tree-node${isSelected ? ' tree-node-selected' : ''}${isMultiSelected ? ' tree-node-multi-selected' : ''}${isDroppable ? ' tree-droppable' : ''}" 
            data-node-id="${escapeHtml(node.id)}" 
            data-node-type="${escapeHtml(node.type)}"
            ${node.category ? `data-category="${escapeHtml(node.category)}"` : ''}
            ${isDraggable ? 'draggable="true"' : ''}
            style="padding-left:${indent + 8}px">`;

        // Expand/collapse toggle — always show for groups and folders
        if (hasChildren || isFolderNode || isGroup) {
            html += `<span class="tree-toggle" data-toggle-id="${escapeHtml(node.id)}">${hasChildren && isExpanded ? '▼' : '▶'}</span>`;
        } else {
            html += `<span class="tree-toggle-placeholder"></span>`;
        }

        // Icon + label
        html += `<span class="tree-label" data-select-id="${escapeHtml(node.id)}" data-select-type="${escapeHtml(node.type)}">`;
        if (node.icon) html += `<span class="tree-icon">${node.icon}</span>`;
        html += `<span class="tree-text">${escapeHtml(node.label)}</span>`;
        if (node.preview) html += `<span class="tree-preview">${escapeHtml(node.preview)}</span>`;
        html += `</span>`;

        // Hover action buttons (add item + add folder) for groups and folders
        if (showHoverActions) {
            const cat = node.category || getCategoryFromType(node.type);
            html += `<span class="tree-hover-actions">`;
            html += `<span class="tree-action-btn" data-action="add-item" data-action-category="${cat}" data-action-folder="${isFolderNode ? node.id : ''}" title="添加">+</span>`;
            if (isGroup) {
                html += `<span class="tree-action-btn" data-action="add-folder" data-action-category="${cat}" title="新建文件夹">📁</span>`;
            }
            if (isFolderNode) {
                html += `<span class="tree-action-btn" data-action="delete" data-action-id="${escapeHtml(node.id)}" data-action-type="${escapeHtml(node.type)}" data-action-category="${cat}" title="删除文件夹" style="color:#fca5a5">🗑️</span>`;
            }
            html += `</span>`;
        }

        // Regenerate + delete buttons (for leaf items only)
        if (isRegenerable && !showHoverActions) {
            const cat = getCategoryFromType(node.type);
            html += `<span class="tree-hover-actions">`;
            html += `<span class="tree-regen" data-regen-id="${escapeHtml(node.id)}" data-regen-type="${escapeHtml(node.type)}" title="重新生成">🔄</span>`;
            if (cat) {
                html += `<span class="tree-action-btn" data-action="delete" data-action-id="${escapeHtml(node.id)}" data-action-type="${escapeHtml(node.type)}" data-action-category="${cat}" title="删除" style="color:#fca5a5">🗑️</span>`;
            }
            html += `</span>`;
        }

        html += `</div>`;

        // Children
        if (hasChildren && isExpanded) {
            html += renderTreeHTML(node.children, depth + 1);
        }

        return html;
    }).join('');
}

/**
 * Attach tree event handlers to a container element
 */
export function attachTreeEvents(container, onSelect, onRegenerate, onContextMenu) {
    // Remove previous listeners to prevent duplicates on re-render
    if (container._treeAbort) container._treeAbort.abort();
    const ac = new AbortController();
    container._treeAbort = ac;
    const opts = { signal: ac.signal };

    container.addEventListener('click', (e) => {
        // Toggle expand/collapse
        const toggle = e.target.closest('[data-toggle-id]');
        if (toggle) {
            const id = toggle.dataset.toggleId;
            state.treeExpanded[id] = !state.treeExpanded[id];
            if (onSelect) onSelect(null, null, true);
            return;
        }

        // Hover action buttons
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            const category = actionBtn.dataset.actionCategory;
            const folderId = actionBtn.dataset.actionFolder || null;
            const actionId = actionBtn.dataset.actionId || null;
            const actionType = actionBtn.dataset.actionType || null;
            if (onContextMenu) onContextMenu(e, null, 'hover-action', { action, category, folderId, actionId, actionType });
            return;
        }

        // Regenerate
        const regen = e.target.closest('[data-regen-id]');
        if (regen) {
            const id = regen.dataset.regenId;
            const type = regen.dataset.regenType;
            if (onRegenerate) onRegenerate(id, type);
            return;
        }

        // Select node — clicking anywhere on the tree-node row
        const treeNode = e.target.closest('[data-node-id]');
        if (treeNode) {
            const label = treeNode.querySelector('[data-select-id]');
            if (label) {
                const id = label.dataset.selectId;
                const type = label.dataset.selectType;

                // Ctrl/Cmd+click multi-select for short nodes
                if ((e.ctrlKey || e.metaKey) && type === 'short') {
                    if (state.selectedNodeIds.has(id)) {
                        state.selectedNodeIds.delete(id);
                    } else {
                        state.selectedNodeIds.add(id);
                    }
                    // Keep primary selection on the clicked node
                    state.selectedNodeId = id;
                    state.selectedNodeType = type;
                } else {
                    state.selectedNodeIds.clear();
                    state.selectedNodeId = id;
                    state.selectedNodeType = type;
                }
                if (onSelect) onSelect(id, type, false);
            }
        }
    }, opts);

    // Context menu for items and folders
    container.addEventListener('contextmenu', (e) => {
        const node = e.target.closest('[data-node-id]');
        if (!node) return;
        const id = node.dataset.nodeId;
        const type = node.dataset.nodeType;
        if (isFolder(type) || type.endsWith('-group') || getCategoryFromType(type)) {
            e.preventDefault();
            if (onContextMenu) onContextMenu(e, id, type);
        }
    }, opts);

    // Drag & drop
    container.addEventListener('dragstart', (e) => {
        const node = e.target.closest('[data-node-id]');
        if (!node || !node.getAttribute('draggable')) return;
        e.dataTransfer.setData('text/plain', node.dataset.nodeId + '|' + node.dataset.nodeType);
        e.dataTransfer.effectAllowed = 'move';
        node.classList.add('tree-dragging');
    }, opts);

    container.addEventListener('dragend', (e) => {
        const node = e.target.closest('[data-node-id]');
        if (node) node.classList.remove('tree-dragging');
        container.querySelectorAll('.tree-drag-over, .tree-drop-before, .tree-drop-after').forEach(el => {
            el.classList.remove('tree-drag-over', 'tree-drop-before', 'tree-drop-after');
        });
    }, opts);

    container.addEventListener('dragover', (e) => {
        const node = e.target.closest('[data-node-id]');
        if (!node) return;
        const type = node.dataset.nodeType;
        // Allow drop on folders, groups, and sibling items (for reorder)
        if (isFolder(type) || type.endsWith('-group') || node.getAttribute('draggable')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            container.querySelectorAll('.tree-drag-over, .tree-drop-before, .tree-drop-after').forEach(el => {
                el.classList.remove('tree-drag-over', 'tree-drop-before', 'tree-drop-after');
            });
            if (isFolder(type) || type.endsWith('-group')) {
                node.classList.add('tree-drag-over');
            } else {
                // Show before/after indicator based on cursor position
                const rect = node.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                node.classList.add(e.clientY < midY ? 'tree-drop-before' : 'tree-drop-after');
            }
        }
    }, opts);

    container.addEventListener('dragleave', (e) => {
        const node = e.target.closest('[data-node-id]');
        if (node) node.classList.remove('tree-drag-over', 'tree-drop-before', 'tree-drop-after');
    }, opts);

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        const dropBefore = e.target.closest('.tree-drop-before') !== null;
        container.querySelectorAll('.tree-drag-over, .tree-drop-before, .tree-drop-after').forEach(el => {
            el.classList.remove('tree-drag-over', 'tree-drop-before', 'tree-drop-after');
        });
        const node = e.target.closest('[data-node-id]');
        if (!node) return;
        const data = e.dataTransfer.getData('text/plain');
        const [draggedId, draggedType] = data.split('|');
        const targetId = node.dataset.nodeId;
        const targetType = node.dataset.nodeType;
        if (!draggedId || draggedId === targetId) return;
        if (onContextMenu) onContextMenu(e, draggedId, 'drop', { targetId, targetType, draggedType, dropBefore });
    }, opts);
}
