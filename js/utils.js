// ============ Utility Functions ============

export function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Local-mode URL resolution cache: CDN URL → blob URL.
// Populated by storage.js local mode engine; consumed by all renderers.
export const localBlobCache = new Map();

/**
 * Resolve a CDN URL to a local blob URL if available, else return original.
 * Use this in all <img src> / <video src> rendering paths.
 */
export function resolveUrl(url) {
    if (!url) return url;
    return localBlobCache.get(url) || url;
}

export function showToast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

export function $(id) {
    return document.getElementById(id);
}

export function truncate(str, len = 60) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
}
