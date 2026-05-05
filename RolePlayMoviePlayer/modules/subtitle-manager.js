// =================== 影视配音秀 — 字幕管理器 ===================

import { SUBTITLE_CONFIG } from '../config.js';

/**
 * 基于 YAML SubtitleTrack 的字幕渲染管理器
 * 支持双语显示（母语参考 + 目标配音文本）和逐词卡拉OK高亮
 */

export class SubtitleManager {
  /**
   * @param {HTMLElement} container - 字幕文本容器
   */
  constructor(container) {
    this._container = container;
    this._ipaEl = document.getElementById('subIpa');
    this._previewEl = document.getElementById('subPreview');
    /** @type {import('./story-config-loader.js').SubtitleTrack[]} */
    this._tracks = [];
    /** @type {import('./story-config-loader.js').SubtitleTrack|null} */
    this._currentTrack = null;
    this._prevMatched = null;
    this._currentDetails = null;
    this._currentCombo = 0;
    this._maxCombo = 0;
    this._weakWordIndexes = [];
    this._weakMode = null;
  }

  /**
   * 设置字幕轨列表
   * @param {import('./story-config-loader.js').SubtitleTrack[]} tracks
   */
  setTracks(tracks) {
    this._tracks = tracks;
  }

  /**
   * 获取所有配音轨
   * @returns {import('./story-config-loader.js').SubtitleTrack[]}
   */
  getAllTracks() {
    return this._tracks;
  }

  /**
   * 获取当前时间对应的字幕轨（含提前预览）
   * @param {number} timeMs - 视频当前时间（毫秒）
   * @returns {import('./story-config-loader.js').SubtitleTrack|null}
   */
  getTrackAtTime(timeMs) {
    const aheadMs = SUBTITLE_CONFIG.previewAheadSeconds * 1000;
    for (const track of this._tracks) {
      if (timeMs >= track.startMs - aheadMs && timeMs <= track.endMs) {
        return track;
      }
    }
    return null;
  }

  /**
   * 获取指定时间正在进行的配音轨（不含提前预览）
   * @param {number} timeMs
   * @returns {import('./story-config-loader.js').SubtitleTrack|null}
   */
  getActiveTrackAtTime(timeMs) {
    for (const track of this._tracks) {
      if (timeMs >= track.startMs && timeMs <= track.endMs) {
        return track;
      }
    }
    return null;
  }

  /**
   * 渲染双语字幕（预览状态，全文dim显示）
   * @param {import('./story-config-loader.js').SubtitleTrack} track
   */
  renderNormal(track) {
    if (!track) {
      this._container.innerHTML = '';
      if (this._ipaEl) this._ipaEl.textContent = '';
      this._currentTrack = null;
      this._currentDetails = null;
      return;
    }
    if (this._currentTrack !== track) {
      console.log(`[Subtitle] renderNormal: native="${track.nativeText}" target="${track.targetText}"`);
    }
    this._currentTrack = track;
    const nativeLine = this._renderNativeLine(track);
    this._container.innerHTML = `
      ${nativeLine}
      <div class="rps-sub-target" style="color:${track.targetColor}">${track.targetText}</div>
    `;
  }

  /**
   * 渲染母语字幕行。若有 nativeSegments，则按 segment 状态渲染。
   * @param {import('./story-config-loader.js').SubtitleTrack} track
   * @param {{matched:boolean,score:number,skipped:boolean}[]|null} details
   * @param {number} firstUnmatched
   * @returns {string}
   */
  _renderNativeLine(track, details = null, firstUnmatched = -1) {
    return `<div class="rps-sub-native" style="color:${track.nativeColor}">${track.nativeText}</div>`;
  }

  /**
   * 计算母语语义片段状态
   * @param {{targetWordIndexes?: number[]}} segment
   * @param {{matched:boolean,score:number,skipped:boolean}[]|null} details
   * @param {number} firstUnmatched
   * @returns {'dim'|'active'|'done'}
   */
  _getNativeSegmentState(segment, details, firstUnmatched) {
    const indexes = Array.isArray(segment.targetWordIndexes) ? segment.targetWordIndexes : [];
    if (!details || details.length === 0 || indexes.length === 0) return 'dim';
    if (this._weakMode && indexes.some(idx => this._weakWordIndexes.includes(idx))) {
      return this._weakMode === 'pass' ? 'weak-pass' : 'weak-fail';
    }
    if (firstUnmatched >= 0 && indexes.includes(firstUnmatched)) return 'active';

    const mappedDetails = indexes.map(idx => details[idx]).filter(Boolean);
    if (mappedDetails.length > 0 && mappedDetails.every(d => d.matched || d.skipped)) {
      return 'done';
    }
    return 'dim';
  }

  /**
   * 渲染卡拉OK式配音字幕（逐词高亮，10档DDR风格）
   * @param {import('./story-config-loader.js').SubtitleTrack} track
   * @param {boolean[]|number|{matched:boolean,score:number,skipped:boolean}[]} matchedInfo
   */
  renderKaraoke(track, matchedInfo = 0) {
    if (!track) {
      this._container.innerHTML = '';
      this._prevMatched = null;
      this._currentDetails = null;
      return;
    }
    const trackChanged = this._currentTrack !== track;
    if (trackChanged) {
      this._prevMatched = null;
      this._currentCombo = 0;
      this._maxCombo = 0;
      this.clearSentenceOutcome();
    }
    this._currentTrack = track;

    const words = track.wordTiming && track.wordTiming.length > 0
      ? track.wordTiming.map(w => w.text)
      : track.targetText.split(/\s+/);

    let details;
    if (Array.isArray(matchedInfo) && matchedInfo.length > 0 && typeof matchedInfo[0] === 'object') {
      details = matchedInfo;
    } else {
      const flags = Array.isArray(matchedInfo)
        ? matchedInfo
        : words.map((_, i) => i < matchedInfo);
      details = flags.map(f => ({ matched: f, score: f ? 1.0 : 0, skipped: false }));
    }

    const firstUnmatched = details.findIndex(d => !d.matched && !d.skipped);
    const prevMatched = this._prevMatched || words.map(() => false);
    const nativeLine = this._renderNativeLine(track, details, firstUnmatched);
    const popupQueue = [];
    const hadProgress = details.some(d => d.matched || d.skipped);
    const prevCombo = this._currentCombo;

    // Build HTML — all words keep fixed spacing (no position shifts)
    let html = '';
    let prevIsStone = false;
    let prevRightEdge = null;
    let prevTier = -1;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const d = details[i] || { matched: false, score: 0, skipped: false };
      const isStone = d.matched || d.skipped;

      if (i > 0) html += ' ';

      if (isStone) {
        const tier = _scoreToTier(d.score, d.skipped);
        const { style, rightEdge } = _buildStoneStyle(i, !prevIsStone, prevRightEdge, prevTier);
        // Already petrified words: skip animation + sound
        const noAnim = prevMatched[i] ? 'animation:none;--stone-reveal:110%;' : '';
        html += `<span class="rps-word rps-word--t${tier}" data-word-idx="${i}" data-tier="${tier}" style="${style}${noAnim}">${word}</span>`;
        if (!prevMatched[i]) {
          this._spawnJudgment(tier, i, words.length);
          popupQueue.push({ wordIdx: i, tier, points: _tierToPoints(tier), skipped: d.skipped });
        }
        prevIsStone = true;
        prevRightEdge = rightEdge;
        prevTier = tier;
      } else {
        const cls = (i === firstUnmatched) ? 'rps-word rps-word--active' : 'rps-word rps-word--dim';
        html += `<span class="${cls}">${word}</span>`;
        prevIsStone = false;
        prevRightEdge = null;
        prevTier = -1;
      }
    }

    const comboStats = hadProgress ? _computeComboStats(details) : { current: 0, max: 0 };
    this._currentCombo = comboStats.current;
    this._maxCombo = hadProgress ? Math.max(this._maxCombo, comboStats.max) : 0;
    this._currentDetails = details;
    this._prevMatched = details.map(d => d.matched || d.skipped);

    const targetLine = `<div class="rps-sub-target-karaoke">${html}</div>`;
    this._container.innerHTML = nativeLine + targetLine;

    if (popupQueue.length > 0) {
      const anchored = popupQueue
        .map(item => ({
          ...item,
          element: this._container.querySelector(`.rps-word[data-word-idx="${item.wordIdx}"]`),
        }))
        .filter(item => item.element);

      anchored.forEach(item => {
        this._spawnWordScorePopup(item.element, item.points, item.tier, item.skipped);
      });

      let comboAnchor = null;
      for (let i = anchored.length - 1; i >= 0; i--) {
        if (!anchored[i].skipped) {
          comboAnchor = anchored[i];
          break;
        }
      }
      if (comboAnchor && this._currentCombo >= 2 && this._currentCombo > prevCombo) {
        this._spawnComboPopup(comboAnchor.element, this._currentCombo, comboAnchor.tier);
      }
    }
  }

  /**
   * 生成本句诊断摘要
   * @param {import('./story-config-loader.js').SubtitleTrack} [track]
   */
  getSentenceSummary(track = this._currentTrack) {
    if (!track) {
      return { score: 0, maxScore: 0, maxCombo: 0, weakItems: [], weakWordIndexes: [] };
    }

    const words = track.wordTiming && track.wordTiming.length > 0
      ? track.wordTiming.map(w => w.text)
      : track.targetText.split(/\s+/);
    const details = this._currentDetails || words.map(() => ({ matched: false, score: 0, skipped: false }));
    const comboStats = _computeComboStats(details);
    const weakItems = _selectWeakItems(track, words, details).slice(0, 3);

    return {
      score: _sentenceScore,
      maxScore: words.length * 100,
      maxCombo: Math.max(this._maxCombo, comboStats.max),
      weakItems,
      weakWordIndexes: weakItems.map(item => item.wordIdx),
    };
  }

  /**
   * 在句尾显示弱项态。
   * @param {{weakWordIndexes?: number[]}} summary
   * @param {'pass'|'fail'} mode
   */
  showWeakState(summary, mode) {
    this._weakWordIndexes = Array.isArray(summary?.weakWordIndexes) ? summary.weakWordIndexes : [];
    this._weakMode = mode;
    if (this._currentTrack && this._currentDetails) {
      this.renderKaraoke(this._currentTrack, this._currentDetails);
    }
  }

  clearSentenceOutcome() {
    this._weakWordIndexes = [];
    this._weakMode = null;
  }

  _spawnWordScorePopup(anchorEl, points, tier, skipped) {
    const layer = document.getElementById('wordScoreLayer');
    if (!layer || !anchorEl) return;

    const layerRect = layer.getBoundingClientRect();
    const rect = anchorEl.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = `rps-word-score-popup rps-word-score-popup--t${tier}`;
    popup.textContent = skipped ? 'MISS' : `+${points}`;
    popup.style.left = `${rect.left - layerRect.left + rect.width / 2}px`;
    popup.style.top = `${rect.top - layerRect.top - 10}px`;
    layer.appendChild(popup);
    popup.addEventListener('animationend', () => popup.remove());
  }

  _spawnComboPopup(anchorEl, combo, tier) {
    const layer = document.getElementById('wordScoreLayer');
    if (!layer || !anchorEl || combo < 2) return;

    const layerRect = layer.getBoundingClientRect();
    const rect = anchorEl.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = `rps-combo-popup rps-combo-popup--t${tier}`;
    popup.textContent = `COMBO x${combo}`;
    popup.style.left = `${rect.left - layerRect.left + rect.width / 2}px`;
    popup.style.top = `${rect.top - layerRect.top - 46}px`;
    layer.appendChild(popup);
    popup.addEventListener('animationend', () => popup.remove());
  }

  /** Spawn a judgment popup (right side) with score, accumulate sentence score */
  _spawnJudgment(tier, wordIdx, totalWords) {
    const layer = document.getElementById('judgmentLayer');
    if (!layer) return;
    const label = _TIER_LABELS[tier] || 'MISS';
    const pts = _tierToPoints(tier);
    const el = document.createElement('div');
    el.className = `rps-judgment-popup rps-judge-t${tier}`;
    el.innerHTML = `${label}<span class="rps-judge-score">+${pts}</span>`;
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    // Accumulate sentence score (not total yet)
    _sentenceScore += pts;
    _sentenceMaxScore = Math.max(_sentenceMaxScore, totalWords * 100);
    // Update sentence score display below HUD
    const ssEl = document.getElementById('sentenceScore');
    if (ssEl) {
      ssEl.textContent = `${_sentenceScore} / ${_sentenceMaxScore}`;
      ssEl.classList.add('rps-sentence-show');
    }
    // Petrify sound — tier-dependent
    _playPetrifySound(tier);
  }

  /**
   * 根据视频当前时间ms和 wordTiming 计算应高亮到第几个词
   * @param {import('./story-config-loader.js').SubtitleTrack} track
   * @param {number} timeMs
   * @returns {number}
   */
  getWordIndexAtTime(track, timeMs) {
    if (!track.wordTiming || track.wordTiming.length === 0) return 0;
    let idx = 0;
    for (const wt of track.wordTiming) {
      if (timeMs >= wt.startMs) idx++;
    }
    return idx;
  }

  /**
   * 更新释义 / IPA / 预览层内容
   * @param {import('./story-config-loader.js').SubtitleTrack} track
   * @param {import('./story-config-loader.js').SubtitleTrack|null} nextTrack
   */
  updateAuxLayers(track, nextTrack = null) {
    if (this._ipaEl) this._ipaEl.textContent = track?.ipa || '';
    if (this._previewEl) this._previewEl.textContent = nextTrack?.targetText || '';
  }

  /**
   * QQ 音乐式顶入动画：当前句滚出，下一句滚入
   * @param {import('./story-config-loader.js').SubtitleTrack} nextTrack
   * @param {import('./story-config-loader.js').SubtitleTrack|null} nextNextTrack
   * @returns {Promise<void>}
   */
  scrollInNextSentence(nextTrack, nextNextTrack = null) {
    const area = this._container.closest('.rps-subtitle-area');
    if (!area) {
      this.renderKaraoke(nextTrack, 0);
      this.updateAuxLayers(nextTrack, nextNextTrack);
      return Promise.resolve();
    }

    // 淡出旧内容
    area.style.opacity = '0';

    return new Promise(resolve => {
      setTimeout(() => {
        // 替换为新内容
        this.renderKaraoke(nextTrack, 0);
        this.updateAuxLayers(nextTrack, nextNextTrack);

        // 淡入新内容
        area.style.opacity = '';
        resolve();
      }, 300);
    });
  }

  /**
   * 隐藏字幕
   */
  hide() {
    this._container.innerHTML = '';
    if (this._ipaEl) this._ipaEl.textContent = '';
    if (this._previewEl) this._previewEl.textContent = '';
    this._currentTrack = null;
    this._prevMatched = null;
    this._currentDetails = null;
    this._currentCombo = 0;
    this._maxCombo = 0;
    this.clearSentenceOutcome();
  }
}

// =================== 10档DDR评分 ===================

const _TIER_LABELS = ['MISS', 'So So', 'Hmm', 'OK', 'Nice', 'Good', 'Great', 'Cool', 'Excellent', 'Amazing', 'PERFECT'];

const _NATIVE_TIER_TONES = [
  'rgba(107,50,34,0.34)',
  'rgba(122,58,32,0.36)',
  'rgba(138,68,40,0.38)',
  'rgba(122,86,64,0.38)',
  'rgba(106,96,88,0.40)',
  'rgba(94,94,94,0.42)',
  'rgba(58,58,64,0.46)',
  'rgba(184,134,46,0.44)',
  'rgba(192,192,204,0.48)',
  'rgba(218,165,32,0.50)',
  'rgba(255,215,0,0.52)',
];

/** Cumulative score across the session */
let _totalScore = 0;
/** Current sentence accumulated score */
let _sentenceScore = 0;
/** Current sentence maximum possible score */
let _sentenceMaxScore = 0;

/** Convert tier 0-10 to 0-100 point value */
function _tierToPoints(tier) {
  return tier * 10; // t0=0, t1=10, ... t10=100
}

function _hexToRgba(hex, alpha) {
  const fallback = `rgba(47,128,237,${alpha})`;
  if (typeof hex !== 'string') return fallback;
  let normalized = hex.trim().replace('#', '');
  if (normalized.length === 3) {
    normalized = normalized.split('').map(ch => ch + ch).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return fallback;

  const value = parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function _getNativeSegmentTone(baseColor, details, indexes) {
  if (!Array.isArray(indexes) || indexes.length === 0 || !Array.isArray(details) || details.length === 0) {
    return _hexToRgba(baseColor, 0.18);
  }

  let hasTier = false;
  let tier = 0;
  for (const idx of indexes) {
    const detail = details[idx];
    if (!detail || (!detail.matched && !detail.skipped)) continue;
    tier = Math.max(tier, _scoreToTier(detail.score, detail.skipped));
    hasTier = true;
  }

  return hasTier ? _NATIVE_TIER_TONES[tier] : _hexToRgba(baseColor, 0.18);
}

function _computeComboStats(details) {
  let current = 0;
  let max = 0;
  for (const detail of details) {
    if (detail?.matched && !detail?.skipped) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return { current, max };
}

const _LOW_VALUE_WORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'but', 'is', 'are', 'am',
  'was', 'were', 'be', 'been', 'being', 'do', 'did', 'does', 'have', 'has', 'had', 'my', 'your',
  'our', 'their', 'his', 'her', 'its', 'we', 'you', 'he', 'she', 'it', 'they', 'i',
]);

function _isWeakCandidate(word) {
  const clean = cleanText(word);
  if (!clean) return false;
  if (_LOW_VALUE_WORDS.has(clean)) return false;
  if (clean.length <= 1) return false;
  if (/[A-Z].*[A-Z]/.test(word.slice(1))) return false;
  return true;
}

function _selectWeakItems(track, words, details) {
  const candidates = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const detail = details[i] || { matched: false, score: 0, skipped: false };
    if (!_isWeakCandidate(word)) continue;

    let severity = 0;
    let status = '';
    if (detail.skipped) {
      severity = 3;
      status = 'skipped';
    } else if (!detail.matched) {
      severity = 2.4;
      status = 'missed';
    } else if (detail.score < 0.85) {
      severity = 1.6 - detail.score;
      status = 'low-score';
    }
    if (severity <= 0) continue;

    const nativeTexts = (track.nativeSegments || [])
      .filter(segment => Array.isArray(segment.targetWordIndexes) && segment.targetWordIndexes.includes(i))
      .map(segment => segment.text)
      .filter(Boolean);

    candidates.push({
      wordIdx: i,
      word,
      nativeText: nativeTexts.join(' / '),
      status,
      score: detail.score,
      severity,
    });
  }

  return candidates.sort((a, b) => b.severity - a.severity || a.wordIdx - b.wordIdx);
}

/**
 * Play a metallic forge sound effect using Web Audio API.
 * Low tiers: dull thud + hiss (cooling rust).
 * High tiers: bright metallic ring + crisp impact.
 */
function _playPetrifySound(tier) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const ratio = tier / 10; // 0.0 - 1.0

    // --- Impact noise burst (hammer on metal) ---
    const impactDur = 0.06 + ratio * 0.04; // 0.06s - 0.10s
    const bufSize = Math.floor(ctx.sampleRate * impactDur);
    const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;

    // Highpass: low tier = muffled, high tier = crisp
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 200 + ratio * 2000; // 200Hz - 2200Hz

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.08 + ratio * 0.10, t); // 0.08 - 0.18
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + impactDur);

    noiseSrc.connect(hpf);
    hpf.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSrc.start(t);
    noiseSrc.stop(t + impactDur);

    // --- Metallic ring (sinusoidal resonance) ---
    const ringDur = 0.15 + ratio * 0.35; // 0.15s - 0.50s
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    // Low tier: low dull tone; high tier: bright ring
    const freq = 300 + ratio * 2500; // 300Hz - 2800Hz
    osc.type = ratio > 0.5 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.92, t + ringDur); // slight pitch drop = metal cooling
    const ringVol = 0.03 + ratio * 0.12; // 0.03 - 0.15
    oscGain.gain.setValueAtTime(ringVol, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + ringDur);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ringDur);

    // --- Second harmonic overtone for high tiers (shimmery) ---
    if (tier >= 7) {
      const osc2 = ctx.createOscillator();
      const osc2Gain = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2.5, t); // harmonic
      osc2.frequency.exponentialRampToValueAtTime(freq * 2.3, t + ringDur * 0.6);
      const ov = 0.02 + (ratio - 0.7) * 0.08; // 0.02 - 0.05
      osc2Gain.gain.setValueAtTime(ov, t);
      osc2Gain.gain.exponentialRampToValueAtTime(0.001, t + ringDur * 0.6);
      osc2.connect(osc2Gain);
      osc2Gain.connect(ctx.destination);
      osc2.start(t);
      osc2.stop(t + ringDur * 0.6);
    }

    setTimeout(() => ctx.close(), 600);
  } catch (e) {
    // Silently ignore if audio not available
  }
}

/** Reset sentence score only (call on retry) */
export function resetSentenceScore() {
  _sentenceScore = 0;
  _sentenceMaxScore = 0;
  const ssEl = document.getElementById('sentenceScore');
  if (ssEl) { ssEl.textContent = ''; ssEl.classList.remove('rps-sentence-show'); }
}

/** Reset score (call on new story/level) */
export function resetScore() {
  _totalScore = 0;
  _sentenceScore = 0;
  _sentenceMaxScore = 0;
  const hudVal = document.getElementById('scoreHudValue');
  if (hudVal) hudVal.textContent = '0';
  const ssEl = document.getElementById('sentenceScore');
  if (ssEl) { ssEl.textContent = ''; ssEl.classList.remove('rps-sentence-show'); }
}

/**
 * Commit current sentence score into cumulative total with fly-in animation.
 * Call this when a sentence passes.
 * @returns {Promise<void>}
 */
export function commitSentenceScore() {
  return new Promise(resolve => {
    const earned = _sentenceScore;
    if (earned <= 0) {
      // Nothing to commit — just reset sentence
      _sentenceScore = 0;
      _sentenceMaxScore = 0;
      const ssEl = document.getElementById('sentenceScore');
      if (ssEl) { ssEl.textContent = ''; ssEl.classList.remove('rps-sentence-show'); }
      resolve();
      return;
    }

    const ssEl = document.getElementById('sentenceScore');
    const hudVal = document.getElementById('scoreHudValue');
    if (!ssEl || !hudVal) {
      // Fallback: just add directly
      _totalScore += earned;
      _sentenceScore = 0;
      _sentenceMaxScore = 0;
      if (hudVal) hudVal.textContent = _totalScore;
      resolve();
      return;
    }

    // Create flying score element
    const fly = document.createElement('div');
    fly.className = 'rps-score-fly rps-fly-start';
    fly.textContent = `+${earned}`;
    document.body.appendChild(fly);

    // Position it at the sentence score location
    const ssRect = ssEl.getBoundingClientRect();
    fly.style.left = `${ssRect.right - fly.offsetWidth}px`;
    fly.style.top = `${ssRect.top}px`;

    // Hide the sentence score text
    ssEl.classList.remove('rps-sentence-show');

    // Animate to HUD value position
    const hudRect = hudVal.getBoundingClientRect();
    requestAnimationFrame(() => {
      fly.classList.remove('rps-fly-start');
      fly.style.left = `${hudRect.right - fly.offsetWidth}px`;
      fly.style.top = `${hudRect.top}px`;
      fly.classList.add('rps-fly-end');
    });

    // After animation: update HUD total
    setTimeout(() => {
      _totalScore += earned;
      hudVal.textContent = _totalScore;
      hudVal.classList.add('rps-score-bump');
      setTimeout(() => hudVal.classList.remove('rps-score-bump'), 180);
      fly.remove();
      // Reset sentence state
      _sentenceScore = 0;
      _sentenceMaxScore = 0;
      ssEl.textContent = '';
      resolve();
    }, 650);
  });
}

// =================== 石化效果生成器 ===================

/** Deterministic pseudo-random (sin-hash, stable across re-renders) */
function _stoneRand(seed) {
  let x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Shorthand: random in range [lo, hi] seeded by base+offset */
function _sr(base, offset, lo, hi) {
  return lo + _stoneRand(base * 7 + offset) * (hi - lo);
}

// ---- Tier mid-tone colours for joint gradient blending (metal) ----
const _TIER_MID = [
  'rgba(74,32,16,',   'rgba(90,40,20,',   'rgba(100,50,28,',
  'rgba(90,62,44,',   'rgba(80,72,64,',   'rgba(68,68,68,',
  'rgba(42,42,48,',   'rgba(138,100,34,', 'rgba(136,136,148,',
  'rgba(164,120,24,', 'rgba(186,152,20,',
];

/**
 * Generate N+1 edge points with pseudo-random offsets.
 * @param {number} patternId  seed for the pattern (0-49 or 0-19)
 * @param {number} n          number of segments (points = n+1)
 * @param {number} maxOffset  max deviation in px
 * @returns {{t:number, offset:number}[]}
 */
function _genEdge(patternId, n, maxOffset, bipolar) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = _stoneRand(patternId * 97 + i * 13 + 0.5);
    // bipolar: offset ranges -maxOffset to +maxOffset; else 0 to maxOffset
    const offset = bipolar ? (r * 2 - 1) * maxOffset : r * maxOffset;
    pts.push({ t, offset });
  }
  return pts;
}

/** Invert a right-edge to get the complementary left-edge for interlocking */
function _complementEdge(rightEdge, totalOffset) {
  return rightEdge.map(p => ({ t: p.t, offset: totalOffset - p.offset }));
}

/**
 * Build full stone inline style for one word.
 * @param {number} idx         word index
 * @param {boolean} isFirst    true if this is the first stone in a consecutive run
 * @param {Array|null} prevRE  previous word's right edge points
 * @param {number} prevTier    previous stone's tier (for colour blending)
 * @returns {{ style: string, rightEdge: Array }}
 */
function _buildStoneStyle(idx, isFirst, prevRE, prevTier) {
  const INTERLOCK = 7;  // px — interlock zone width
  const EDGE_V = 2;     // px — top/bottom edge variation (-2 to +2)

  // ---- Edge profiles (50 top/bottom variants × 50 interlock variants) ----
  const topId    = (idx * 3 + 7)  % 50;
  const bottomId = (idx * 5 + 13) % 50;
  const rightId  = (idx * 7 + 3)  % 50;

  const topEdge    = _genEdge(topId,    10, EDGE_V, true);
  const bottomEdge = _genEdge(bottomId, 10, EDGE_V, true);
  const rightEdge  = _genEdge(rightId,   8, INTERLOCK);
  const leftEdge   = isFirst
    ? _genEdge((idx * 11 + 17) % 50, 8, INTERLOCK)
    : (prevRE ? _complementEdge(prevRE, INTERLOCK) : _genEdge((idx * 11 + 17) % 50, 8, INTERLOCK));

  // ---- Build polygon (clockwise) ----
  const pts = [];
  // Top: left → right
  for (const p of topEdge) {
    pts.push(`${(p.t * 100).toFixed(1)}% ${p.offset.toFixed(1)}px`);
  }
  // Right: top → bottom (skip first to avoid corner dup)
  for (let j = 1; j < rightEdge.length; j++) {
    const p = rightEdge[j];
    pts.push(`calc(100% - ${p.offset.toFixed(1)}px) ${(p.t * 100).toFixed(1)}%`);
  }
  // Bottom: right → left (reversed, skip first)
  for (let j = bottomEdge.length - 2; j >= 0; j--) {
    const p = bottomEdge[j];
    pts.push(`${(p.t * 100).toFixed(1)}% calc(100% - ${p.offset.toFixed(1)}px)`);
  }
  // Left: bottom → top (reversed, skip first)
  for (let j = leftEdge.length - 2; j >= 0; j--) {
    const p = leftEdge[j];
    pts.push(`${p.offset.toFixed(1)}px ${(p.t * 100).toFixed(1)}%`);
  }
  const polygon = `polygon(${pts.join(',')})`;

  // ---- Metal texture: rust spots (low tier) / scratches (high tier) ----
  const texPatternId = (idx * 13 + 5) % 50;
  const ratio = prevTier >= 0 ? prevTier / 10 : 0.5;
  const crackLayers = [];

  // Rust spots (more for low tiers, fewer/lighter for high tiers)
  const numRustSpots = Math.max(0, 3 - Math.floor(ratio * 3)); // 3→0
  for (let r = 0; r < numRustSpots; r++) {
    const cx = Math.round(_sr(texPatternId, 50 + r * 3, 10, 90));
    const cy = Math.round(_sr(texPatternId, 51 + r * 3, 10, 90));
    const size = Math.round(_sr(texPatternId, 52 + r * 3, 15, 40));
    crackLayers.push(
      `radial-gradient(ellipse ${size}% ${Math.round(size * 0.7)}% at ${cx}% ${cy}%, rgba(120,60,20,0.35) 0%, transparent 100%)`
    );
  }

  // Scratches (more for high tiers — polished metal has visible fine scratches)
  const numScratches = 1 + Math.floor(_sr(texPatternId, 0, 0, 3));
  for (let c = 0; c < numScratches; c++) {
    const angle = Math.round(_sr(texPatternId, 10 + c * 4, 10, 170));
    const pos   = Math.round(_sr(texPatternId, 11 + c * 4, 15, 85));
    const thick = _sr(texPatternId, 12 + c * 4, 0.5, 1.5).toFixed(1);
    // Low tier: dark scratches; high tier: bright reflective scratches
    const scratchColor = ratio > 0.6
      ? `rgba(255,255,255,${(0.04 + ratio * 0.06).toFixed(2)})`
      : `rgba(0,0,0,${(0.08 + (1 - ratio) * 0.10).toFixed(2)})`;
    crackLayers.push(
      `linear-gradient(${angle}deg,transparent calc(${pos}% - ${thick}px),${scratchColor} ${pos}%,transparent calc(${pos}% + ${thick}px))`
    );
  }

  // Joint colour blend at left edge
  if (!isFirst && prevTier >= 0 && prevTier <= 10) {
    crackLayers.unshift(
      `linear-gradient(to right,${_TIER_MID[prevTier]}0.35) 0%,transparent 22%)`
    );
  }

  // ---- Highlight position ----
  const hlX = Math.round(_sr(idx, 80, 15, 65));
  const hlY = Math.round(_sr(idx, 81, 10, 40));

  // ---- Assemble inline style ----
  let s = `clip-path:${polygon};`;
  s += `--stone-cracks:${crackLayers.join(',')};`;
  s += `--stone-hl-x:${hlX}%;--stone-hl-y:${hlY}%;`;

  return { style: s, rightEdge };
}

function _scoreToTier(score, skipped) {
  if (skipped) return 0;
  if (score >= 1.0) return 10;
  if (score >= 0.85) return 9;
  if (score >= 0.7) return 8;
  if (score >= 0.6) return 7;
  if (score >= 0.5) return 6;
  if (score >= 0.4) return 5;
  if (score >= 0.3) return 4;
  if (score >= 0.2) return 3;
  if (score >= 0.1) return 2;
  if (score > 0) return 1;
  return 0;
}

/** 导出 scoreToTier 供 gameplay.js 使用 */
export { _scoreToTier as scoreToTier };

// =================== 文本匹配辅助 ===================

/**
 * 清理文本：小写化，移除标点，trim
 * @param {string} s
 * @returns {string}
 */
function cleanText(s) {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s]/g, '').trim();
}

/**
 * 计算两个字符串的编辑距离（Levenshtein）
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // 单行 DP
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * 模糊判断两个单词是否匹配
 * - 完全相等 → true
 * - 一方是另一方的前缀（至少3字符）→ true
 * - 编辑距离 / max(len) <= 阈值 → true
 * @param {string} target - 目标单词（已清理）
 * @param {string} spoken - ASR 单词（已清理）
 * @param {number} [threshold=0.35] - 允许的归一化编辑距离
 * @returns {boolean}
 */
function fuzzyWordMatch(target, spoken, threshold = 0.35) {
  if (target === spoken) return true;
  if (!target || !spoken) return false;
  // 前缀匹配（ASR 可能截断长单词）
  const minPrefixLen = 3;
  if (target.length >= minPrefixLen && spoken.length >= minPrefixLen) {
    if (target.startsWith(spoken) || spoken.startsWith(target)) return true;
  }
  // 归一化编辑距离
  const maxLen = Math.max(target.length, spoken.length);
  if (maxLen === 0) return false;
  const dist = editDistance(target, spoken);
  return (dist / maxLen) <= threshold;
}

/**
 * 计算单词匹配质量分数（0.0–1.0）
 * - 1.0 = 完全匹配
 * - 0.7–0.99 = 接近（编辑距离 ≤ 1 或前缀匹配）
 * - 0.4–0.69 = 模糊通过
 * - 0 = 不匹配
 * @param {string} target
 * @param {string} spoken
 * @returns {number}
 */
function fuzzyWordScore(target, spoken) {
  if (!target || !spoken) return 0;
  if (target === spoken) return 1.0;
  const maxLen = Math.max(target.length, spoken.length);
  if (maxLen === 0) return 0;
  const dist = editDistance(target, spoken);
  const normDist = dist / maxLen;
  // 前缀匹配
  const minPrefixLen = 3;
  if (target.length >= minPrefixLen && spoken.length >= minPrefixLen) {
    if (target.startsWith(spoken) || spoken.startsWith(target)) {
      return Math.max(0.75, 1.0 - normDist);
    }
  }
  if (normDist <= 0.35) {
    return Math.max(0.4, 1.0 - normDist);
  }
  return 0;
}

/**
 * 计算用户 ASR 文本与目标文本的模糊匹配单词数（按顺序，允许拼写偏差）
 * @param {string} target - 目标文本
 * @param {string} spoken - ASR 识别文本
 * @returns {number} 匹配单词数
 */
export function matchWords(target, spoken) {
  if (!target || !spoken) return 0;
  const targetWords = cleanText(target).split(/\s+/);
  const spokenWords = cleanText(spoken).split(/\s+/);

  let matched = 0;
  let si = 0;
  for (let ti = 0; ti < targetWords.length && si < spokenWords.length; ti++) {
    // 尝试当前 spoken 词及后续几个（允许 ASR 插入噪声词）
    const lookAhead = Math.min(si + 3, spokenWords.length);
    let found = false;
    for (let sj = si; sj < lookAhead; sj++) {
      if (fuzzyWordMatch(targetWords[ti], spokenWords[sj])) {
        matched++;
        si = sj + 1;
        found = true;
        break;
      }
    }
    if (!found) {
      // ASR 可能合并了两个词或完全跳过，继续下一个目标词
    }
  }
  return matched;
}

/**
 * 计算每个目标词是否被 ASR 文本模糊匹配（返回布尔数组）
 * @param {string} target - 目标文本
 * @param {string} spoken - ASR 识别文本
 * @returns {boolean[]} 每个目标词的匹配状态
 */
export function matchWordFlags(target, spoken) {
  if (!target) return [];
  const targetWords = cleanText(target).split(/\s+/);
  if (!spoken) return targetWords.map(() => false);
  const spokenWords = cleanText(spoken).split(/\s+/);

  const flags = targetWords.map(() => false);
  let si = 0;
  for (let ti = 0; ti < targetWords.length && si < spokenWords.length; ti++) {
    const lookAhead = Math.min(si + 3, spokenWords.length);
    for (let sj = si; sj < lookAhead; sj++) {
      if (fuzzyWordMatch(targetWords[ti], spokenWords[sj])) {
        flags[ti] = true;
        si = sj + 1;
        break;
      }
    }
  }
  return flags;
}

/**
 * 计算每个目标词的匹配质量详情
 * @param {string} target - 目标文本
 * @param {string} spoken - ASR 识别文本
 * @returns {{matched: boolean, score: number, spokenWord: string|null, skipped: boolean}[]}
 */
export function matchWordDetails(target, spoken) {
  if (!target) return [];
  const targetWords = cleanText(target).split(/\s+/);
  const details = targetWords.map(() => ({ matched: false, score: 0, spokenWord: null, skipped: false }));
  if (!spoken) return details;
  const spokenWords = cleanText(spoken).split(/\s+/);

  let si = 0;
  let lastMatchedTi = -1;
  for (let ti = 0; ti < targetWords.length && si < spokenWords.length; ti++) {
    const lookAhead = Math.min(si + 3, spokenWords.length);
    let bestScore = 0;
    let bestSj = -1;
    let bestSpoken = null;
    for (let sj = si; sj < lookAhead; sj++) {
      const score = fuzzyWordScore(targetWords[ti], spokenWords[sj]);
      if (score > bestScore) {
        bestScore = score;
        bestSj = sj;
        bestSpoken = spokenWords[sj];
      }
    }
    if (bestScore > 0) {
      // Mark any unmatched words between lastMatched and current as skipped
      for (let k = lastMatchedTi + 1; k < ti; k++) {
        if (!details[k].matched) {
          details[k].skipped = true;
        }
      }
      details[ti].matched = true;
      details[ti].score = bestScore;
      details[ti].spokenWord = bestSpoken;
      si = bestSj + 1;
      lastMatchedTi = ti;
    }
  }
  return details;
}

/**
 * 获取目标文本的总单词数
 * @param {import('./story-config-loader.js').SubtitleTrack} track
 * @returns {number}
 */
export function getWordCount(track) {
  if (track.wordTiming && track.wordTiming.length > 0) {
    return track.wordTiming.length;
  }
  return track.targetText.split(/\s+/).length;
}

/**
 * 计算用户语音与目标文本的逐词匹配率（0~1）
 * @param {string} target - 目标文本
 * @param {string} spoken - ASR 识别文本
 * @returns {number} 匹配率
 */
export function wordMatchRatio(target, spoken) {
  if (!target) return 0;
  const targetWords = cleanText(target).split(/\s+/);
  if (targetWords.length === 0) return 0;
  const matched = matchWords(target, spoken);
  return matched / targetWords.length;
}
