// =================== 影视配音秀 — 音素球系统 ===================

/**
 * @typedef {Object} Phoneme
 * @property {string} ipa - IPA 符号，如 "/luː/"
 * @property {'vowel'|'consonant'} type - 音素类型
 * @property {number} durationMs - 时长
 * @property {number} wordIndex - 对应原文 word 索引
 * @property {'flat'|'rising'|'falling'} [pitch] - 音高方向
 * @property {boolean} [goldChant] - 是否 Gold Chant 关键球
 */

/**
 * 音素球五阶段生命周期：preview → waiting → active → judging → afterglow
 */
const BALL_STAGES = ['preview', 'waiting', 'active', 'judging', 'afterglow'];

export class PhonemeBallManager {
  /**
   * @param {HTMLElement} trackEl - .rps-phoneme-track 容器
   */
  constructor(trackEl) {
    this._trackEl = trackEl;
    /** @type {Phoneme[]} */
    this._phonemes = [];
    /** @type {HTMLElement[]} */
    this._ballEls = [];
    /** @type {string[]} 各球当前阶段 */
    this._stages = [];
    this._activeIndex = -1;
  }

  /**
   * 渲染音素球到轨道
   * @param {Phoneme[]} phonemes
   */
  render(phonemes) {
    this._phonemes = phonemes || [];
    this._activeIndex = -1;
    this._trackEl.innerHTML = '';
    this._ballEls = [];
    this._stages = [];

    if (this._phonemes.length === 0) return;

    for (let i = 0; i < this._phonemes.length; i++) {
      const p = this._phonemes[i];
      const el = document.createElement('span');

      const typeClass = p.type === 'vowel' ? 'rps-ball--vowel' : 'rps-ball--consonant';
      const goldClass = p.goldChant ? 'rps-ball--gold-chant' : '';
      el.className = `rps-ball rps-ball--preview ${typeClass} ${goldClass}`.trim();
      el.textContent = p.ipa;
      el.dataset.phonemeIdx = i;

      // 音高微偏移
      if (p.pitch === 'rising') el.style.marginTop = '-4px';
      else if (p.pitch === 'falling') el.style.marginTop = '4px';

      // 长音 → 更宽
      if (p.durationMs > 200) {
        const widthFactor = Math.min(1.5, p.durationMs / 150);
        el.style.borderRadius = '40%';
        el.style.minWidth = `${Math.round(16 * widthFactor)}px`;
      }

      this._trackEl.appendChild(el);
      this._ballEls.push(el);
      this._stages.push('preview');
    }
  }

  /**
   * 设置球到等待阶段（进入配音时，所有球从 preview → waiting）
   */
  setAllWaiting() {
    for (let i = 0; i < this._ballEls.length; i++) {
      this._setStage(i, 'waiting');
    }
  }

  /**
   * 根据当前匹配到的词索引更新球状态
   * @param {number} wordIndex - 当前正在匹配的词索引（firstUnmatched）
   * @param {{matched:boolean, score:number, skipped:boolean}[]} details - 逐词匹配详情
   */
  updateFromWordMatch(wordIndex, details) {
    for (let i = 0; i < this._phonemes.length; i++) {
      const p = this._phonemes[i];
      const d = details[p.wordIndex];

      if (d && (d.matched || d.skipped)) {
        // 对应词已匹配 → afterglow
        if (this._stages[i] !== 'afterglow') {
          this._setStage(i, 'judging');
          // 短暂 judging 后转 afterglow
          setTimeout(() => this._setStage(i, 'afterglow'), 300);
          this._spawnParticles(i, d.score, d.skipped);
        }
      } else if (p.wordIndex === wordIndex) {
        // 对应词是当前活跃词 → active
        if (this._stages[i] !== 'active') {
          this._setStage(i, 'active');
        }
      } else if (p.wordIndex > wordIndex || wordIndex < 0) {
        // 还未到 → waiting
        if (this._stages[i] === 'preview') {
          this._setStage(i, 'waiting');
        }
      }
    }
    this._activeIndex = wordIndex;
  }

  /**
   * 清空轨道
   */
  clear() {
    this._trackEl.innerHTML = '';
    this._ballEls = [];
    this._stages = [];
    this._phonemes = [];
    this._activeIndex = -1;
  }

  /**
   * @param {number} idx
   * @param {string} stage
   */
  _setStage(idx, stage) {
    if (idx < 0 || idx >= this._ballEls.length) return;
    if (this._stages[idx] === stage) return;

    const el = this._ballEls[idx];
    // 移除旧阶段 class
    for (const s of BALL_STAGES) {
      el.classList.remove(`rps-ball--${s}`);
    }
    el.classList.add(`rps-ball--${stage}`);
    this._stages[idx] = stage;
  }

  /**
   * 判定后喷发粒子
   * @param {number} ballIdx
   * @param {number} score - 0~1
   * @param {boolean} skipped
   */
  _spawnParticles(ballIdx, score, skipped) {
    if (skipped) return;
    const el = this._ballEls[ballIdx];
    if (!el) return;

    const tier = Math.round(score * 10);
    const count = tier <= 3 ? 3 : tier <= 6 ? 5 : tier <= 8 ? 8 : 12;
    const spread = tier <= 3 ? 16 : tier <= 6 ? 24 : tier <= 8 ? 32 : 48;

    const rect = el.getBoundingClientRect();
    const trackRect = this._trackEl.getBoundingClientRect();
    const cx = rect.left - trackRect.left + rect.width / 2;
    const cy = rect.top - trackRect.top + rect.height / 2;

    for (let i = 0; i < count; i++) {
      const particle = document.createElement('span');
      particle.className = 'rps-ball-particle';
      const angle = (Math.PI * 2 * i) / count;
      const dist = spread * (0.5 + Math.random() * 0.5);
      const size = tier >= 9 ? 4 : tier >= 4 ? 3 : 2;

      particle.style.cssText = `
        left: ${cx}px; top: ${cy}px;
        width: ${size}px; height: ${size}px;
        background: var(--rps-tier-t${tier}-text, rgba(255,215,0,0.8));
        --dx: ${Math.cos(angle) * dist}px;
        --dy: ${Math.sin(angle) * dist}px;
        animation: rps-particle-burst 0.5s ease-out forwards;
        transform: translate(var(--dx), var(--dy));
      `;
      this._trackEl.style.position = 'relative';
      this._trackEl.appendChild(particle);
      particle.addEventListener('animationend', () => particle.remove());
    }
  }
}

/**
 * 从 wordTiming 自动生成简易音素数据（当配置中无 phonemes 字段时）
 * 每个 word 生成 1 个音素球
 * @param {import('./story-config-loader.js').SubtitleTrack} track
 * @returns {Phoneme[]}
 */
export function generatePhonemesFromWords(track) {
  const words = track.wordTiming && track.wordTiming.length > 0
    ? track.wordTiming
    : track.targetText.split(/\s+/).map((text, i) => ({
        text,
        startMs: track.startMs + i * 500,
        endMs: track.startMs + (i + 1) * 500,
      }));

  return words.map((w, i) => {
    // 简单启发式：以元音字母开头的视为元音球
    const firstChar = w.text.charAt(0).toLowerCase();
    const isVowel = 'aeiou'.includes(firstChar);
    return {
      ipa: w.text.substring(0, 3),
      type: isVowel ? 'vowel' : 'consonant',
      durationMs: w.endMs - w.startMs,
      wordIndex: i,
      pitch: 'flat',
      goldChant: false,
    };
  });
}
