// ============ Universal Media Slot Clipboard ============
// Right-click any image/video to Copy its URL; right-click any editable media
// slot (img/video OR empty upload zone) to Paste a URL from the clipboard.
//
// Usage:
//   initImageClipboard();
//
// Making a slot editable (opt-in paste):
//   <div data-img-paste="<slotKey>"> ... img or .upload-zone ... </div>
//   or on the <img> / <label.upload-zone> directly.
//   <div data-video-paste="<slotKey>"> ... video or .upload-zone ... </div>
//   or on the <video> / <label.upload-zone> directly.
//
//   Then listen for a bubbling CustomEvent on any ancestor:
//     parent.addEventListener('imgslot:paste', (e) => {
//       const { url, key, slotEl } = e.detail;
//       // apply url to your state, then re-render
//     });
//     parent.addEventListener('videoslot:paste', (e) => { ... });
//
// Readonly slots (default for all <img>/<video> without paste attributes) only
// get the Copy action.
//
// Opt out entirely: add `data-no-img-clipboard` on the img or any ancestor.

import { localBlobCache } from './utils.js';

const SKIP_ANCESTOR_SELECTORS = [
    '#imgPreview',
    '#hoverPreviewTooltip',
    '#userAvatar',
    '.img-preview-overlay',
    '[data-no-img-clipboard]',
].join(', ');

let menuEl = null;
let installed = false;

function getOriginalUrl(media) {
    if (!media) return '';
    // If local-mode replaced a CDN url with a blob: URL, reverse-lookup
    const src = media.currentSrc || media.src || media.getAttribute('src') || '';
    if (src.startsWith('blob:')) {
        for (const [cdn, blob] of localBlobCache.entries()) {
            if (blob === src) return cdn;
        }
    }
    return src;
}

function findImagePasteSlot(el) {
    if (!el || !(el instanceof Element)) return null;
    return el.closest('[data-img-paste]');
}

function findVideoPasteSlot(el) {
    if (!el || !(el instanceof Element)) return null;
    return el.closest('[data-video-paste]');
}

function isImageUrl(s) {
    if (!s || typeof s !== 'string') return false;
    const t = s.trim();
    if (!t) return false;
    return /^(https?:|asset:|data:image\/)/i.test(t);
}

function isVideoUrl(s) {
    if (!s || typeof s !== 'string') return false;
    const t = s.trim();
    if (!t) return false;
    return /^(https?:|asset:|data:video\/|blob:)/i.test(t);
}

async function readClipboardText() {
    try {
        if (navigator.clipboard && navigator.clipboard.readText) {
            return await navigator.clipboard.readText();
        }
    } catch (_) { /* fallthrough */ }
    return '';
}

async function writeClipboardText(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) { /* fallthrough */ }
    // Legacy fallback
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (_) { return false; }
}

function toast(msg, type = 'info') {
    // Lightweight inline toast to avoid circular imports with utils.js
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.id = 'imgClipboardMenu';
    menuEl.style.cssText = [
        'position:fixed',
        'z-index:400',
        'min-width:180px',
        'background:var(--bg-panel, #1f2937)',
        'border:1px solid var(--border-card, rgba(255,255,255,0.12))',
        'border-radius:8px',
        'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
        'padding:4px',
        'font-size:13px',
        'color:var(--text-primary, #e5e7eb)',
        'display:none',
        'user-select:none',
    ].join(';');
    document.body.appendChild(menuEl);
    return menuEl;
}

function hideMenu() {
    if (menuEl) { menuEl.style.display = 'none'; menuEl.innerHTML = ''; }
}

function showMenu(x, y, items) {
    ensureMenu();
    menuEl.innerHTML = '';
    for (const it of items) {
        const row = document.createElement('div');
        row.textContent = it.label;
        row.style.cssText = [
            'padding:6px 12px',
            'border-radius:5px',
            'cursor:pointer',
            it.disabled ? 'opacity:0.5;pointer-events:none' : '',
        ].join(';');
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg-pill, rgba(255,255,255,0.08))'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
        row.addEventListener('click', async (e) => {
            e.stopPropagation();
            hideMenu();
            try { await it.onClick(); } catch (err) { console.warn('[imgClipboard]', err); }
        });
        menuEl.appendChild(row);
    }
    menuEl.style.display = 'block';
    // Clamp to viewport
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = menuEl.getBoundingClientRect();
    let left = x, top = y;
    if (left + rect.width > vw - 8) left = vw - rect.width - 8;
    if (top + rect.height > vh - 8) top = vh - rect.height - 8;
    menuEl.style.left = Math.max(4, left) + 'px';
    menuEl.style.top = Math.max(4, top) + 'px';
}

async function doCopy(url, type = 'image') {
    const label = type === 'video' ? '视频' : '图片';
    if (!url) { toast(`无可复制的${label}链接`, 'error'); return; }
    const ok = await writeClipboardText(url);
    toast(ok ? `已复制${label}链接` : '复制失败', ok ? 'success' : 'error');
}

async function doPasteImage(slotEl) {
    const text = (await readClipboardText() || '').trim();
    if (!text) { toast('剪贴板为空', 'error'); return; }
    if (!isImageUrl(text)) { toast('剪贴板内容不是图片链接', 'error'); return; }
    const key = slotEl.getAttribute('data-img-paste') || '';
    const evt = new CustomEvent('imgslot:paste', {
        bubbles: true,
        cancelable: true,
        detail: { url: text, key, slotEl },
    });
    const delivered = slotEl.dispatchEvent(evt);
    if (!delivered || evt.defaultPrevented) {
        // A handler explicitly declined
        return;
    }
    // If nobody handled it by calling preventDefault or setting a flag,
    // we still leave the decision to listeners. (Most listeners will
    // update state + re-render.)
}

async function doPasteVideo(slotEl) {
    const text = (await readClipboardText() || '').trim();
    if (!text) { toast('剪贴板为空', 'error'); return; }
    if (!isVideoUrl(text)) { toast('剪贴板内容不是视频链接', 'error'); return; }
    const key = slotEl.getAttribute('data-video-paste') || '';
    const evt = new CustomEvent('videoslot:paste', {
        bubbles: true,
        cancelable: true,
        detail: { url: text, key, slotEl },
    });
    slotEl.dispatchEvent(evt);
}

function onContextMenu(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest(SKIP_ANCESTOR_SELECTORS)) return;

    const img = t.closest('img');
    const video = t.closest('video');
    const imageSlotEl = findImagePasteSlot(t);
    const videoSlotEl = findVideoPasteSlot(t);

    // Nothing actionable → let native context menu show.
    if (!img && !video && !imageSlotEl && !videoSlotEl) return;

    e.preventDefault();
    const items = [];

    if (img) {
        const url = getOriginalUrl(img);
        items.push({
            label: '📋 复制图片链接',
            disabled: !url || url.startsWith('blob:'),
            onClick: () => doCopy(url, 'image'),
        });
    }
    if (video) {
        const url = getOriginalUrl(video);
        items.push({
            label: '📋 复制视频链接',
            disabled: !url || url.startsWith('blob:'),
            onClick: () => doCopy(url, 'video'),
        });
    }
    if (imageSlotEl) {
        items.push({
            label: img ? '📥 粘贴并替换图片' : '📥 粘贴图片链接',
            onClick: () => doPasteImage(imageSlotEl),
        });
    }
    if (videoSlotEl) {
        items.push({
            label: video ? '📥 粘贴并替换视频' : '📥 粘贴视频链接',
            onClick: () => doPasteVideo(videoSlotEl),
        });
    }
    if (items.length === 0) return;
    showMenu(e.clientX, e.clientY, items);
}

function onDocClick(e) {
    if (!menuEl || menuEl.style.display === 'none') return;
    if (e.target && menuEl.contains(e.target)) return;
    hideMenu();
}

export function initImageClipboard() {
    if (installed) return;
    installed = true;
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('scroll', hideMenu, true);
    window.addEventListener('blur', hideMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
}
