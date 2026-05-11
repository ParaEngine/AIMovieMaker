// =================== 影视配音秀 — 游戏主模块 ===================

// 单机版（standalone H5）：parent postMessage 通知改为空操作
const notifyGameDisplayReady = () => {};
const notifyGameStarted = () => {};
const notifyGameFinished = () => {};

import {
  GAME_DISPLAY_TITLE,
  GAME_SLUG,
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
  DEFAULT_CONFIG_PATH,
  DHF_CONFIG_PATH,
  DHF_FULL_ASPECT_RATIO,
  DHF_PORTRAIT_HEIGHT_RATIO,
  SLOWMO_CONFIG,
} from '../config.js';
import { loadStoryConfig } from './story-config-loader.js';
import { VideoController } from './video-controller.js';
import { SubtitleManager, matchWords, matchWordFlags, matchWordDetails, getWordCount, wordMatchRatio, commitSentenceScore, resetSentenceScore } from './subtitle-manager.js';
import { DubbingSession } from './dubbing-session.js';
import { Scoring } from './scoring.js';
import { buildIntroScreenHTML, buildResultScreenHTML, buildLoadingScreenHTML } from './flow.js';
import { PhonemeBallManager, generatePhonemesFromWords } from './phoneme-ball.js';
import { HudManager } from './hud-manager.js';
import { OverlayController } from './overlay-controller.js';
import { VocabSubtitle } from './vocab-subtitle.js';
import { VocabProgressBar } from './vocab-progress-bar.js';
import { RolePlayBottomPanel } from './role-play-bottom-panel.js';
import { RolePlaySceneTimeline } from './role-play-scene-timeline.js';

// =================== 辅助函数 ===================

function byId(id) {
  return document.getElementById(id);
}

// =================== 游戏状态 ===================

const Game = {
  state: 'loading', // 'loading' | 'intro' | 'playing' | 'dubbing' | 'retryPreview' | 'result'

  /** @type {import('./story-config-loader.js').StoryConfig} */
  storyConfig: null,
  /** @type {import('./story-config-loader.js').Scene} */
  currentScene: null,
  currentSceneIdx: 0,

  /** @type {VideoController} */
  videoCtrl: null,
  /** @type {SubtitleManager} */
  subtitleMgr: null,
  /** @type {DubbingSession} */
  dubbingSession: null,
  /** @type {Scoring} */
  scoring: null,
  /** @type {PhonemeBallManager} */
  phonemeBall: null,
  /** @type {HudManager} */
  hud: null,

  /** @type {OverlayController|null} */
  overlayCtrl: null,
  /** @type {VocabSubtitle|null} */
  vocabSubtitle: null,
  /** @type {VocabProgressBar|null} */
  vocabProgressBar: null,
  /** Whether we are in step2-overlay mode */
  isOverlayMode: false,

  /** Whether we are in role-play movie mode (subtitles list at bottom black area, no DDR scoring) */
  isRolePlayMovieMode: false,
  /** @type {RolePlayBottomPanel|null} */
  bottomPanel: null,
  /** @type {RolePlaySceneTimeline|null} */
  sceneTimeline: null,
  /** True while the user-turn DDR-style dubbing UI is active. */
  rolePlayInUserTurn: false,
  /** Bound video click handler (so we can remove it later if needed). */
  _videoClickHandler: null,

  /** @type {import('./story-config-loader.js').SubtitleTrack[]} */
  tracks: [],
  currentTrackIdx: 0,
  matchedWords: 0,
  retryCount: 0,

  // 配置 JSON 路径
  configPath: '',
};

// =================== Overlay 运行参数 ===================

function getOverlayRuntimeConfig() {
  const overlay = Game.storyConfig?.mode === 'step2-overlay'
    ? (Game.storyConfig.overlay || {})
    : {};

  const videoFrameYOffset = Number(overlay.videoFrameYOffset);
  const minGapMs = Number(overlay.minGapMs);
  const stagePreludeMs = Number(overlay.stagePreludeMs);
  const stageChimeMs = Number(overlay.stageChimeMs);

  return {
    videoFrameYOffset: Number.isFinite(videoFrameYOffset) ? videoFrameYOffset : 0.32,
    minGapMs: Number.isFinite(minGapMs) ? minGapMs : 450,
    stagePreludeMs: Number.isFinite(stagePreludeMs) ? stagePreludeMs : 500,
    stageChimeMs: Number.isFinite(stageChimeMs) ? stageChimeMs : 300,
  };
}

function applyOverlayRuntimeCss() {
  const cfg = getOverlayRuntimeConfig();
  document.documentElement.style.setProperty(
    '--overlay-video-object-position-y',
    `${Math.round(cfg.videoFrameYOffset * 100)}%`,
  );
  document.documentElement.style.setProperty('--overlay-safe-bottom', '84px');
}

function resetOverlayRuntimeCss() {
  document.documentElement.style.removeProperty('--overlay-video-object-position-y');
  document.documentElement.style.removeProperty('--overlay-safe-bottom');
}

// =================== 语音/视频互斥门 ===================

const VoiceGate = {
  _dhfSpeaking: false,
  _speechQueue: [],
  _pendingVideoPlay: null,
  _fallbackTimer: null,

  onDHFStart() {
    this._clearFallback();
    this._dhfSpeaking = true;
    if (Game.videoCtrl && !Game.videoCtrl.paused) {
      console.log('[VoiceGate] DHF 开始发声，暂停视频');
      Game.videoCtrl.pause();
    }
  },

  onDHFEnd() {
    this._clearFallback();
    this._dhfSpeaking = false;
    this._drain();
  },

  requestSpeak(text, options = {}) {
    const content = String(text || '').trim();
    if (!content) return;
    this._speechQueue.push({ text: content, options });
    this._drain();
  },

  requestVideoPlay(callback) {
    if (typeof callback !== 'function') return;
    this._pendingVideoPlay = callback;
    this._drain();
  },

  _drain() {
    if (this._dhfSpeaking) return;

    if (this._speechQueue.length > 0) {
      const next = this._speechQueue.shift();
      this._dhfSpeaking = true;
      if (Game.videoCtrl && !Game.videoCtrl.paused) {
        Game.videoCtrl.pause();
      }
      this._armFallback(next.text);
      Game.dubbingSession?.sendTTS(next.text, next.options);
      return;
    }

    if (this._pendingVideoPlay) {
      const callback = this._pendingVideoPlay;
      this._pendingVideoPlay = null;
      callback();
    }
  },

  _armFallback(text) {
    this._clearFallback();
    const estimatedMs = Math.max(1200, Math.min(4000, text.length * 180));
    this._fallbackTimer = setTimeout(() => {
      this._fallbackTimer = null;
      console.warn('[VoiceGate] 未收到 DHF 结束事件，使用兜底结束');
      this.onDHFEnd();
    }, estimatedMs);
  },

  _clearFallback() {
    if (this._fallbackTimer) {
      clearTimeout(this._fallbackTimer);
      this._fallbackTimer = null;
    }
  },

  reset() {
    this._clearFallback();
    this._dhfSpeaking = false;
    this._speechQueue = [];
    this._pendingVideoPlay = null;
  },
};

// =================== Overlay 阶段前奏 ===================

const OverlayPrelude = {
  _token: 0,
  _timer: null,

  run(stage, callback) {
    this.cancel();
    const token = ++this._token;
    const { stagePreludeMs } = getOverlayRuntimeConfig();
    if (Game.videoCtrl) {
      Game.videoCtrl.pause();
    }
    playStageChime(stage);
    this._timer = setTimeout(() => {
      if (token !== this._token) return;
      this._timer = null;
      callback();
    }, stagePreludeMs);
  },

  cancel() {
    this._token++;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  },

  reset() {
    this.cancel();
  },
};

// =================== 状态切换 ===================

function changeState(newState) {
  console.log(`[RPS] ${Game.state} → ${newState}`);
  Game.state = newState;
}

// =================== 显示/隐藏工具 ===================

function showElement(id) {
  const el = byId(id);
  if (el) el.classList.remove('hidden');
}

function hideElement(id) {
  const el = byId(id);
  if (el) el.classList.add('hidden');
}

/** 隐藏字幕区内容但保留占位空间（避免视频区跳动） */
function hideSubtitleContent() {
  const el = byId('subtitleArea');
  if (el) el.style.visibility = 'hidden';
}

/** 显示字幕区内容 */
function showSubtitleContent() {
  const el = byId('subtitleArea');
  if (el) el.style.visibility = '';
}

/** 字幕内容淡出（容器仍可见） */
function fadeOutSubtitleContent() {
  const el = byId('subtitleArea');
  if (el) el.classList.add('rps-content-faded');
}

/** 字幕内容淡入 */
function fadeInSubtitleContent() {
  const el = byId('subtitleArea');
  if (el) el.classList.remove('rps-content-faded');
}

function showToast(text, type = '', durationMs = 1500) {
  const toast = byId('statusToast');
  const toastText = byId('statusToastText');
  if (!toast || !toastText) return;

  toast.className = 'rps-status-toast';
  if (type) toast.classList.add(`rps-toast-${type}`);
  toastText.textContent = text;

  setTimeout(() => {
    toast.classList.add('hidden');
  }, durationMs);
}

function clearSentenceFeedbackOverlays() {
  const stampLayer = byId('stampLayer');
  const diagnosticLayer = byId('diagnosticLayer');
  if (stampLayer) stampLayer.innerHTML = '';
  if (diagnosticLayer) diagnosticLayer.innerHTML = '';
}

const SENTENCE_CARD_HOLD_MS = 2280;

function showSentenceStamp(type) {
  return new Promise(resolve => {
    const layer = byId('stampLayer');
    if (!layer) {
      resolve();
      return;
    }
    layer.innerHTML = '';
    const stamp = document.createElement('div');
    stamp.className = `rps-sentence-stamp rps-sentence-stamp--${type}`;
    stamp.textContent = type === 'pass' ? 'PASS' : 'FAIL';
    layer.appendChild(stamp);
    playSentenceStampSound(type);
    stamp.addEventListener('animationend', () => {
      stamp.remove();
      resolve();
    }, { once: true });
  });
}

function showDiagnosticCard(summary, type) {
  const layer = byId('diagnosticLayer');
  if (!layer) return;
  layer.innerHTML = '';

  const weakItems = Array.isArray(summary.weakItems) ? summary.weakItems.slice(0, 3) : [];
  const feedback = type === 'pass'
    ? (weakItems.length > 0 ? '通过了，下一句前再看一眼这些弱项。' : '通过了，保持这个节奏。')
    : (weakItems.length > 0 ? '这一句先盯住最弱的词再试一次。' : '这一句再来一次，保持完整读完。');
  const action = weakItems.length > 0
    ? weakItems.map(item => item.word).join(' / ')
    : '完整再读一遍本句';
  const weakList = weakItems.length > 0
    ? `<ul class="rps-diagnostic-weak-list">${weakItems.map(item => `<li class="rps-diagnostic-weak-item"><span class="en">${item.word}</span>${item.nativeText ? ` <span class="zh">→ ${item.nativeText}</span>` : ''}</li>`).join('')}</ul>`
    : '';

  const card = document.createElement('div');
  card.className = `rps-diagnostic-card rps-diagnostic-card--${type}`;
  card.innerHTML = `
    <div class="rps-diagnostic-title">SENTENCE REVIEW</div>
    <div class="rps-diagnostic-scoreline"><strong>${summary.score}</strong> / ${summary.maxScore}</div>
    <div class="rps-diagnostic-combo">Max Combo <strong>x${summary.maxCombo}</strong></div>
    ${weakList}
    <div class="rps-diagnostic-feedback">${feedback}</div>
    <div class="rps-diagnostic-action"><strong>建议：</strong>${action}</div>
  `;
  layer.appendChild(card);
}

/**
 * 播放阶段切换叮声（Web Audio API）
 * intro=C5(523Hz)  movie=E5(659Hz)  review=G5(784Hz)
 * @param {'intro'|'movie'|'review'} stage
 */
function playStageChime(stage) {
  try {
    const { stageChimeMs } = getOverlayRuntimeConfig();
    const durationSec = stageChimeMs / 1000;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const freq = stage === 'intro' ? 523    // C5
              : stage === 'movie' ? 659     // E5
              : 784;                         // G5
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.02, t + durationSec * 0.5);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + durationSec);

    setTimeout(() => ctx.close(), stageChimeMs + 200);
  } catch (_) {
    // 静默忽略音频不可用
  }
}

function playSentenceStampSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);

    if (type === 'pass') {
      const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1400;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.11, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      noise.connect(hp);
      hp.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(t);
      noise.stop(t + 0.08);

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(980, t);
      osc.frequency.exponentialRampToValueAtTime(730, t + 0.22);
      oscGain.gain.setValueAtTime(0.10, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(oscGain);
      oscGain.connect(master);
      osc.start(t);
      osc.stop(t + 0.22);
    } else {
      const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.4);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.16, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      noise.connect(lp);
      lp.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(t);
      noise.stop(t + 0.12);

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(95, t + 0.26);
      oscGain.gain.setValueAtTime(0.14, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.connect(oscGain);
      oscGain.connect(master);
      osc.start(t);
      osc.stop(t + 0.26);
    }

    setTimeout(() => ctx.close(), 800);
  } catch (e) {
    // Ignore audio failures silently
  }
}

// =================== DHF 容器模式切换 ===================

/** 切换 DHF 容器为右侧 1/3 面板模式 */
function setDHFPanel() {
  const c = byId('dhfContainer');
  if (!c) return;
  c.classList.remove('rps-dhf-avatar');
  c.classList.add('rps-dhf-panel');
  hideElement('micRow');
}

/** 切换 DHF 容器为右下角头像模式 */
function setDHFAvatar() {
  const c = byId('dhfContainer');
  if (!c) return;
  c.classList.remove('rps-dhf-panel');
  c.classList.add('rps-dhf-avatar');
}

/** 更新麦克风状态图标
 * @param {'recording'|'waiting'|'speaking'|'success'|false} state
 *   recording=录制中, waiting=等待用户开口, speaking=AI说话中, success=跟读成功, false=隐藏
 */
function updateMicBadge(state) {
  const row = byId('micRow');
  if (!row) return;

  // 兼容旧调用: true → 'waiting'
  if (state === true) state = 'waiting';

  // 清除所有状态 class
  row.classList.remove('rps-state-recording', 'rps-state-waiting', 'rps-state-speaking', 'rps-state-success');

  if (state === 'recording') {
    row.classList.remove('hidden');
    row.classList.add('rps-state-recording');
  } else if (state === 'waiting') {
    row.classList.remove('hidden');
    row.classList.add('rps-state-waiting');
  } else if (state === 'speaking') {
    row.classList.remove('hidden');
    row.classList.add('rps-state-speaking');
  } else if (state === 'success') {
    row.classList.remove('hidden');
    row.classList.add('rps-state-success');
    // Play success ding sound
    playSuccessDing();
  } else {
    row.classList.add('hidden');
  }
}

/** 播放成功叮铃音效 (Web Audio API) */
function playSuccessDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.08);
    osc.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => ctx.close();
  } catch (e) {
    // Silently ignore if audio not available
  }
}

/** 返回首页 — 停止语音通道，回到介绍页 */
async function returnToHome() {
  console.log('[RPS] 用户点击返回首页');
  Game.videoCtrl.pause();
  Game.videoCtrl.exitSlowMotion();
  OverlayPrelude.reset();
  Game.dubbingSession.stopDubbing();
  Game.dubbingSession.muteMic();
  VoiceGate.reset();
  updateMicBadge(false);
  hideElement('userSubtitle');
  hideSubtitleContent();
  hideElement('gameScreen');
  byId('gameScreen').classList.remove('overlay-mode');
  resetOverlayRuntimeCss();
  showElement('authBar');
  if (Game.overlayCtrl) Game.overlayCtrl.reset();
  if (Game.vocabSubtitle) { Game.vocabSubtitle.hide(); Game.vocabSubtitle.clear(); }
  if (Game.vocabProgressBar) { Game.vocabProgressBar.hide(); Game.vocabProgressBar.destroy(); }

  // 停止语音通道，允许重新进入
  await Game.dubbingSession.stopVoiceChat();

  // DHF 切回面板模式
  setDHFPanel();

  // 回到介绍页
  showIntro();
}

/** 跳过当前配音 — 不显示 Toast，直接继续播放，并用 DHF TTS 朗读目标字幕 */
function skipDubbing() {
  if (Game.state !== 'dubbing') return;
  const track = Game.tracks[Game.currentTrackIdx];
  if (!track) return;
  console.log('[RPS] 用户跳过配音');

  // 停止配音，静音麦克风
  Game.dubbingSession.stopDubbing();
  Game.dubbingSession.muteMic();
  updateMicBadge(false);
  hideElement('userSubtitle');
  if (Game.isOverlayMode && Game.vocabSubtitle) {
    Game.vocabSubtitle.hide();
    Game.vocabSubtitle.setMicState(false);
  } else {
    fadeOutSubtitleContent();
  }

  // 记录成绩（跳过视为通过）
  const trackIdx = Game.tracks.indexOf(track);
  Game.scoring.recordAttempt(trackIdx, true);

  // 用 DHF TTS 朗读目标字幕
  if (track.targetText) {
    VoiceGate.requestSpeak(track.targetText);
  }

  // 退出慢镜头，推进到下一段
  Game.videoCtrl.exitSlowMotion();
  Game.currentTrackIdx++;
  Game.matchedWords = 0;

  // 角色扮演电影模式：跳过当前台词的剩余部分，避免重听原版音频
  if (Game.isRolePlayMovieMode) {
    Game.videoCtrl.seekTo(track.endMs / 1000);
  }

  // Overlay mode: advance track in controller
  if (Game.isOverlayMode && Game.overlayCtrl) {
    const hasMore = Game.overlayCtrl.advanceMovieTrack();
    if (hasMore) {
      Game.overlayCtrl.allowDubbingTrigger();
    } else {
      Game.overlayCtrl.resetDubbingTrigger();
    }
  }

  // 检查是否全部完成
  if (Game.currentTrackIdx >= Game.tracks.length) {
    setTimeout(() => {
      if (Game.state !== 'result') {
        showResult();
      }
    }, 2000);
  }

  // 直接回到播放状态
  changeState('playing');
  VoiceGate.requestVideoPlay(() => {
    Game.videoCtrl.setVolume(SLOWMO_CONFIG.normalVolume);
    Game.videoCtrl.setPlaybackRate(1.0);
    Game.videoCtrl.play();
  });
}

// =================== 配置解析 ===================

/**
 * 解析 URL 参数中的配置路径
 * ?config=path/to/config.json 优先
 * 默认使用 stories/demo/config.json
 */
function resolveConfigPath() {
  const params = new URLSearchParams(window.location.search);
  Game.configPath = params.get('config') || DEFAULT_CONFIG_PATH;
}

/**
 * 将配置中的相对路径解析为基于配置文件目录的完整 URL
 * @param {string} relativePath
 * @returns {string}
 */
function resolveAssetUrl(relativePath) {
  if (!relativePath) return '';
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) return relativePath;
  // 基于当前页面目录解析
  return new URL(relativePath, window.location.href).href;
}

// =================== story 工具注册 ===================

/**
 * 在父页面 SDK 上注册 story 工具类，供 DHF iframe 内模板调用
 * 模板中通过 ${await copilot.getTitle()} 等方式调用
 */
function registerStoryTools() {
  const sdk = window.keepwork;
  if (!sdk?.copilotTools) return;

  sdk.copilotTools.registerToolCategory('story', {
    definitions: [
      {
        type: 'function',
        function: {
          name: 'getTitle',
          description: '获取当前故事标题',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getDesc',
          description: '获取当前故事描述',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getLineCount',
          description: '获取当前场景的台词总数',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getCurrentSentence',
          description: '获取当前正在配音的台词（nativeText + targetText）',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
    executor: async (fnName) => {
      if (fnName === 'getTitle') {
        return Game.storyConfig?.title || '影视配音秀';
      }
      if (fnName === 'getDesc') {
        return Game.storyConfig?.description || '';
      }
      if (fnName === 'getLineCount') {
        return String(Game.tracks?.length || 0);
      }
      if (fnName === 'getCurrentSentence') {
        const track = Game.tracks?.[Game.currentTrackIdx];
        if (!track) return '暂无当前台词';
        return `nativeText: ${track.nativeText}\ntargetText: ${track.targetText}`;
      }
      return '';
    },
  });
}

// =================== 初始化 ===================

async function init() {
  resolveConfigPath();

  const flowRoot = byId('flowRoot');

  // 1. 显示加载屏
  flowRoot.innerHTML = buildLoadingScreenHTML();
  const loadingStatus = byId('loadingStatus');

  // 2. 单机版：响应式缩放已由 role-play-movie.html 内嵌脚本处理；此处无需额外初始化

  // 2.5 注入 DHF 布局 CSS 变量
  const portraitAR = DHF_FULL_ASPECT_RATIO / DHF_PORTRAIT_HEIGHT_RATIO;
  document.documentElement.style.setProperty('--dhf-full-aspect-ratio', DHF_FULL_ASPECT_RATIO);
  document.documentElement.style.setProperty('--dhf-portrait-aspect-ratio', portraitAR);

  // 3. 加载 JSON 配置
  if (loadingStatus) loadingStatus.textContent = '加载配置...';
  try {
    const configUrl = resolveAssetUrl(Game.configPath);
    Game.storyConfig = await loadStoryConfig(configUrl);
    // Detect overlay mode
    if (Game.storyConfig.mode === 'step2-overlay') {
      Game.isOverlayMode = true;
      Game.overlayCtrl = new OverlayController(Game.storyConfig);
      console.log(`[RPS] Overlay 模式: "${Game.storyConfig.title}", ${Game.storyConfig.units.length} 个单词单元`);
    } else {
      Game.isOverlayMode = false;
      Game.overlayCtrl = null;
      console.log(`[RPS] 加载故事配置: "${Game.storyConfig.title}", ${Game.storyConfig.scenes.length} 个场景`);
    }
    // Role-play movie mode: bottom subtitle list + skip/replay buttons
    Game.isRolePlayMovieMode = !Game.isOverlayMode && (
      Game.storyConfig.rolePlayMovie === true ||
      (typeof window !== 'undefined' && !!window.__roleplayMovieConfig)
    );
    if (Game.isRolePlayMovieMode) {
      console.log('[RPS] 角色扮演电影模式启用');
    }
  } catch (e) {
    console.error('[RPS] 配置加载失败:', e);
    if (loadingStatus) loadingStatus.textContent = '配置加载失败: ' + e.message;
    return;
  }

  // 4. 初始化视频控制器
  const videoEl = byId('mainVideo');
  const slowmoOverlay = byId('slowmoOverlay');
  Game.videoCtrl = new VideoController(videoEl, slowmoOverlay);

  // 5. 初始化字幕管理器
  Game.subtitleMgr = new SubtitleManager(byId('subtitleText'));

  // 5.5 试听按钮 — 点击后用 DHF TTS 朗读当前目标字幕
  const ttsBtn = byId('ttsBtn');
  if (ttsBtn) {
    ttsBtn.addEventListener('click', () => {
      const track = Game.tracks && Game.tracks[Game.currentTrackIdx];
      if (track && Game.dubbingSession && Game.dubbingSession.isAvailable) {
        VoiceGate.requestSpeak(track.targetText);
      }
    });
  }

  // 6. 初始化计分
  Game.scoring = new Scoring();

  // 6.1 初始化音素球管理器
  Game.phonemeBall = new PhonemeBallManager(byId('phonemeTrack'));

  // 6.2 初始化 HUD 四角
  Game.hud = new HudManager();

  // 6.5 注册 story 工具类（供 DHF 内 AI 模板调用）
  registerStoryTools();

  // 7. 初始化配音会话（DigitalHumanFrame）— 仅预加载，不启动语音
  Game.dubbingSession = new DubbingSession(byId('dhfContainer'));
  if (loadingStatus) loadingStatus.textContent = '初始化语音通道...';
  await Game.dubbingSession.init({ configUrl: resolveAssetUrl(DHF_CONFIG_PATH) });

  // 7.5 绑定 AI 助手字幕回调（全局，包含初始问候）
  Game.dubbingSession.onAssistantText((text) => {
    const el = byId('assistantSubtitleText');
    if (el) el.textContent = text || '';
    // 自动滚到底部，确保助手字幕可见
    const area = byId('subtitleArea');
    if (area) area.scrollTop = area.scrollHeight;
  });

  // 7.6 绑定 AI 说话状态回调 — speaking / waiting 切换 + 音频互斥
  Game.dubbingSession.onSpeakingStateChange((speaking) => {
    // 音频互斥：DHF 说话时暂停视频，说完后恢复
    if (speaking) {
      VoiceGate.onDHFStart();
    } else {
      VoiceGate.onDHFEnd();
    }

    if (Game.state !== 'dubbing') return;
    if (speaking) {
      updateMicBadge('speaking');
    } else {
      // AI 说完 → 回到等待或录制状态
      updateMicBadge(Game.dubbingSession.userRecording ? 'recording' : 'waiting');
    }
  });

  // 7.7 绑定用户录音状态回调 — recording / waiting 切换
  Game.dubbingSession.onRecordingStateChange((recording) => {
    if (Game.state !== 'dubbing') return;
    if (Game.dubbingSession.aiSpeaking) return; // AI 说话中不切换
    updateMicBadge(recording ? 'recording' : 'waiting');
  });

  // 8. 通知就绪
  notifyGameDisplayReady({ screen: 'intro' });

  // 9. 显示介绍页
  showIntro();
}

// =================== 介绍页 ===================

function showIntro() {
  changeState('intro');
  const flowRoot = byId('flowRoot');
  const cfg = Game.storyConfig;
  flowRoot.innerHTML = buildIntroScreenHTML(cfg ? cfg.title : GAME_DISPLAY_TITLE, cfg ? cfg.description : '');

  // 确保 DHF 在面板模式
  setDHFPanel();

  const btnStart = byId('btnStartGame');
  if (btnStart) {
    btnStart.addEventListener('click', () => {
      startVoiceAndGo();
    }, { once: true });
  }
}

// =================== 语音初始化 + GO 倒计提示 ===================

async function startVoiceAndGo() {
  const flowRoot = byId('flowRoot');
  const title = Game.storyConfig ? Game.storyConfig.title : GAME_DISPLAY_TITLE;

  // 显示 "XXX 即将开始" 提示
  flowRoot.innerHTML = `
    <div class="rps-countdown-screen" id="rpsCountdown">
      <div class="rps-countdown-text" id="countdownText">${title} 即将开始</div>
    </div>
  `;
  const countdownText = byId('countdownText');

  // 启动语音通道
  try {
    await Game.dubbingSession.startVoiceChat();
  } catch (e) {
    console.warn('[RPS] 语音通道启动失败:', e.message);
  }

  // 语音就绪 → 显示 GO
  if (countdownText) {
    countdownText.textContent = 'GO!';
    countdownText.classList.add('rps-countdown-go');
  }

  // 短暂停留后进入第一个场景
  await new Promise((r) => setTimeout(r, 800));
  if (Game.isOverlayMode) {
    startOverlay();
  } else {
    startScene(0);
  }
}

// =================== 场景加载与开始 ===================

function startScene(sceneIdx) {
  const scenes = Game.storyConfig.scenes;
  if (sceneIdx >= scenes.length) {
    showResult();
    return;
  }

  Game.currentSceneIdx = sceneIdx;
  Game.currentScene = scenes[sceneIdx];
  Game.tracks = Game.currentScene.subtitleTracks;
  Game.currentTrackIdx = 0;
  Game.matchedWords = 0;

  // 设置字幕
  Game.subtitleMgr.setTracks(Game.tracks);

  // 计分
  Game.scoring.reset();
  Game.scoring.setTotalCues(Game.tracks.length);

  // 设置视频源
  const videoSrc = resolveAssetUrl(Game.currentScene.videoSrc);
  if (!videoSrc) {
    console.error('[RPS] 场景缺少视频源:', Game.currentScene.id);
    return;
  }
  Game.videoCtrl.setSource(videoSrc);

  changeState('playing');
  const flowRoot = byId('flowRoot');
  flowRoot.innerHTML = '';
  showElement('gameScreen');
  byId('gameScreen').classList.remove('overlay-mode');
  resetOverlayRuntimeCss();
  hideElement('authBar');

  // Role-play movie mode: enable bottom subtitle panel layout
  if (Game.isRolePlayMovieMode) {
    setupRolePlayMovieMode();
  } else {
    teardownRolePlayMovieMode();
  }

  // DHF 切换为右下角头像模式
  setDHFAvatar();
  updateMicBadge(false);

  // 绑定跳过按钮
  const skipBtn = byId('skipDubBtn');
  if (skipBtn) {
    skipBtn.onclick = () => skipDubbing();
  }

  // 绑定返回首页按钮
  const homeBtn = byId('homeDubBtn');
  if (homeBtn) {
    homeBtn.onclick = () => returnToHome();
  }

  // 绑定视频事件
  Game.videoCtrl.on('timeupdate', onVideoTimeUpdate);
  Game.videoCtrl.on('ended', onVideoEnded);

  // 初始字幕区可见，预渲染第一句卡拉OK（全dim）保持格式统一
  showSubtitleContent();
  const firstTrack = Game.tracks[0];
  if (firstTrack) {
    const secondTrack = Game.tracks[1] || null;
    Game.subtitleMgr.renderKaraoke(firstTrack, 0);
    Game.subtitleMgr.updateAuxLayers(firstTrack, secondTrack);
    // 音素球：渲染第一句
    const phonemes = firstTrack.phonemes || generatePhonemesFromWords(firstTrack);
    Game.phonemeBall.render(phonemes);
  }

  // HUD 四角：初始化并显示
  Game.hud.reset();
  Game.hud.setQuest(
    Game.storyConfig.title || '配音挑战',
    `完成所有 ${Game.tracks.length} 句配音`,
    0,
    Game.tracks.length,
  );
  Game.hud.show();

  // 视频进度条 — 默认显示，支持快速跳转到电影任意位置
  Game.vocabProgressBar = new VocabProgressBar(Game.videoCtrl);
  Game.vocabProgressBar.init();
  Game.vocabProgressBar.show();
  Game.vocabProgressBar.onSeek((timeSec) => {
    handleSceneSeek(timeSec);
  });
  // Role-play movie mode replaces the simple progress bar with the scene timeline.
  if (Game.isRolePlayMovieMode) Game.vocabProgressBar.hide();

  notifyGameStarted();
  VoiceGate.requestVideoPlay(() => {
    Game.videoCtrl.play();
  });
}

/**
 * 处理用户在角色扮演电影模式拖动进度条后的状态恢复。
 * - 若正处于配音/重试，停止配音并恢复到正常播放
 * - 根据新位置重新计算 `currentTrackIdx`，并重渲染卡拉OK字幕
 */
function handleSceneSeek(timeSec) {
  console.log(`[RPS] 用户拖动进度条 → ${timeSec.toFixed(1)}s`);

  // 若当前在配音 / 重试，先停止
  if (Game.state === 'dubbing' || Game.state === 'retryPreview') {
    Game.dubbingSession.stopDubbing();
    Game.dubbingSession.muteMic();
    Game.videoCtrl.exitSlowMotion();
    updateMicBadge(false);
    hideElement('userSubtitle');
    clearSentenceFeedbackOverlays();
    Game.subtitleMgr.clearSentenceOutcome();
  }

  // 根据新位置重新定位 currentTrackIdx：
  // 第一个 endMs 大于当前时间的轨即为下一个待配音轨
  const timeMs = timeSec * 1000;
  const tracks = Game.tracks || [];
  let newIdx = tracks.findIndex(t => t.endMs > timeMs);
  if (newIdx < 0) newIdx = tracks.length;
  Game.currentTrackIdx = newIdx;
  Game.matchedWords = 0;
  Game.retryCount = 0;

  // 更新 HUD 进度
  if (Game.hud) {
    Game.hud.updateProgress(Game.currentTrackIdx, tracks.length);
  }

  // 重渲染当前/下一句卡拉OK字幕
  const curTrack = tracks[Game.currentTrackIdx] || null;
  const nextTrack = tracks[Game.currentTrackIdx + 1] || null;
  showSubtitleContent();
  if (curTrack) {
    Game.subtitleMgr.renderKaraoke(curTrack, 0);
    Game.subtitleMgr.updateAuxLayers(curTrack, nextTrack);
    const phonemes = curTrack.phonemes || generatePhonemesFromWords(curTrack);
    Game.phonemeBall.render(phonemes);
  } else {
    Game.subtitleMgr.renderKaraoke(null, 0);
    Game.phonemeBall.clear();
  }

  // 恢复播放
  changeState('playing');
  VoiceGate.requestVideoPlay(() => {
    Game.videoCtrl.setVolume(SLOWMO_CONFIG.normalVolume);
    Game.videoCtrl.setPlaybackRate(1.0);
    Game.videoCtrl.play();
  });
}

// =================== Overlay 模式 — 场景启动 ===================

function startOverlay() {
  const cfg = Game.storyConfig;
  const ctrl = Game.overlayCtrl;
  ctrl.reset();
  OverlayPrelude.reset();
  applyOverlayRuntimeCss();

  // Collect all movie tracks as the dubbing cue list
  Game.tracks = ctrl.getAllTracks();
  Game.currentTrackIdx = 0;
  Game.matchedWords = 0;

  // Scoring (SubtitleManager not used in overlay mode)
  Game.scoring.reset();
  Game.scoring.setTotalCues(Game.tracks.length);

  // Initialize VocabSubtitle — 两层字幕区
  Game.vocabSubtitle = new VocabSubtitle();
  Game.vocabSubtitle.setElements({
    container: byId('vocSubtitleArea'),
    target: byId('vocSubtitleTarget'),
    zh: byId('vocSubtitleZh'),
    micIndicator: byId('vocMicIndicator'),
  });

  // Bind overlay DOM elements
  ctrl.setElements({
    captionArea: byId('overlayCaptionArea'),
    captionWord: byId('overlayCaptionWord'),
    captionIpa: byId('overlayCaptionIpa'),
    captionZh: byId('overlayCaptionZh'),
  });

  // Dubbing trigger callback — handles both movie tracks and intro/review word dubs
  ctrl.onDubbingTrigger((track, unitIdx, trackIdx) => {
    if (Game.state !== 'playing') return;
    const isWordDub = OverlayController.isWordDubTrack(track);
    console.log(`[RPS-Overlay] 触发配音: unit[${unitIdx}] ${isWordDub ? `word-dub(${track._stage})` : `track[${trackIdx}]`} target="${track.targetText}"`);

    OverlayPrelude.run('review', () => {
      enterDubbingMode(track);
    });
  });

  // Stage change callback — show/hide vocab subtitle area by stage + 过渡叮声
  ctrl.onStageChange((unitIdx, stage) => {
    console.log(`[RPS-Overlay] 阶段切换: unit[${unitIdx}] → ${stage}`);

    OverlayPrelude.reset();
    if (stage === 'idle') return;

    OverlayPrelude.run(stage, () => {
      if (stage === 'movie') {
        Game.vocabSubtitle.show();
        const track = ctrl.getCurrentMovieTrack();
        if (track) {
          const unit = ctrl.currentUnit;
          Game.vocabSubtitle.renderStatic(track.targetText, unit?.translation || '');
        }
      } else {
        Game.vocabSubtitle.hide();
        Game.vocabSubtitle.setMicState(false);
      }

      VoiceGate.requestVideoPlay(() => {
        Game.videoCtrl.play();
      });
    });
  });

  // Video source
  const videoSrc = resolveAssetUrl(cfg.videoSrc);
  if (!videoSrc) {
    console.error('[RPS-Overlay] 配置缺少 videoSrc');
    return;
  }
  Game.videoCtrl.setSource(videoSrc);

  changeState('playing');
  const flowRoot = byId('flowRoot');
  flowRoot.innerHTML = '';
  showElement('gameScreen');
  hideElement('authBar');

  // 标记 overlay 模式，用于 CSS 布局切换
  byId('gameScreen').classList.add('overlay-mode');

  setDHFAvatar();
  updateMicBadge(false);

  // Hide game-mode HUD panels — not needed in vocab mode
  const hudTL = byId('hudTL');
  const hudTR = byId('hudTR');
  const hudBL = byId('hudBL');
  if (hudTL) hudTL.style.display = 'none';
  if (hudTR) hudTR.style.display = 'none';
  if (hudBL) hudBL.style.display = 'none';

  // Hide game-mode subtitle area
  hideSubtitleContent();
  const gameSubtitleArea = byId('subtitleArea');
  if (gameSubtitleArea) gameSubtitleArea.style.display = 'none';

  // Bind controls
  const skipBtn = byId('skipDubBtn');
  if (skipBtn) skipBtn.onclick = () => skipDubbing();
  const homeBtn = byId('homeDubBtn');
  if (homeBtn) homeBtn.onclick = () => returnToHome();

  // Bind time update — overlay mode uses its own handler
  Game.videoCtrl.on('timeupdate', onOverlayTimeUpdate);
  Game.videoCtrl.on('ended', onVideoEnded);

  // Initialize video progress bar
  Game.vocabProgressBar = new VocabProgressBar(Game.videoCtrl);
  Game.vocabProgressBar.init();
  Game.vocabProgressBar.show();

  // Handle seek — stop dubbing and reset overlay state
  Game.vocabProgressBar.onSeek((timeSec) => {
    console.log(`[RPS-Overlay] 用户拖动进度条 → ${timeSec.toFixed(1)}s`);
    if (Game.state === 'dubbing' || Game.state === 'retryPreview') {
      Game.dubbingSession.stopDubbing();
      Game.dubbingSession.muteMic();
      Game.videoCtrl.exitSlowMotion();
      Game.vocabSubtitle.hide();
      Game.vocabSubtitle.setMicState(false);
      updateMicBadge(false);
      hideElement('userSubtitle');
    }
    // Reset overlay controller to re-evaluate from new position
    if (Game.overlayCtrl) {
      Game.overlayCtrl.forceReset();
    }
    OverlayPrelude.reset();
    VoiceGate.reset();
    changeState('playing');
    VoiceGate.requestVideoPlay(() => {
      Game.videoCtrl.setVolume(SLOWMO_CONFIG.normalVolume);
      Game.videoCtrl.setPlaybackRate(1.0);
      Game.videoCtrl.play();
    });
  });

  notifyGameStarted();
  VoiceGate.requestVideoPlay(() => {
    Game.videoCtrl.play();
  });
}

// =================== Overlay 模式 — 时间更新 ===================

function onOverlayTimeUpdate() {
  const ctrl = Game.overlayCtrl;
  if (!ctrl) return;

  const timeMs = Game.videoCtrl.currentTime * 1000;

  if (Game.state === 'playing') {
    ctrl.update(timeMs);
  }
}

// =================== 视频时间更新 ===================

function onVideoTimeUpdate() {
  if (Game.state !== 'playing') return;

  const timeMs = Game.videoCtrl.currentTime * 1000;

  // Role-play movie mode has its own simple advance/pause-on-user-turn loop.
  if (Game.isRolePlayMovieMode) {
    onRolePlayTimeUpdate(timeMs);
    return;
  }

  // 检查当前已通过的配音轨之后是否有活跃的轨道
  const currentTrack = Game.tracks[Game.currentTrackIdx];
  if (!currentTrack) return;

  // 获取当前时间的字幕轨
  const track = Game.subtitleMgr.getTrackAtTime(timeMs);
  if (track) {
    // 跳过已通过的字幕轨
    const trackIdx = Game.tracks.indexOf(track);
    if (trackIdx >= 0 && trackIdx < Game.currentTrackIdx) {
      return;
    }
    // 是当前待配音轨吗？
    if (track === currentTrack) {
      if (timeMs >= track.startMs) {
        // 到达配音点
        enterDubbingMode(track);
        return;
      }
    }
  }
}

function onVideoEnded() {
  showResult();
}

// =================== 配音模式 ===================

function enterDubbingMode(track, isRetry = false) {
  if (Game.state === 'dubbing') return;
  OverlayPrelude.cancel();
  const trackIdx = Game.tracks.indexOf(track);
  console.log(`[RPS] 进入配音模式: track[${trackIdx}] startMs=${track.startMs} endMs=${track.endMs} target="${track.targetText}" isRetry=${isRetry} retryCount=${Game.retryCount}`);
  changeState('dubbing');

  Game.matchedWords = 0;

  // 新句子时清除旧帧缓存 + 上一句的 SENTENCE REVIEW 卡片，重试时保留
  if (!isRetry) {
    Game.videoCtrl.clearFrameCache();
    clearSentenceFeedbackOverlays();
  }

  // 角色扮演电影模式 — 直接暂停视频（不使用慢镜头）
  if (Game.isRolePlayMovieMode) {
    Game.videoCtrl.pause();
  } else {
    Game.videoCtrl.enterSlowMotion();
  }

  // --- Overlay 模式：使用 VocabSubtitle ---
  if (Game.isOverlayMode && Game.vocabSubtitle) {
    const unit = Game.overlayCtrl?.currentUnit;
    Game.vocabSubtitle.show();
    Game.vocabSubtitle.renderKaraoke(track, 0);
    Game.vocabSubtitle.setTranslation(unit?.translation || '');
    Game.vocabSubtitle.setMicState('recording');
  } else {
    // 显示字幕区 + 卡拉OK字幕
    fadeInSubtitleContent();
    showSubtitleContent();
    Game.subtitleMgr.renderKaraoke(track, 0);
    const nextTrack = Game.tracks[Game.currentTrackIdx + 1] || null;
    Game.subtitleMgr.updateAuxLayers(track, nextTrack);

    // 音素球：渲染并设为等待态
    if (!isRetry) {
      const phonemes = track.phonemes || generatePhonemesFromWords(track);
      Game.phonemeBall.render(phonemes);
    }
    Game.phonemeBall.setAllWaiting();
  }

  // 更新麦克风状态为录音中
  updateMicBadge(true);

  // 重试时麦克风已经开启，不需要再次 unmute
  if (!isRetry) {
    console.log('[RPS] 配音开始 — unmute麦克风');
    Game.dubbingSession.unmuteMic();
  } else {
    console.log('[RPS] 重试配音 — 麦克风已开启，跳过 unmute');
  }

  // 启动配音
  // 记录最新 ASR 文本，供 LLM 判断补充使用
  let latestAsrText = '';
  let prevDetails = null;

  // 重试时跳过 sendContext（LLM 历史中已有句子信息），除非重试次数超过 10 次
  const skipContext = isRetry && Game.retryCount <= 10;
  Game.dubbingSession.startDubbing(
    track,
    skipContext,
    // onAsrUpdate — 实时更新卡拉OK进度 + 用户字幕
    (asrText) => {
      latestAsrText = asrText || '';
      console.log(`[RPS][ASR] "${latestAsrText}"`);
      // 用户开口说话时立即清除助手字幕（AI 语音已被打断）
      const assistantEl = byId('assistantSubtitleText');
      if (assistantEl && latestAsrText) assistantEl.textContent = '';
      // 用户再次开口 → 清掉上一句的 SENTENCE REVIEW 卡片（保持到说话或换句为止）
      if (latestAsrText) {
        const diag = byId('diagnosticLayer');
        if (diag && diag.children.length) clearSentenceFeedbackOverlays();
      }
      let details = matchWordDetails(track.targetText, asrText);
      // 角色扮演模式：宽松匹配 — 历次 ASR 中只要某词被匹配过，就保持已通过状态
      // （即使本次 ASR 没说到该词，也不会丢失之前的进度）
      if (Game.isRolePlayMovieMode) {
        const merged = Array.isArray(Game.rolePlayMergedDetails)
          ? Game.rolePlayMergedDetails.map(d => ({ ...d }))
          : details.map(() => ({ matched: false, score: 0, spokenWord: null, skipped: false }));
        for (let i = 0; i < details.length; i++) {
          const cur = details[i];
          const prev = merged[i] || { matched: false, score: 0, spokenWord: null, skipped: false };
          if (cur && cur.matched) {
            // 取较高分
            if (!prev.matched || (cur.score || 0) > (prev.score || 0)) {
              merged[i] = { matched: true, score: cur.score, spokenWord: cur.spokenWord, skipped: false };
            } else {
              merged[i] = { ...prev, matched: true, skipped: false };
            }
          } else if (prev.matched) {
            // 保留之前匹配，忽略本次的 skipped 标记
            merged[i] = { ...prev, skipped: false };
          } else {
            merged[i] = { ...prev };
          }
        }
        Game.rolePlayMergedDetails = merged;
        details = merged;
      }
      const flags = details.map(d => d.matched);
      const matched = flags.filter(Boolean).length;
      Game.matchedWords = matched;

      // 日志：当前 ASR 已识别（累计匹配）到的目标词
      if (Game.isRolePlayMovieMode) {
        const targetWords = (track.wordTiming && track.wordTiming.length)
          ? track.wordTiming.map(w => w.text)
          : (track.targetText || '').split(/\s+/);
        const recognized = targetWords.filter((_, i) => flags[i]);
        console.log(`[RPS][ASR] 已识别 ${matched}/${targetWords.length}: [${recognized.join(', ')}]`);
      }

      if (Game.isOverlayMode && Game.vocabSubtitle) {
        // Overlay 模式：简洁三档卡拉OK
        Game.vocabSubtitle.renderKaraoke(track, details);
      } else {
        // 游戏模式：十档石化 + 弹分 + Combo
        Game.subtitleMgr.renderKaraoke(track, details);
        // 音素球同步更新
        const firstUnmatched = details.findIndex(d => !d.matched && !d.skipped);
        Game.phonemeBall.updateFromWordMatch(firstUnmatched, details);
        // HUD: 对新匹配的词更新法力/生命/金币
        for (let i = 0; i < details.length; i++) {
          if (details[i].matched && !(prevDetails && prevDetails[i] && prevDetails[i].matched)) {
            const tier = Math.round(details[i].score * 10);
            Game.hud.onWordScored(tier);
          }
        }
        // HUD combo 同步
        const combo = Game.subtitleMgr._currentCombo || 0;
        const maxCombo = Game.subtitleMgr._maxCombo || 0;
        Game.hud.updateCombo(combo, maxCombo);
      }
      // 角色扮演模式：底部面板的当前行同步显示逐词高亮
      if (Game.isRolePlayMovieMode && Game.bottomPanel) {
        Game.bottomPanel.setCurrentDetails(details);
      }
      prevDetails = details.map(d => ({ ...d }));
      // 100%匹配 → 立即本地PASS，跳过LLM等待
      if (flags.every(Boolean) && Game.state === 'dubbing') {
        console.log('[RPS] 所有词匹配 — 立即本地PASS');
        Game.dubbingSession.stopDubbing();
        handleDubbingResult(track, { pass: true, message: '完美！' });
      }
    },
    // onJudgeResult — LLM 判断 + 逐词匹配率双重校验
    (result) => {
      let ratio = wordMatchRatio(track.targetText, latestAsrText);
      // 角色扮演模式：使用累计合并匹配率（允许用户分多次说完）
      if (Game.isRolePlayMovieMode && Array.isArray(Game.rolePlayMergedDetails) && Game.rolePlayMergedDetails.length) {
        const merged = Game.rolePlayMergedDetails;
        const mergedRatio = merged.filter(d => d && d.matched).length / merged.length;
        if (mergedRatio > ratio) ratio = mergedRatio;
      }
      console.log(`[RPS] 逐词匹配率: ${(ratio * 100).toFixed(0)}%  ASR="${latestAsrText}"`);

      // 逐词匹配率 >= 70% 直接通过（即使 LLM 返回 FAIL）
      if (!result.pass && ratio >= 0.7) {
        console.log('[RPS] LLM 判 FAIL 但逐词匹配率足够，覆盖为 PASS');
        result = { pass: true, message: result.message || '很棒！' };
      }
      // 完全信任 LLM 判断（LLM 会在多次尝试后自动 PASS）

      handleDubbingResult(track, result);
    },
  );
}

function handleDubbingResult(track, result) {
  console.log(`[RPS] 配音结果: pass=${result.pass} message="${result.message}"`);

  // 找到 track 在 tracks 中的索引
  const trackIdx = Game.tracks.indexOf(track);

  // 记录成绩
  Game.scoring.recordAttempt(trackIdx, result.pass);

  // --- Overlay 模式：轻量 PASS/FAIL ---
  if (Game.isOverlayMode && Game.vocabSubtitle) {
    const isWordDub = OverlayController.isWordDubTrack(track);

    if (result.pass) {
      Game.dubbingSession.stopDubbing();
      Game.retryCount = 0;
      Game.dubbingSession.muteMic();
      Game.vocabSubtitle.setMicState(false);
      updateMicBadge('success');
      hideElement('userSubtitle');

      Game.vocabSubtitle.showPassFeedback().then(() => {
        Game.matchedWords = 0;
        Game.videoCtrl.exitSlowMotion();

        if (isWordDub) {
          // Word dub (intro/review): just resume video, don't advance track
          Game.vocabSubtitle.hide();
        } else {
          // Movie sentence dub: advance track
          Game.currentTrackIdx++;

          if (Game.currentTrackIdx >= Game.tracks.length) {
            Game.vocabSubtitle.hide();
            setTimeout(() => {
              if (Game.state !== 'result') showResult();
            }, 2000);
          }

          // Overlay controller: advance or finish unit
          if (Game.overlayCtrl) {
            const hasMore = Game.overlayCtrl.advanceMovieTrack();
            if (hasMore) {
              Game.overlayCtrl.allowDubbingTrigger();
            } else {
              Game.overlayCtrl.resetDubbingTrigger();
              Game.vocabSubtitle.hide();
            }
          }
        }

        changeState('playing');
        VoiceGate.requestVideoPlay(() => {
          Game.videoCtrl.setVolume(SLOWMO_CONFIG.normalVolume);
          Game.videoCtrl.setPlaybackRate(1.0);
          Game.videoCtrl.play();
        });
      });

      setTimeout(() => updateMicBadge(false), 1500);
    } else {
      // FAIL — 快速重试
      Game.retryCount++;
      Game.matchedWords = 0;

      Game.vocabSubtitle.showFailFeedback().then(() => {
        Game.dubbingSession.resetForRetry();
        Game.vocabSubtitle.renderKaraoke(track, 0);
        changeState('retryPreview');
        setTimeout(() => enterDubbingMode(track, true), 240);
      });
    }
    return;
  }

  // --- 游戏模式：完整 PASS/FAIL 流程 ---
  const summary = Game.subtitleMgr.getSentenceSummary(track);
  clearSentenceFeedbackOverlays();
  Game.subtitleMgr.showWeakState(summary, result.pass ? 'pass' : 'fail');

  if (result.pass) {
    // 通过 — 停止配音、静音麦克风
    Game.dubbingSession.stopDubbing();
    console.log('[RPS] 配音通过 — mute麦克风，成功动效与视频恢复并行');
    Game.retryCount = 0;
    Game.dubbingSession.muteMic();
    // 显示成功图标 + 叮铃音效
    updateMicBadge('success');
    hideElement('userSubtitle');
    // HUD 更新：奖励金币 + 更新任务进度
    Game.hud.onSentencePass();
    Game.hud.updateProgress(Game.currentTrackIdx + 1, Game.tracks.length);

    showSentenceStamp('pass').then(() => {
      showDiagnosticCard(summary, 'pass');
      setTimeout(() => {
        commitSentenceScore().then(() => {
          // 不在此处清除 SENTENCE REVIEW 卡片：保持到下一句开始或用户再次开口为止
          Game.subtitleMgr.clearSentenceOutcome();

          Game.currentTrackIdx++;
          Game.matchedWords = 0;

          const nextTrack = Game.tracks[Game.currentTrackIdx] || null;
          const nextNextTrack = Game.tracks[Game.currentTrackIdx + 1] || null;

          // 淡入过渡动画：如果有下一句，先滚动切换内容
          const doTransition = nextTrack
            ? Game.subtitleMgr.scrollInNextSentence(nextTrack, nextNextTrack)
            : Promise.resolve();

          doTransition.then(() => {
            // 渲染下一句音素球
            if (nextTrack) {
              const phonemes = nextTrack.phonemes || generatePhonemesFromWords(nextTrack);
              Game.phonemeBall.render(phonemes);
            } else {
              Game.phonemeBall.clear();
            }
            setTimeout(() => {
              Game.videoCtrl.exitSlowMotion();

              // 角色扮演电影模式：跳过用户刚朗读完的台词，避免重听原版音频
              if (Game.isRolePlayMovieMode) {
                const justFinished = Game.tracks[Game.currentTrackIdx - 1];
                if (justFinished) {
                  Game.videoCtrl.seekTo(justFinished.endMs / 1000);
                }
              }

              if (Game.currentTrackIdx >= Game.tracks.length) {
                // 最后一句通过后淡出字幕区
                fadeOutSubtitleContent();
                setTimeout(() => {
                  if (Game.state !== 'result') {
                    showResult();
                  }
                }, 2000);
              }

              // Overlay mode: tell controller dubbing is done, check for more tracks in this unit
              if (Game.isOverlayMode && Game.overlayCtrl) {
                const hasMore = Game.overlayCtrl.advanceMovieTrack();
                if (hasMore) {
                  // More tracks in this unit — allow next trigger
                  Game.overlayCtrl.allowDubbingTrigger();
                } else {
                  // Unit done — prevent re-trigger, let video continue to review/next unit
                  Game.overlayCtrl.resetDubbingTrigger();
                }
              }

              changeState('playing');
              VoiceGate.requestVideoPlay(() => {
                Game.videoCtrl.setVolume(SLOWMO_CONFIG.normalVolume);
                Game.videoCtrl.setPlaybackRate(1.0);
                Game.videoCtrl.play();
              });

              setTimeout(() => {
                const el = byId('assistantSubtitleText');
                if (el) el.textContent = '';
              }, 2000);
            }, 120);
          });
        });
      }, SENTENCE_CARD_HOLD_MS);
    });

    // 1.5秒后隐藏成功图标
    setTimeout(() => updateMicBadge(false), 1500);
  } else {
    // 不通过 — 句子积分清零，重试
    Game.retryCount++;
    console.log(`[RPS] 配音未通过 — 句子积分清零，进入重试 (retryCount=${Game.retryCount})`);
    Game.matchedWords = 0;
    showSentenceStamp('fail').then(() => {
      showDiagnosticCard(summary, 'fail');
      setTimeout(() => {
        resetSentenceScore();
        Game.subtitleMgr.clearSentenceOutcome();
        // 不在此处清除 SENTENCE REVIEW 卡片：FAIL 卡片保持到用户重新开口为止

        // 重置判断状态但保留 ASR 回调，用户可在等待期间继续说话
        Game.dubbingSession.resetForRetry();

        // 重试期间保持字幕可见（重置卡拉OK为未匹配状态）
        fadeInSubtitleContent();
        Game.subtitleMgr.renderKaraoke(track, 0);

        // 切到过渡状态以便 enterDubbingMode 的 state guard 通过
        changeState('retryPreview');

        // 继续保持慢镜头循环，直接重新进入配音模式
        setTimeout(() => {
          enterDubbingMode(track, true);
        }, 240);
      }, SENTENCE_CARD_HOLD_MS);
    });
  }
}

// =================== 重试预览 ===================

function startRetryPreview(track) {
  changeState('retryPreview');
  // 重试预览期间保持字幕可见（显示待配音文本），不隐藏
  fadeInSubtitleContent();
  Game.subtitleMgr.renderKaraoke(track, 0);
  hideElement('userSubtitle');
  // 重试预览期间保持麦克风开启，用户可随时开口
  console.log('[RPS] 重试预览 — 保持麦克风开启，字幕保持显示');

  // track.startMs 转秒
  const startTimeSec = track.startMs / 1000;
  Game.videoCtrl.playRetryPreview(startTimeSec, () => {
    enterDubbingMode(track, true);
  });
}

// =================== 结果页 ===================

async function showResult() {
  if (Game.state === 'result') return;
  changeState('result');

  Game.videoCtrl.pause();
  Game.videoCtrl.exitSlowMotion();
  OverlayPrelude.reset();
  Game.dubbingSession.stopDubbing();
  Game.dubbingSession.muteMic();
  VoiceGate.reset();
  updateMicBadge(false);
  hideElement('userSubtitle');
  hideSubtitleContent();
  hideElement('gameScreen');
  byId('gameScreen').classList.remove('overlay-mode');
  resetOverlayRuntimeCss();
  showElement('authBar');
  Game.hud.hide();
  Game.phonemeBall.clear();
  if (Game.overlayCtrl) Game.overlayCtrl.reset();
  if (Game.vocabSubtitle) { Game.vocabSubtitle.hide(); Game.vocabSubtitle.clear(); }
  if (Game.vocabProgressBar) { Game.vocabProgressBar.hide(); Game.vocabProgressBar.destroy(); }

  // 停止语音通道，重新进入时会重新启动
  await Game.dubbingSession.stopVoiceChat();

  // DHF 切回面板模式
  setDHFPanel();
  const summary = Game.scoring.getSummary();
  const flowRoot = byId('flowRoot');
  flowRoot.innerHTML = buildResultScreenHTML(summary);

  notifyGameFinished({
    score: summary.score,
    stars: summary.stars,
    passed: summary.passed,
    total: summary.total,
  });

  // 再来一次按钮
  const btnReplay = byId('btnReplay');
  if (btnReplay) {
    btnReplay.addEventListener('click', () => {
      Game.videoCtrl.seekTo(0);
      showIntro();
    }, { once: true });
  }
}

// =================== 角色扮演电影模式：底部字幕区 + 场景时间线 ===================

function setupRolePlayMovieMode() {
  const screen = byId('gameScreen');
  if (screen) {
    screen.classList.add('rp-movie-mode');
    screen.classList.remove('rp-user-turn-active');
  }

  Game.rolePlayInUserTurn = false;

  // Bottom subtitle panel
  const panelRoot = byId('rpBottomPanel');
  if (panelRoot) {
    panelRoot.classList.remove('hidden');
    if (!Game.bottomPanel || Game.bottomPanel.root !== panelRoot) {
      Game.bottomPanel = new RolePlayBottomPanel(panelRoot);
    }
    Game.bottomPanel.setTracks(Game.tracks || []);
    Game.bottomPanel.setCurrent(Game.currentTrackIdx || 0);
    Game.bottomPanel.setPaused(false);
  }

  // Scene timeline (clickable, like videoParser.html scene track)
  const timelineRoot = byId('rpSceneTimeline');
  if (timelineRoot) {
    timelineRoot.classList.remove('hidden');
    if (!Game.sceneTimeline || Game.sceneTimeline.root !== timelineRoot) {
      Game.sceneTimeline = new RolePlaySceneTimeline(timelineRoot);
      Game.sceneTimeline.on('seek', (ms) => {
        const sec = Math.max(0, ms / 1000);
        Game.videoCtrl.seekTo(sec);
        handleSceneSeek(sec);
      });
    }
    const cfg = Game.storyConfig || {};
    const scenes = Array.isArray(cfg.clipScenes) ? cfg.clipScenes : [];
    Game.sceneTimeline.setScenes(scenes, cfg.videoLengthMs || 0);
    // Pick up real duration once metadata loads.
    const videoEl = byId('mainVideo');
    if (videoEl) {
      const updateDur = () => {
        const d = Game.videoCtrl.duration;
        if (d && isFinite(d)) Game.sceneTimeline.setDuration(d * 1000);
      };
      videoEl.addEventListener('loadedmetadata', updateDur);
      updateDur();
    }
  }

  // Hide the old vocab progress bar (replaced by scene timeline in this mode).
  if (Game.vocabProgressBar) Game.vocabProgressBar.hide();

  // Click on the video toggles pause/play (but not while waiting on user turn).
  const videoEl = byId('mainVideo');
  if (videoEl && !Game._videoClickHandler) {
    Game._videoClickHandler = () => {
      if (!Game.isRolePlayMovieMode) return;
      if (Game.rolePlayInUserTurn) return; // user-turn paused; ignore
      if (Game.videoCtrl.paused) {
        Game.videoCtrl.play().catch(() => {});
        Game.bottomPanel?.setPaused(false);
      } else {
        Game.videoCtrl.pause();
        Game.bottomPanel?.setPaused(true);
      }
    };
    videoEl.addEventListener('click', Game._videoClickHandler);
  }

  // Wire the floating "Skip" button (visible only during the user's turn).
  const skipBtn = byId('rpSkipBtn');
  if (skipBtn) skipBtn.onclick = () => skipDubbing();
}

function teardownRolePlayMovieMode() {
  const screen = byId('gameScreen');
  if (screen) {
    screen.classList.remove('rp-movie-mode');
    screen.classList.remove('rp-user-turn-active');
  }
  const panelRoot = byId('rpBottomPanel');
  if (panelRoot) panelRoot.classList.add('hidden');
  const timelineRoot = byId('rpSceneTimeline');
  if (timelineRoot) timelineRoot.classList.add('hidden');
  const videoEl = byId('mainVideo');
  if (videoEl && Game._videoClickHandler) {
    videoEl.removeEventListener('click', Game._videoClickHandler);
    Game._videoClickHandler = null;
  }
}

function onRolePlayTimeUpdate(timeMs) {
  // Returning from a user turn: handleDubbingResult flips state back to
  // 'playing' before this is called again — restore the role-play UI now.
  if (Game.rolePlayInUserTurn && Game.state === 'playing') {
    exitRolePlayUserTurn();
  }

  // Update scene-timeline cursor.
  if (Game.sceneTimeline) Game.sceneTimeline.setCurrent(timeMs);

  const tracks = Game.tracks || [];

  // Walk past finished tracks; pause + enter user turn at player tracks.
  while (Game.currentTrackIdx < tracks.length) {
    const track = tracks[Game.currentTrackIdx];
    if (!track) break;
    if (timeMs >= track.startMs && track.isPlayer && !Game.rolePlayInUserTurn) {
      enterRolePlayUserTurn(track);
      return;
    }
    if (timeMs >= track.endMs) {
      Game.currentTrackIdx++;
      // 句子换行 → 清除上一句的 SENTENCE REVIEW 卡片
      clearSentenceFeedbackOverlays();
      continue;
    }
    break;
  }
  if (Game.bottomPanel) Game.bottomPanel.setCurrent(Game.currentTrackIdx);
}

function enterRolePlayUserTurn(track) {
  console.log(`[RPS] 角色扮演 — 用户朗读回合 track[${Game.currentTrackIdx}] target="${track.targetText}"`);
  Game.rolePlayInUserTurn = true;
  // Reset accumulated per-word details for this user turn (each new turn starts fresh).
  Game.rolePlayMergedDetails = null;
  const screen = byId('gameScreen');
  if (screen) screen.classList.add('rp-user-turn-active');
  if (Game.bottomPanel) {
    Game.bottomPanel.setPaused(true);
    Game.bottomPanel.setCurrentDetails(null);
  }

  // The legacy in-video subtitle panel is permanently hidden in role-play
  // movie mode (CSS `.rp-movie-mode #subtitleArea { display:none }`). The
  // bottom panel renders the line + per-word highlights instead. We still
  // show the HUD so score / combo / coin popups appear during the turn.
  if (Game.hud) Game.hud.show();

  // Hand off to the existing dubbing flow — drives mic, scoring, combo, etc.
  enterDubbingMode(track);
}

function exitRolePlayUserTurn() {
  console.log('[RPS] 角色扮演 — 退出用户朗读回合，恢复字幕面板');
  Game.rolePlayInUserTurn = false;
  Game.rolePlayMergedDetails = null;
  const screen = byId('gameScreen');
  if (screen) screen.classList.remove('rp-user-turn-active');
  if (Game.bottomPanel) {
    Game.bottomPanel.setCurrent(Game.currentTrackIdx);
    Game.bottomPanel.setCurrentDetails(null);
    Game.bottomPanel.setPaused(false);
  }
}

// =================== 启动 ===================

init().catch((err) => {
  console.error('[RPS] 初始化失败:', err);
});
