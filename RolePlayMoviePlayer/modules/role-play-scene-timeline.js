// =================== Role-Play Movie — Scene Timeline ===================
// A horizontal track that shows the movie's scene blocks (shortClips), with
// a moving cursor for the current playback position. Click a scene to seek
// to its start; click empty area to seek to that timestamp.

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtTime(ms) {
  ms = Math.max(0, ms | 0);
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class RolePlaySceneTimeline {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.scenes = [];
    this.durationMs = 0;
    this.currentMs = 0;
    this.handlers = { seek: null };
    this._build();
  }

  _build() {
    this.root.classList.add('rp-scene-timeline');
    this.root.innerHTML = `
      <div class="rp-st-readout" id="rpStReadout">0:00 / 0:00</div>
      <div class="rp-st-track" id="rpStTrack" title="点击场景或空白处可跳转">
        <div class="rp-st-cursor" id="rpStCursor"></div>
      </div>
    `;
    this.trackEl = this.root.querySelector('#rpStTrack');
    this.cursorEl = this.root.querySelector('#rpStCursor');
    this.readoutEl = this.root.querySelector('#rpStReadout');

    this.trackEl.addEventListener('click', (e) => {
      if (!this.durationMs || !this.handlers.seek) return;
      // If the click landed on a scene block, the block's own handler ran first
      // and called stopPropagation(). Falling through here means a click on the
      // bare track — seek to that fractional position.
      const rect = this.trackEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.handlers.seek(pct * this.durationMs);
    });
  }

  on(event, handler) {
    if (event in this.handlers) this.handlers[event] = handler;
  }

  /**
   * @param {{startMs:number,endMs:number,description:string,id?:string}[]} scenes
   * @param {number} durationMs
   */
  setScenes(scenes, durationMs) {
    this.scenes = Array.isArray(scenes) ? scenes : [];
    let dur = Number(durationMs) || 0;
    for (const s of this.scenes) dur = Math.max(dur, s.endMs);
    this.durationMs = dur;
    this._renderScenes();
    this._updateCursor();
    this._updateReadout();
  }

  setDuration(durationMs) {
    if (durationMs && durationMs > this.durationMs) {
      this.durationMs = durationMs;
      this._renderScenes();
      this._updateCursor();
      this._updateReadout();
    }
  }

  setCurrent(ms) {
    this.currentMs = Math.max(0, Number(ms) || 0);
    this._updateCursor();
    this._updateReadout();
    this._updateActiveScene();
  }

  _renderScenes() {
    if (!this.trackEl) return;
    [...this.trackEl.querySelectorAll('.rp-st-scene')].forEach(b => b.remove());
    if (!this.durationMs || !this.scenes.length) return;
    for (let i = 0; i < this.scenes.length; i++) {
      const s = this.scenes[i];
      const left = (s.startMs / this.durationMs) * 100;
      const width = Math.max(0.4, ((s.endMs - s.startMs) / this.durationMs) * 100);
      const block = document.createElement('div');
      block.className = 'rp-st-scene';
      block.dataset.idx = String(i);
      block.style.left = left + '%';
      block.style.width = width + '%';
      const label = s.description || `场景 ${i + 1}`;
      block.title = `${fmtTime(s.startMs)} → ${fmtTime(s.endMs)}\n${label}`;
      block.textContent = String(i + 1);
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.handlers.seek) this.handlers.seek(s.startMs);
      });
      this.trackEl.insertBefore(block, this.cursorEl);
    }
  }

  _updateCursor() {
    if (!this.cursorEl) return;
    if (!this.durationMs) { this.cursorEl.style.display = 'none'; return; }
    this.cursorEl.style.display = '';
    const pct = Math.max(0, Math.min(100, (this.currentMs / this.durationMs) * 100));
    this.cursorEl.style.left = pct + '%';
  }

  _updateReadout() {
    if (!this.readoutEl) return;
    this.readoutEl.textContent = `${fmtTime(this.currentMs)} / ${fmtTime(this.durationMs)}`;
  }

  _updateActiveScene() {
    if (!this.trackEl) return;
    const blocks = this.trackEl.querySelectorAll('.rp-st-scene');
    blocks.forEach(b => {
      const idx = Number(b.dataset.idx);
      const s = this.scenes[idx];
      if (!s) return;
      if (this.currentMs >= s.startMs && this.currentMs < s.endMs) b.classList.add('rp-st-active');
      else b.classList.remove('rp-st-active');
    });
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }
}
