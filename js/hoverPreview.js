// ============ Universal Image Hover Preview ============
// Shows an enlarged floating preview when the user hovers any image
// thumbnail in the UI. Uses a single delegated listener on `document`,
// so it works automatically for all existing and future-rendered images
// without needing per-view wiring.
//
// Default: matches every <img> on the page.
// Opt out by adding `data-no-hover-preview` on the img or any ancestor,
// or by placing the img inside one of the SKIP_ANCESTOR_SELECTORS below
// (user avatar, video controls, hover-preview tooltip itself, etc.).
// Also skips images that render smaller than MIN_SIZE_PX (e.g. decorative
// icons) or already render larger than the preview size (so we don't
// downscale big inline imagery).

const SKIP_ANCESTOR_SELECTORS = [
    '#imgPreview',
    '#hoverPreviewTooltip',
    '#userAvatar',
    '#profileDropdown',
    '.img-preview-overlay',
    '[data-no-hover-preview]',
].join(', ');

const SHOW_DELAY_MS = 180;
const MAX_W_VW = 50;
const MAX_H_VH = 70;
const CURSOR_GAP = 16;
const MIN_SIZE_PX = 16;

let tooltipEl = null;
let tooltipImg = null;
let showTimer = null;
let currentSrc = null;

function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'hoverPreviewTooltip';
    tooltipEl.style.cssText = [
        'position:fixed',
        'z-index:300',
        'pointer-events:none',
        'background:rgba(0,0,0,0.85)',
        'border:1px solid rgba(255,255,255,0.12)',
        'border-radius:8px',
        'padding:4px',
        'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
        'backdrop-filter:blur(4px)',
        'opacity:0',
        'transition:opacity 0.12s',
        'display:none',
        'max-width:' + MAX_W_VW + 'vw',
        'max-height:' + MAX_H_VH + 'vh',
    ].join(';');
    tooltipImg = document.createElement('img');
    tooltipImg.style.cssText = [
        'display:block',
        'max-width:' + (MAX_W_VW - 1) + 'vw',
        'max-height:' + (MAX_H_VH - 1) + 'vh',
        'object-fit:contain',
        'border-radius:5px',
    ].join(';');
    tooltipEl.appendChild(tooltipImg);
    document.body.appendChild(tooltipEl);
    return tooltipEl;
}

function hideTooltip() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    currentSrc = null;
    if (!tooltipEl) return;
    tooltipEl.style.opacity = '0';
    tooltipEl.style.display = 'none';
}

function positionTooltip(x, y) {
    if (!tooltipEl) return;
    const rect = tooltipEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + CURSOR_GAP;
    let top = y + CURSOR_GAP;
    if (left + rect.width > vw - 8) left = x - rect.width - CURSOR_GAP;
    if (left < 8) left = 8;
    if (top + rect.height > vh - 8) top = y - rect.height - CURSOR_GAP;
    if (top < 8) top = 8;
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
}

function isEligibleImg(el) {
    if (!el || el.tagName !== 'IMG') return false;
    if (!el.src) return false;
    if (el.closest(SKIP_ANCESTOR_SELECTORS)) return false;
    // Skip decorative tiny icons
    const r = el.getBoundingClientRect();
    if (r.width < MIN_SIZE_PX || r.height < MIN_SIZE_PX) return false;
    // Skip images already rendered at/above the preview size
    const maxW = window.innerWidth * (MAX_W_VW / 100);
    const maxH = window.innerHeight * (MAX_H_VH / 100);
    if (r.width >= maxW * 0.9 && r.height >= maxH * 0.9) return false;
    return true;
}

function showFor(img, x, y) {
    const src = img.currentSrc || img.src;
    if (!src) return;
    ensureTooltip();
    currentSrc = src;
    tooltipImg.src = src;
    tooltipEl.style.display = 'block';
    // Defer positioning to next frame so size is measured
    requestAnimationFrame(() => {
        if (currentSrc !== src) return;
        positionTooltip(x, y);
        tooltipEl.style.opacity = '1';
    });
}

function onMouseOver(e) {
    const img = e.target;
    if (!isEligibleImg(img)) return;
    if (showTimer) clearTimeout(showTimer);
    const x = e.clientX, y = e.clientY;
    showTimer = setTimeout(() => { showFor(img, x, y); }, SHOW_DELAY_MS);
}

function onMouseOut(e) {
    const img = e.target;
    if (!isEligibleImg(img)) return;
    // Only hide if leaving to outside the img (not to a child)
    const to = e.relatedTarget;
    if (to && img.contains(to)) return;
    hideTooltip();
}

function onMouseMove(e) {
    if (!tooltipEl || tooltipEl.style.display === 'none') return;
    positionTooltip(e.clientX, e.clientY);
}

function onScrollOrBlur() { hideTooltip(); }

let installed = false;
export function initHoverPreview() {
    if (installed) return;
    installed = true;
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('scroll', onScrollOrBlur, true);
    window.addEventListener('blur', onScrollOrBlur);
    document.addEventListener('click', onScrollOrBlur, true);
}
