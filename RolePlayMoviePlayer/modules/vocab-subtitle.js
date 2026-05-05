// =================== 词汇跟读模式 — 字幕管理器 ===================

/**
 * VocabSubtitle — 两层字幕区（英文卡拉OK + 中文翻译）
 *
 * 与游戏模式 SubtitleManager 的区别：
 * - 两层（目标句 + 中文翻译），无母语行、IPA 行、下句预览、音素球
 * - 三档词风格（dim → active → matched/skipped），无十档石化质感
 * - 无弹分/Combo 动画/判定弹窗
 * - 轻量 PASS/FAIL 反馈（图标 + 快速淡出）
 */

export class VocabSubtitle {
  constructor() {
    /** @type {HTMLElement|null} */ this._container = null;
    /** @type {HTMLElement|null} */ this._targetEl = null;
    /** @type {HTMLElement|null} */ this._zhEl = null;
    /** @type {HTMLElement|null} */ this._micIndicator = null;
    /** @type {HTMLElement|null} */ this._feedbackEl = null;
    /** @type {object|null} */ this._currentTrack = null;
  }

  /**
   * @param {{container: HTMLElement, target: HTMLElement, zh: HTMLElement, micIndicator: HTMLElement}} els
   */
  setElements(els) {
    this._container = els.container;
    this._targetEl = els.target;
    this._zhEl = els.zh;
    this._micIndicator = els.micIndicator;
  }

  show() {
    if (this._container) this._container.classList.remove('hidden');
  }

  hide() {
    if (this._container) this._container.classList.add('hidden');
  }

  /**
   * 渲染看片状态字幕（静态英文 + 中文翻译）
   * @param {string} targetText
   * @param {string} zhText
   */
  renderStatic(targetText, zhText) {
    if (this._targetEl) {
      this._targetEl.innerHTML = `<span class="voc-word voc-word--dim">${_escHtml(targetText)}</span>`;
    }
    if (this._zhEl) {
      this._zhEl.textContent = zhText || '';
    }
  }

  /**
   * 渲染卡拉OK字幕（逐词高亮，三档颜色）
   * @param {object} track - SubtitleTrack with targetText / wordTiming
   * @param {{matched:boolean, score:number, skipped:boolean}[]|number} matchedInfo
   */
  renderKaraoke(track, matchedInfo = 0) {
    if (!track || !this._targetEl) return;
    this._currentTrack = track;

    const words = track.wordTiming && track.wordTiming.length > 0
      ? track.wordTiming.map(w => w.text)
      : track.targetText.split(/\s+/);

    let details;
    if (Array.isArray(matchedInfo) && matchedInfo.length > 0 && typeof matchedInfo[0] === 'object') {
      details = matchedInfo;
    } else {
      const count = typeof matchedInfo === 'number' ? matchedInfo : 0;
      details = words.map((_, i) => ({ matched: i < count, score: i < count ? 1.0 : 0, skipped: false }));
    }

    const firstUnmatched = details.findIndex(d => !d.matched && !d.skipped);

    let html = '';
    for (let i = 0; i < words.length; i++) {
      if (i > 0) html += ' ';
      const d = details[i] || { matched: false, score: 0, skipped: false };

      if (d.matched) {
        html += `<span class="voc-word voc-word--matched">${_escHtml(words[i])}</span>`;
      } else if (d.skipped) {
        html += `<span class="voc-word voc-word--skipped">${_escHtml(words[i])}</span>`;
      } else if (i === firstUnmatched) {
        html += `<span class="voc-word voc-word--active">${_escHtml(words[i])}</span>`;
      } else {
        html += `<span class="voc-word voc-word--dim">${_escHtml(words[i])}</span>`;
      }
    }

    this._targetEl.innerHTML = html;
  }

  /**
   * 设置中文翻译（可在 renderKaraoke 之外单独调用）
   * @param {string} zhText
   */
  setTranslation(zhText) {
    if (this._zhEl) this._zhEl.textContent = zhText || '';
  }

  clear() {
    if (this._targetEl) this._targetEl.innerHTML = '';
    if (this._zhEl) this._zhEl.textContent = '';
    this._currentTrack = null;
  }

  /**
   * 显示 PASS 反馈 — 绿色 ✓，0.8s 淡出
   * @returns {Promise<void>}
   */
  showPassFeedback() {
    return this._showFeedback('✓', 'voc-feedback--pass');
  }

  /**
   * 显示 FAIL 反馈 — 橙色提示
   * @returns {Promise<void>}
   */
  showFailFeedback() {
    return this._showFeedback('再试一次', 'voc-feedback--fail');
  }

  /**
   * @param {'recording'|'waiting'|false} state
   */
  setMicState(state) {
    if (!this._micIndicator) return;
    if (!state) {
      this._micIndicator.classList.add('hidden');
      return;
    }
    this._micIndicator.classList.remove('hidden');
    this._micIndicator.dataset.state = state;
    const dot = this._micIndicator.querySelector('.voc-mic-dot');
    const label = this._micIndicator.querySelector('.voc-mic-label');
    if (dot) dot.className = `voc-mic-dot voc-mic-dot--${state}`;
    if (label) label.textContent = state === 'recording' ? '跟读中' : '准备中';
  }

  /** @private */
  _showFeedback(text, cls) {
    return new Promise(resolve => {
      // Reuse or create feedback element inside container
      let fb = this._container?.querySelector('.voc-feedback');
      if (!fb) {
        fb = document.createElement('div');
        fb.className = 'voc-feedback';
        this._container?.appendChild(fb);
      }
      fb.textContent = text;
      fb.className = `voc-feedback ${cls}`;
      // Force reflow to restart animation
      void fb.offsetWidth;
      fb.classList.add('voc-feedback--visible');

      const onEnd = () => {
        fb.classList.remove('voc-feedback--visible');
        fb.remove();
        resolve();
      };
      fb.addEventListener('animationend', onEnd, { once: true });
      // Fallback timeout
      setTimeout(onEnd, 1000);
    });
  }
}

/** @param {string} s */
function _escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
