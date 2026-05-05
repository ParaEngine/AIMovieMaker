// =================== 词汇跟读模式 — 视频进度条控制器 ===================

/**
 * VocabProgressBar — 视频底部进度条
 * 功能：播放/暂停、时间显示、拖动 seek、播放速度切换
 */

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5];

export class VocabProgressBar {
  /**
   * @param {import('./video-controller.js').VideoController} videoCtrl
   */
  constructor(videoCtrl) {
    this._videoCtrl = videoCtrl;
    this._bar = null;
    this._playBtn = null;
    this._timeEl = null;
    this._durationEl = null;
    this._track = null;
    this._filled = null;
    this._thumb = null;
    this._speedBtn = null;
    this._speedMenu = null;
    this._speedWrap = null;
    this._seeking = false;
    this._speedIdx = SPEED_OPTIONS.indexOf(1); // default 1x
    this._rafId = null;
    /** @type {((timeSec: number) => void)|null} */
    this._onSeekCallback = null;

    this._onTimeUpdate = this._onTimeUpdate.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  /**
   * Bind DOM elements and set up event listeners
   */
  init() {
    this._bar = document.getElementById('vocProgressBar');
    this._playBtn = document.getElementById('vocPbPlay');
    this._timeEl = document.getElementById('vocPbTime');
    this._durationEl = document.getElementById('vocPbDuration');
    this._track = document.getElementById('vocPbTrack');
    this._filled = document.getElementById('vocPbFilled');
    this._thumb = document.getElementById('vocPbThumb');
    this._speedBtn = document.getElementById('vocPbSpeed');
    this._speedMenu = document.getElementById('vocPbSpeedMenu');
    this._speedWrap = document.getElementById('vocPbSpeedWrap');
    if (!this._bar) return;

    // Play/pause
    this._playBtn?.addEventListener('click', () => this._togglePlay());

    // Speed — popup menu
    this._speedBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleSpeedMenu();
    });
    this._speedMenu?.addEventListener('click', (e) => {
      e.stopPropagation();
      const opt = e.target.closest('.voc-pb-speed-option');
      if (opt) this._selectSpeed(parseFloat(opt.dataset.rate));
    });
    // Close menu on outside click
    this._onDocClick = (e) => {
      if (this._speedWrap && !this._speedWrap.contains(e.target)) {
        this._speedMenu?.classList.add('hidden');
      }
    };
    document.addEventListener('click', this._onDocClick);

    // Seek — pointer events for both mouse and touch
    this._track?.addEventListener('pointerdown', this._onPointerDown);

    // Video events (事件始终从 <video> 元素分发，YouTube 模式下由 VideoController 轮询模拟)
    const video = this._videoCtrl._video;
    video.addEventListener('timeupdate', this._onTimeUpdate);
    video.addEventListener('play', () => this._updatePlayState(true));
    video.addEventListener('pause', () => this._updatePlayState(false));
    video.addEventListener('loadedmetadata', () => {
      this._durationEl.textContent = _formatTime(this._videoCtrl.duration);
    });
    // If already loaded
    if (this._videoCtrl.duration) {
      this._durationEl.textContent = _formatTime(this._videoCtrl.duration);
    }
  }

  /**
   * Register callback when user completes a seek action.
   * @param {(timeSec: number) => void} fn
   */
  onSeek(fn) {
    this._onSeekCallback = fn;
  }

  show() {
    if (this._bar) this._bar.classList.remove('hidden');
  }

  hide() {
    if (this._bar) this._bar.classList.add('hidden');
  }

  destroy() {
    if (this._track) {
      this._track.removeEventListener('pointerdown', this._onPointerDown);
    }
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    if (this._onDocClick) document.removeEventListener('click', this._onDocClick);
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  // --- internal ---

  _togglePlay() {
    if (this._videoCtrl.paused) {
      this._videoCtrl.play();
    } else {
      this._videoCtrl.pause();
    }
  }

  _updatePlayState(playing) {
    if (!this._bar) return;
    if (playing) {
      this._bar.classList.add('playing');
    } else {
      this._bar.classList.remove('playing');
    }
  }

  _toggleSpeedMenu() {
    if (!this._speedMenu) return;
    this._speedMenu.classList.toggle('hidden');
  }

  _selectSpeed(rate) {
    if (!SPEED_OPTIONS.includes(rate)) return;
    this._speedIdx = SPEED_OPTIONS.indexOf(rate);
    this._videoCtrl.setPlaybackRate(rate);
    if (this._speedBtn) this._speedBtn.textContent = rate === 1 ? '1x' : `${rate}x`;
    // Update selected state
    this._speedMenu?.querySelectorAll('.voc-pb-speed-option').forEach(el => {
      el.classList.toggle('selected', parseFloat(el.dataset.rate) === rate);
    });
    this._speedMenu?.classList.add('hidden');
  }

  _onTimeUpdate() {
    if (this._seeking) return;
    const t = this._videoCtrl.currentTime;
    const d = this._videoCtrl.duration || 1;
    const pct = (t / d) * 100;
    if (this._filled) this._filled.style.width = `${pct}%`;
    if (this._thumb) this._thumb.style.left = `${pct}%`;
    if (this._timeEl) this._timeEl.textContent = _formatTime(t);
  }

  _onPointerDown(e) {
    e.preventDefault();
    this._seeking = true;
    this._bar?.classList.add('seeking');
    this._track?.setPointerCapture(e.pointerId);
    this._seekToPointer(e);
    document.addEventListener('pointermove', this._onPointerMove);
    document.addEventListener('pointerup', this._onPointerUp);
  }

  _onPointerMove(e) {
    if (!this._seeking) return;
    this._seekToPointer(e);
  }

  _onPointerUp(e) {
    if (!this._seeking) return;
    this._seeking = false;
    this._bar?.classList.remove('seeking');
    this._seekToPointer(e);
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    // Fire seek callback with final time
    if (this._onSeekCallback) {
      this._onSeekCallback(this._videoCtrl.currentTime);
    }
  }

  _seekToPointer(e) {
    if (!this._track) return;
    const rect = this._track.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = x / rect.width;
    const duration = this._videoCtrl.duration || 1;
    const time = ratio * duration;
    const pct = ratio * 100;

    // Visual update
    if (this._filled) this._filled.style.width = `${pct}%`;
    if (this._thumb) this._thumb.style.left = `${pct}%`;
    if (this._timeEl) this._timeEl.textContent = _formatTime(time);

    // Actual seek
    this._videoCtrl.seekTo(time);
  }
}

/**
 * @param {number} sec
 * @returns {string} e.g. "1:23" or "12:05"
 */
function _formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
