// =================== Role-Play Movie — Bottom Subtitle Panel ===================
// Shows the current subtitle line + the next 1-2 lines (for all characters,
// including non-player ones) in the black area below the video.
//
// During a player line ("user turn") the bottom panel is hidden and the old
// in-video DDR-style subtitle/HUD takes over (handled in gameplay.js).

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export class RolePlayBottomPanel {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.tracks = [];
    this.currentIdx = -1;
    this.paused = false;
    /** Per-word match details for the current line (used during user turn). */
    this.currentDetails = null;
    this._build();
  }

  _build() {
    this.root.classList.add('rp-bottom-panel');
    this.root.innerHTML = `
      <div class="rp-bp-list" id="rpBpList"></div>
      <div class="rp-bp-hint" id="rpBpHint"></div>
    `;
    this.listEl = this.root.querySelector('#rpBpList');
    this.hintEl = this.root.querySelector('#rpBpHint');
    this._updateHint();
  }

  /** @param {{startMs:number,endMs:number,targetText:string,nativeText:string,isPlayer:boolean}[]} tracks */
  setTracks(tracks) {
    this.tracks = Array.isArray(tracks) ? tracks : [];
    this.render();
  }

  setCurrent(idx) {
    if (idx === this.currentIdx) return;
    this.currentIdx = idx;
    this.currentDetails = null;
    this.render();
  }

  /**
   * Set per-word match details for the current line.
   * @param {{matched:boolean,score:number,skipped:boolean}[]|null} details
   */
  setCurrentDetails(details) {
    this.currentDetails = Array.isArray(details) && details.length ? details : null;
    this.render();
  }

  setPaused(paused) {
    this.paused = !!paused;
    this._updateHint();
  }

  _updateHint() {
    if (!this.hintEl) return;
    this.hintEl.textContent = this.paused
      ? '已暂停 — 点击视频继续'
      : '点击视频可暂停 / 继续';
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  render() {
    if (!this.listEl) return;
    if (!this.tracks.length) {
      this.listEl.innerHTML = '<div class="rp-bp-empty">— 没有字幕 —</div>';
      return;
    }
    if (this.currentIdx >= this.tracks.length) {
      this.listEl.innerHTML = '<div class="rp-bp-empty">— 完 —</div>';
      return;
    }

    const startIdx = Math.max(0, this.currentIdx);
    const endIdx = Math.min(this.tracks.length - 1, this.currentIdx + 2);
    const items = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const t = this.tracks[i];
      if (!t) continue;
      const cls = ['rp-bp-line'];
      if (i === this.currentIdx) cls.push('rp-bp-current');
      else cls.push('rp-bp-upcoming');
      if (t.isPlayer) cls.push('rp-bp-player');
      const speaker = t.nativeText ? `<span class="rp-bp-speaker">${escapeHtml(t.nativeText)}:</span>` : '';
      const isCurrentPlayer = (i === this.currentIdx) && t.isPlayer && this.currentDetails;
      const textHtml = isCurrentPlayer
        ? this._renderWordHighlights(t, this.currentDetails)
        : `<span class="rp-bp-text">${escapeHtml(t.targetText)}</span>`;
      items.push(
        `<div class="${cls.join(' ')}">${speaker}${textHtml}</div>`
      );
    }
    this.listEl.innerHTML = items.join('');
  }

  /**
   * Render the current player line with per-word highlight states.
   * @param {{targetText:string,wordTiming?:Array<{text:string}>}} track
   * @param {{matched:boolean,score:number,skipped:boolean}[]} details
   * @returns {string}
   */
  _renderWordHighlights(track, details) {
    const words = track.wordTiming && track.wordTiming.length
      ? track.wordTiming.map(w => w.text)
      : (track.targetText || '').split(/\s+/);
    const firstUnmatched = details.findIndex(d => d && !d.matched && !d.skipped);
    const parts = words.map((w, i) => {
      const d = details[i] || { matched: false, score: 0, skipped: false };
      let cls = 'rp-bp-w';
      if (d.matched) cls += ' rp-bp-w-matched';
      else if (d.skipped) cls += ' rp-bp-w-missed';
      else if (i === firstUnmatched) cls += ' rp-bp-w-active';
      else cls += ' rp-bp-w-pending';
      return `<span class="${cls}">${escapeHtml(w)}</span>`;
    });
    return `<span class="rp-bp-text">${parts.join(' ')}</span>`;
  }
}
