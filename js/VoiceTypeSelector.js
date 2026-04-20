// ============ Voice Type Selector Modal ============
// Popup component for browsing and selecting Doubao TTS voice types.
// Extracted from VoiceTypeSelector.html, adapted as an ES Module for AIMovieMaker.

const DEFAULT_CATALOG_URL = '../config/doubao_voice_type.json';
const DEFAULT_PROXY_URL = 'wss://speechrtc.keepwork.com/tts';
const DEFAULT_PREVIEW_TEXT = '你好，我是当前选中的音色，现在进行实时试音。';

const STYLE = `
.vts-overlay {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.7); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    animation: vts-fadeIn 0.2s ease-out;
}
@keyframes vts-fadeIn { from { opacity: 0; } to { opacity: 1; } }

.vts-modal {
    background: var(--bg-card, #13131f); border: 1px solid var(--border-card, #1e1e30);
    border-radius: 16px; width: min(1200px, calc(100vw - 40px)); height: min(780px, calc(100vh - 40px));
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 12px 60px rgba(0,0,0,0.5);
    animation: vts-slideUp 0.25s ease-out;
}
@keyframes vts-slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

.vts-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--border, #1a1a2e); flex-shrink: 0;
}
.vts-header h3 { font-size: 16px; font-weight: 600; color: var(--text-primary, #e0e0e0); margin: 0; }
.vts-header-actions { display: flex; gap: 8px; align-items: center; }

.vts-body {
    display: grid; grid-template-columns: 300px 1fr; flex: 1; min-height: 0; overflow: hidden;
}

.vts-sidebar {
    border-right: 1px solid var(--border, #1a1a2e); padding: 16px;
    overflow-y: auto; display: flex; flex-direction: column; gap: 16px;
}

.vts-main { padding: 16px; overflow-y: auto; }

.vts-detail-box {
    background: var(--bg-pill, #1a1a2e); border: 1px solid var(--border-card, #1e1e30);
    border-radius: 12px; padding: 14px;
}
.vts-detail-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--text-faint, #444); margin-bottom: 8px; }
.vts-detail-name { font-size: 20px; font-weight: 600; color: var(--text-primary, #e0e0e0); }
.vts-detail-meta { font-size: 13px; color: var(--text-muted, #555); margin-top: 6px; }

.vts-voice-type-box {
    background: var(--input-bg, #0a0a14); border: 1px solid var(--border-card, #1e1e30);
    border-radius: 10px; padding: 10px 12px; margin-top: 10px;
}
.vts-voice-type-val { font-family: monospace; font-size: 13px; color: #7dd3fc; word-break: break-all; }

.vts-preview-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }

.vts-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.vts-tab {
    padding: 5px 12px; border-radius: 20px; font-size: 12px; cursor: pointer;
    border: 1px solid var(--border-card, #1e1e30); background: var(--bg-pill, #1a1a2e);
    color: var(--text-secondary, #888); transition: all 0.15s;
}
.vts-tab:hover { border-color: var(--accent, #6366f1); color: var(--accent-light, #a5b4fc); }
.vts-tab-active { border-color: var(--accent, #6366f1); background: rgba(99,102,241,0.15); color: var(--accent-light, #a5b4fc); }

.vts-input {
    width: 100%; background: var(--input-bg, #0a0a14); border: 1px solid var(--border-card, #1e1e30);
    color: var(--text-primary, #e0e0e0); border-radius: 8px; padding: 8px 12px; font-size: 13px;
    transition: border-color 0.2s; box-sizing: border-box;
}
.vts-input:focus { outline: none; border-color: var(--accent, #6366f1); }
.vts-input::placeholder { color: var(--text-faint, #444); }

.vts-select {
    width: 100%; background: var(--input-bg, #0a0a14); border: 1px solid var(--border-card, #1e1e30);
    color: var(--text-primary, #e0e0e0); border-radius: 8px; padding: 8px 12px; font-size: 13px;
    cursor: pointer;
}
.vts-select:focus { outline: none; border-color: var(--accent, #6366f1); }

.vts-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px;
}

.vts-card {
    padding: 12px; border-radius: 12px; cursor: pointer;
    border: 1px solid var(--border-card, #1e1e30); background: var(--bg-pill, #1a1a2e);
    transition: border-color 0.15s, background 0.15s; text-align: left; width: 100%;
}
.vts-card:hover { border-color: var(--accent, #6366f1); background: var(--bg-pill-hover, #1e1e2e); }
.vts-card-active { border-color: var(--accent, #6366f1); background: rgba(99,102,241,0.12); box-shadow: 0 0 12px rgba(99,102,241,0.15); }
.vts-card-name { font-size: 13px; font-weight: 500; color: var(--text-primary, #e0e0e0); }
.vts-card-scene { font-size: 11px; color: var(--text-muted, #555); margin-top: 4px; }
.vts-card-vt { font-family: monospace; font-size: 10px; color: var(--text-faint, #444); margin-top: 6px; word-break: break-all; }
.vts-card-section { font-size: 9px; padding: 2px 6px; border-radius: 4px; background: var(--input-bg, #0a0a14); color: var(--text-faint, #444); text-transform: uppercase; letter-spacing: 0.1em; }

.vts-footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 20px; border-top: 1px solid var(--border, #1a1a2e); flex-shrink: 0; gap: 12px;
}
.vts-footer-info { font-size: 12px; color: var(--text-muted, #555); }
.vts-footer-actions { display: flex; gap: 8px; }

.vts-btn {
    padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--border-card, #1e1e30); background: var(--bg-pill, #1a1a2e);
    color: var(--text-secondary, #888); transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;
}
.vts-btn:hover { border-color: var(--accent, #6366f1); color: var(--accent-light, #a5b4fc); }
.vts-btn-primary {
    background: var(--accent, #6366f1); color: white; border-color: var(--accent, #6366f1);
}
.vts-btn-primary:hover { opacity: 0.85; }
.vts-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.vts-btn-sm { padding: 5px 12px; font-size: 12px; border-radius: 6px; }
.vts-btn-preview { border-color: rgba(251,191,36,0.3); background: rgba(251,191,36,0.1); color: #fef3c7; }
.vts-btn-preview:hover { background: rgba(251,191,36,0.2); }
.vts-btn-stop { border-color: rgba(244,63,94,0.3); background: rgba(244,63,94,0.1); color: #fecdd3; }
.vts-btn-stop:hover { background: rgba(244,63,94,0.2); }

.vts-speed-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.vts-speed-row label { font-size: 12px; color: var(--text-muted, #555); white-space: nowrap; }
.vts-speed-input { width: 70px; text-align: center; }

.vts-preview-text {
    width: 100%; min-height: 60px; resize: vertical;
    background: var(--input-bg, #0a0a14); border: 1px solid var(--border-card, #1e1e30);
    color: var(--text-primary, #e0e0e0); border-radius: 8px; padding: 8px 12px; font-size: 12px;
    box-sizing: border-box;
}
.vts-preview-text:focus { outline: none; border-color: var(--accent, #6366f1); }

.vts-status { font-size: 11px; color: var(--text-faint, #444); margin-top: 6px; }
.vts-empty { grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: var(--text-muted, #555); font-size: 13px; }
.vts-count { font-size: 12px; color: var(--text-muted, #555); }
`;

function esc(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeCatalog(data) {
    const sections = Array.isArray(data?.sections) ? data.sections : [];
    const sectionMap = sections.map(s => ({ type: s.type || 'unknown', label: s.label || 'Other' }));
    const entryMap = new Map();
    for (const section of sections) {
        const rows = Array.isArray(section.rows) ? section.rows : [];
        for (const row of rows) {
            const parts = String(row || '').split('|').map(p => p.trim()).filter(Boolean);
            const entry = {
                sectionType: section.type || 'unknown',
                sectionLabel: section.label || 'Other',
                scene: parts[0] || '',
                name: parts[1] || parts[0] || '',
                voiceType: parts[2] || '',
            };
            if (!entry.voiceType) continue;
            const existing = entryMap.get(entry.voiceType);
            if (!existing) {
                entryMap.set(entry.voiceType, { ...entry, aliases: entry.name ? [entry.name] : [] });
            } else if (entry.name && !existing.aliases.includes(entry.name)) {
                existing.aliases.push(entry.name);
            }
        }
    }
    return {
        sections: sectionMap,
        entries: Array.from(entryMap.values()).sort((a, b) => {
            const la = a.aliases[0] || a.voiceType;
            const lb = b.aliases[0] || b.voiceType;
            return la.localeCompare(lb, 'zh-CN');
        }),
    };
}

export default class VoiceTypeSelector {
    /**
     * @param {Object} opts
     * @param {string}   [opts.catalogUrl]       - URL to doubao_voice_type.json
     * @param {Function} [opts.onSelect]         - callback({ voiceType, voiceName, sectionType, sectionLabel, scene })
     * @param {string}   [opts.initialVoiceType] - pre-selected voice_type
     * @param {string}   [opts.proxyUrl]         - SpeechRTC proxy URL
     * @param {number}   [opts.initialSpeed]     - initial speech rate (-50~100)
     */
    constructor(opts = {}) {
        this.catalogUrl = opts.catalogUrl || DEFAULT_CATALOG_URL;
        this.onSelect = opts.onSelect || (() => {});
        this.proxyUrl = opts.proxyUrl || DEFAULT_PROXY_URL;
        this.selectedVoiceType = opts.initialVoiceType || '';
        this.speechRate = opts.initialSpeed || 0;

        this.entries = [];
        this.sections = [];
        this.sectionType = '';
        this.scene = '';
        this.keyword = '';
        this.previewSession = null;
        this._overlay = null;
        this._styleEl = null;
        this._destroyed = false;
    }

    // ---- Public API ----

    async open() {
        if (this._destroyed) return;
        this._injectStyle();
        this._buildDOM();
        document.body.appendChild(this._overlay);
        await this._loadCatalog();
    }

    close() {
        this._stopPreview();
        if (this._overlay && this._overlay.parentNode) {
            this._overlay.parentNode.removeChild(this._overlay);
        }
    }

    destroy() {
        this._destroyed = true;
        this.close();
        if (this._styleEl && this._styleEl.parentNode) {
            this._styleEl.parentNode.removeChild(this._styleEl);
        }
    }

    // ---- Internal: Style ----

    _injectStyle() {
        if (document.getElementById('vts-style')) return;
        const style = document.createElement('style');
        style.id = 'vts-style';
        style.textContent = STYLE;
        document.head.appendChild(style);
        this._styleEl = style;
    }

    // ---- Internal: DOM Build ----

    _buildDOM() {
        const overlay = document.createElement('div');
        overlay.className = 'vts-overlay';
        overlay.innerHTML = `
        <div class="vts-modal">
            <div class="vts-header">
                <h3>🎙 选择旁白音色</h3>
                <div class="vts-header-actions">
                    <button class="vts-btn vts-btn-sm" data-vts="close">&times; 关闭</button>
                </div>
            </div>
            <div class="vts-body">
                <div class="vts-sidebar">
                    <!-- Detail -->
                    <div class="vts-detail-box">
                        <div class="vts-detail-label">当前选择</div>
                        <div class="vts-detail-name" data-vts="sel-name">尚未选择音色</div>
                        <div class="vts-detail-meta" data-vts="sel-meta">从右侧列表中选择一个音色</div>
                        <div class="vts-voice-type-box">
                            <div class="vts-detail-label" style="margin-bottom:4px">voice_type</div>
                            <div class="vts-voice-type-val" data-vts="sel-vt">-</div>
                        </div>
                        <div class="vts-preview-row">
                            <button class="vts-btn vts-btn-sm vts-btn-preview" data-vts="preview">▶ 试听</button>
                            <button class="vts-btn vts-btn-sm vts-btn-stop" data-vts="stop">⏹ 停止</button>
                            <span class="vts-status" data-vts="preview-status">空闲</span>
                        </div>
                        <div class="vts-speed-row">
                            <label>语速</label>
                            <input type="number" class="vts-input vts-speed-input" data-vts="speed" min="-50" max="100" step="1" value="${this.speechRate}">
                        </div>
                    </div>
                    <!-- Preview Text -->
                    <div>
                        <div class="vts-detail-label">试听文本</div>
                        <textarea class="vts-preview-text" data-vts="preview-text">${esc(DEFAULT_PREVIEW_TEXT)}</textarea>
                    </div>
                    <!-- Section Tabs -->
                    <div>
                        <div class="vts-detail-label">模型分类</div>
                        <div class="vts-tabs" data-vts="tabs"></div>
                    </div>
                    <!-- Filters -->
                    <div>
                        <div class="vts-detail-label">搜索</div>
                        <input class="vts-input" data-vts="search" placeholder="按名称、场景或 voice_type 搜索">
                    </div>
                    <div>
                        <div class="vts-detail-label">场景</div>
                        <select class="vts-select" data-vts="scene-filter"><option value="">全部场景</option></select>
                    </div>
                    <div class="vts-count" data-vts="count">0 个音色</div>
                </div>
                <div class="vts-main">
                    <div class="vts-grid" data-vts="grid">
                        <div class="vts-empty">正在加载音色目录...</div>
                    </div>
                </div>
            </div>
            <div class="vts-footer">
                <div class="vts-footer-info" data-vts="footer-info">请选择一个音色</div>
                <div class="vts-footer-actions">
                    <button class="vts-btn" data-vts="cancel">取消</button>
                    <button class="vts-btn vts-btn-primary" data-vts="confirm" disabled>确认选择</button>
                </div>
            </div>
        </div>`;

        this._overlay = overlay;
        this._el = (sel) => overlay.querySelector(`[data-vts="${sel}"]`);

        // Close on overlay background click
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

        // Button events
        overlay.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-vts]');
            if (!btn) return;
            const action = btn.dataset.vts;
            if (action === 'close' || action === 'cancel') this.close();
            else if (action === 'confirm') this._confirm();
            else if (action === 'preview') this._doPreview();
            else if (action === 'stop') this._stopPreview();
        });

        // Search input
        this._el('search').addEventListener('input', (e) => {
            this.keyword = e.target.value;
            this._render();
        });

        // Scene filter
        this._el('scene-filter').addEventListener('change', (e) => {
            this.scene = e.target.value;
            this._render();
        });

        // Speed
        this._el('speed').addEventListener('input', (e) => {
            this.speechRate = parseInt(e.target.value) || 0;
        });
    }

    // ---- Internal: Catalog ----

    async _loadCatalog() {
        try {
            const resp = await fetch(this.catalogUrl, { cache: 'no-store' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const { sections, entries } = normalizeCatalog(data);
            this.sections = sections;
            this.entries = entries;
            // Default to first section
            if (this.sections.length && !this.sectionType) {
                this.sectionType = this.sections[0].type;
            }
            // If no initial selection but entries exist, don't auto-select (user should pick)
            this._render();
        } catch (err) {
            const grid = this._el('grid');
            if (grid) grid.innerHTML = `<div class="vts-empty">加载音色目录失败: ${esc(err.message)}</div>`;
        }
    }

    // ---- Internal: Render ----

    _render() {
        if (this._destroyed || !this._overlay) return;
        this._renderTabs();
        const visible = this._getVisible();
        this._renderSceneFilter(visible);
        this._renderGrid(visible);
        this._renderSelection();
        this._renderFooter(visible);
    }

    _renderTabs() {
        const host = this._el('tabs');
        if (!host) return;
        host.innerHTML = this.sections.map(s => {
            const cls = s.type === this.sectionType ? 'vts-tab vts-tab-active' : 'vts-tab';
            return `<button class="${cls}" data-section="${esc(s.type)}">${esc(s.label)}</button>`;
        }).join('');
        host.querySelectorAll('[data-section]').forEach(btn => {
            btn.onclick = () => {
                this.sectionType = btn.dataset.section;
                this.scene = '';
                this._render();
            };
        });
    }

    _getVisible() {
        const kw = this.keyword.trim().toLowerCase();
        return this.entries.filter(e => {
            if (this.sectionType && e.sectionType !== this.sectionType) return false;
            if (this.scene && e.scene !== this.scene) return false;
            if (!kw) return true;
            const hay = [e.sectionLabel, e.sectionType, e.scene, e.voiceType, ...e.aliases].join(' ').toLowerCase();
            return hay.includes(kw);
        });
    }

    _renderSceneFilter(entries) {
        const sel = this._el('scene-filter');
        if (!sel) return;
        const matching = this.entries.filter(e => !this.sectionType || e.sectionType === this.sectionType);
        const scenes = [...new Set(matching.map(e => e.scene).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        sel.innerHTML = '<option value="">全部场景</option>' + scenes.map(s =>
            `<option value="${esc(s)}" ${s === this.scene ? 'selected' : ''}>${esc(s)}</option>`
        ).join('');
        if (this.scene && !scenes.includes(this.scene)) this.scene = '';
        const countEl = this._el('count');
        if (countEl) countEl.textContent = `${entries.length} 个音色`;
    }

    _renderGrid(entries) {
        const grid = this._el('grid');
        if (!grid) return;
        if (!entries.length) {
            grid.innerHTML = '<div class="vts-empty">当前筛选条件下没有匹配的音色</div>';
            return;
        }
        grid.innerHTML = entries.map(e => {
            const active = e.voiceType === this.selectedVoiceType;
            const cls = active ? 'vts-card vts-card-active' : 'vts-card';
            return `<button class="${cls}" data-voice="${esc(e.voiceType)}">
                <div style="display:flex;align-items:start;justify-content:space-between;gap:8px">
                    <div>
                        <div class="vts-card-name">${esc(e.aliases[0] || e.voiceType)}</div>
                        <div class="vts-card-scene">${esc(e.scene || '未分类')}</div>
                    </div>
                    <span class="vts-card-section">${esc(e.sectionType)}</span>
                </div>
                <div class="vts-card-vt">${esc(e.voiceType)}</div>
            </button>`;
        }).join('');
        grid.querySelectorAll('[data-voice]').forEach(btn => {
            btn.onclick = () => {
                this.selectedVoiceType = btn.dataset.voice;
                this._render();
            };
        });
    }

    _renderSelection() {
        const entry = this.entries.find(e => e.voiceType === this.selectedVoiceType);
        const nameEl = this._el('sel-name');
        const metaEl = this._el('sel-meta');
        const vtEl = this._el('sel-vt');
        if (!entry) {
            if (nameEl) nameEl.textContent = '尚未选择音色';
            if (metaEl) metaEl.textContent = '从右侧列表中选择一个音色';
            if (vtEl) vtEl.textContent = '-';
            return;
        }
        if (nameEl) nameEl.textContent = entry.aliases[0] || entry.voiceType;
        if (metaEl) metaEl.textContent = `${entry.sectionLabel}${entry.scene ? ' / ' + entry.scene : ''}`;
        if (vtEl) vtEl.textContent = entry.voiceType;

        const confirmBtn = this._el('confirm');
        if (confirmBtn) confirmBtn.disabled = false;
    }

    _renderFooter(entries) {
        const info = this._el('footer-info');
        if (!info) return;
        const section = this.sections.find(s => s.type === this.sectionType);
        const label = section ? section.label : '全部';
        info.textContent = `${label} · ${entries.length} 个音色 · 共 ${this.entries.length} 个`;
    }

    // ---- Internal: Preview (SpeechRTC) ----

    _ensureSpeechRTC() {
        if (this._speechRTC) return this._speechRTC;
        if (typeof SpeechRTC === 'undefined') {
            throw new Error('SpeechRTC 不可用，请确认 keepworkSDK 已加载');
        }
        const sdk = window.keepwork;
        if (!sdk) throw new Error('keepwork SDK 不可用');
        this._speechRTC = sdk.speechRTC || new SpeechRTC(sdk);
        if (!sdk.speechRTC) sdk.speechRTC = this._speechRTC;
        return this._speechRTC;
    }

    async _doPreview() {
        const entry = this.entries.find(e => e.voiceType === this.selectedVoiceType);
        if (!entry) {
            this._setStatus('请先选择一个音色');
            return;
        }
        const text = (this._el('preview-text')?.value || DEFAULT_PREVIEW_TEXT).trim();
        if (!text) {
            this._setStatus('试听文本不能为空');
            return;
        }

        try {
            const rtc = this._ensureSpeechRTC();
            await this._stopPreview();

            const config = {
                resourceId: 'volc.service_type.10029',
                namespace: 'BidirectionalTTS',
                speaker: entry.voiceType,
                audioFormat: 'pcm',
                sampleRate: 24000,
                speechRate: this.speechRate,
                autoPlay: true,
                enableSubtitle: false,
                enableTimestamp: false,
                includeUsage: false,
                proxyUrl: this.proxyUrl,
                reqParams: {},
            };

            const session = rtc.createSession(config);
            this.previewSession = session;
            this._setStatus('试听中...');

            await session.synthesize(text, { close: false });
            // Wait for playback to finish
            if (session.getRemainingPlaybackTime) {
                const remaining = Math.ceil(session.getRemainingPlaybackTime() * 1000);
                if (remaining > 50) {
                    await new Promise(resolve => {
                        let settled = false;
                        const done = () => { if (!settled) { settled = true; resolve(); } };
                        if (typeof session.on === 'function') session.on('audioPlaybackEnded', done);
                        setTimeout(done, Math.max(remaining + 800, 1500));
                    });
                }
            }
            await session.close({ finish: false }).catch(() => {});
            this._setStatus('试听完成');
        } catch (err) {
            this._setStatus(`试听失败: ${err.message}`);
        } finally {
            if (this.previewSession) {
                this.previewSession = null;
            }
            this._setStatus('空闲');
        }
    }

    async _stopPreview() {
        if (!this.previewSession) return;
        try {
            await this.previewSession.interrupt();
            if (typeof this.previewSession.close === 'function') {
                await this.previewSession.close({ finish: false }).catch(() => {});
            }
        } catch (_) {}
        this.previewSession = null;
        this._setStatus('空闲');
    }

    _setStatus(text) {
        const el = this._el('preview-status');
        if (el) el.textContent = text;
    }

    // ---- Internal: Confirm ----

    _confirm() {
        const entry = this.entries.find(e => e.voiceType === this.selectedVoiceType);
        if (!entry) return;
        this.speechRate = parseInt(this._el('speed')?.value) || 0;
        this.onSelect({
            voiceType: entry.voiceType,
            voiceName: entry.aliases[0] || entry.voiceType,
            sectionType: entry.sectionType,
            sectionLabel: entry.sectionLabel,
            scene: entry.scene,
            speechRate: this.speechRate,
        });
        this.close();
    }
}
