// =================== 影视配音秀 — 视频控制器 ===================

import { SLOWMO_CONFIG } from '../config.js';

/**
 * 计算帧缓存的画布尺寸，最长边不超过 maxSide，保持宽高比
 * @param {number} videoW
 * @param {number} videoH
 * @param {number} maxSide
 * @returns {{ width: number, height: number }}
 */
function calcCaptureSize(videoW, videoH, maxSide) {
  if (videoW <= 0 || videoH <= 0) return { width: maxSide, height: maxSide };
  const scale = Math.min(1, maxSide / Math.max(videoW, videoH));
  return {
    width: Math.round(videoW * scale),
    height: Math.round(videoH * scale),
  };
}

/**
 * 检测 URL 是否为 YouTube 视频，并提取视频 ID。
 * 支持：youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/embed/<id>,
 *      youtube-nocookie.com/embed/<id>, youtube.com/shorts/<id>
 * @param {string} url
 * @returns {string|null} videoId 或 null
 */
export function parseYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return /^[\w-]{6,}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{6,}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:embed|shorts|v)\/([\w-]{6,})/);
      if (m) return m[1];
    }
  } catch (_) { /* not a parseable URL */ }
  return null;
}

/** 单例：加载 YouTube IFrame API（多个 VideoController 共享） */
let _ytApiPromise = null;
function loadYouTubeIframeAPI() {
  if (_ytApiPromise) return _ytApiPromise;
  _ytApiPromise = new Promise((resolve) => {
    if (window.YT && typeof window.YT.Player === 'function') {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') { try { prev(); } catch (_) {} }
      resolve(window.YT);
    };
    if (!document.querySelector('script[data-yt-iframe-api]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.setAttribute('data-yt-iframe-api', '1');
      document.head.appendChild(tag);
    }
  });
  return _ytApiPromise;
}

/**
 * 封装 HTML5 <video> 操作，提供基于帧缓存的慢镜头特效
 *
 * 录音期间视频完全静音，画布始终覆盖在 video 上方：
 * 1. forward 阶段 — 视频以 slowRate 静默播放（仅用于采帧），
 *    canvas 用插值回放已缓存帧，模拟平滑慢动作
 * 2. rewind  阶段 — 视频暂停，canvas 从缓存末尾向前插值回放
 * 仅当 forward 阶段尚无缓存帧时，下层视频画面才会透出。
 */
export class VideoController {
  /**
   * @param {HTMLVideoElement} videoEl
   * @param {HTMLElement} slowmoOverlay
   */
  constructor(videoEl, slowmoOverlay) {
    this._video = videoEl;
    this._overlay = slowmoOverlay;
    this._slowmoActive = false;
    this._slowmoRAF = null;
    this._slowmoPhase = 'idle'; // 'idle' | 'forward' | 'rewind'
    this._slowmoPhaseStart = 0;
    this._dubbingStartTime = 0; // 配音点视频的起始时间

    // ---- YouTube 模式 ----
    /** 当源是 YouTube 视频时为 true：使用 IFrame Player API，跳过 canvas 慢动作 */
    this._isYouTube = false;
    /** @type {YT.Player|null} */
    this._ytPlayer = null;
    /** @type {HTMLElement|null} */
    this._ytContainer = null;
    this._ytReady = false;
    /** @type {Promise<void>|null} */
    this._ytReadyPromise = null;
    this._ytPollTimer = null;
    this._ytLastTime = 0;
    this._ytLastState = -1;
    this._ytPaused = true;
    /** 外部期望的播放状态：true 表示应当暂停。用于在 YouTube 自行/用户触发 PLAYING 时强制回到暂停。 */
    this._ytDesiredPaused = true;
    /** YouTube 模式的播放速率（受 setPlaybackRate 影响） */
    this._ytRate = 1;

    // ---- 帧缓存相关 ----
    /** @type {HTMLCanvasElement} */
    this._canvas = null;
    /** @type {CanvasRenderingContext2D} */
    this._ctx = null;
    /** 环形帧缓存 — 存 ImageBitmap / HTMLImageElement / dataURL 均可，此处用 ImageBitmap */
    /** @type {(ImageBitmap|null)[]} */
    this._frameCache = [];
    /** 缓存中有效帧数量（<= maxCacheFrames） */
    this._frameCacheCount = 0;
    /** 下一帧写入位置（环形索引） */
    this._frameCacheWriteIdx = 0;
    /** 上次采集帧的 performance.now() 时刻 */
    this._lastCaptureTime = 0;
    /** rewind 阶段浮点游标（从 frameCount-1 向 0 递减，支持插值） */
    this._rewindCursor = 0;
    /** rewind 阶段每毫秒消耗的帧索引步长 */
    this._rewindStepPerMs = 0;
    /** rewind 阶段上次时间戳 */
    this._lastRewindTime = 0;
    /** 首轮采集是否完成（完成后纯缓存回放，重试时复用） */
    this._captureComplete = false;

    this._initCanvas();
  }

  // =================== 内部画布 ===================

  /** 创建一个覆盖在 video 上方的 canvas */
  _initCanvas() {
    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText =
      'position:absolute;pointer-events:none;display:none;';
    // 插到 video 的父元素中
    if (this._video.parentElement) {
      this._video.parentElement.style.position = 'relative';
      this._video.parentElement.appendChild(this._canvas);
    }
    this._ctx = this._canvas.getContext('2d');

    // 窗口大小变化时重新定位画布
    this._onResize = () => {
      this._positionCanvas();
      // 慢镜头活跃时重绘当前帧到新尺寸画布
      if (this._slowmoActive && this._frameCacheCount > 0) {
        const frames = this._getOrderedFrames();
        if (frames.length > 0) {
          const last = frames[frames.length - 1];
          this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
          this._ctx.drawImage(last, 0, 0, this._canvas.width, this._canvas.height);
        }
      }
    };
    window.addEventListener('resize', this._onResize);
  }

  /**
   * 根据视频实际尺寸设置画布像素大小，
   * 并定位画布使其精确覆盖 video 的 object-fit:contain 渲染区域
   */
  _resizeCanvas() {
    const { width, height } = calcCaptureSize(
      this._video.videoWidth,
      this._video.videoHeight,
      SLOWMO_CONFIG.maxImageSide,
    );
    this._canvas.width = width;
    this._canvas.height = height;
    this._positionCanvas();
  }

  /**
   * 将画布 CSS 尺寸和位置对齐到 video 的 object-fit:contain 渲染区域，
   * 使画布完全覆盖视频画面而不出现条纹
   */
  _positionCanvas() {
    const container = this._video.parentElement;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const vw = this._video.videoWidth || cw;
    const vh = this._video.videoHeight || ch;
    // 计算 object-fit:contain 渲染区域
    const scale = Math.min(cw / vw, ch / vh);
    const renderW = vw * scale;
    const renderH = vh * scale;
    const offsetX = (cw - renderW) / 2;
    const offsetY = (ch - renderH) / 2;
    this._canvas.style.left = offsetX + 'px';
    this._canvas.style.top = offsetY + 'px';
    this._canvas.style.width = renderW + 'px';
    this._canvas.style.height = renderH + 'px';
  }

  _showCanvas() {
    this._canvas.style.display = 'block';
  }

  _hideCanvas() {
    this._canvas.style.display = 'none';
  }

  // =================== 基础播放 ===================

  get currentTime() {
    if (this._isYouTube) {
      return this._ytReady ? (this._ytPlayer.getCurrentTime() || 0) : (this._ytLastTime || 0);
    }
    return this._video.currentTime;
  }

  set currentTime(t) {
    if (this._isYouTube) {
      if (this._ytReady) this._ytPlayer.seekTo(t, true);
      this._ytLastTime = t;
      return;
    }
    this._video.currentTime = t;
  }

  get duration() {
    if (this._isYouTube) {
      return this._ytReady ? (this._ytPlayer.getDuration() || 0) : 0;
    }
    return this._video.duration;
  }

  get paused() {
    if (this._isYouTube) return this._ytPaused;
    return this._video.paused;
  }

  /**
   * 设置视频源。如果是 YouTube URL 则切换到 IFrame Player 模式。
   * @param {string} url
   */
  setSource(url) {
    const ytId = parseYouTubeId(url);
    if (ytId) {
      this._enableYouTubeMode(ytId);
    } else {
      this._disableYouTubeMode();
      this._video.src = url;
    }
  }

  /**
   * 播放。首次调用时始终显示"点击播放"遮罩，
   * 确保 PC 和移动端体验一致；用户点击后后续 play() 直接播放。
   */
  async play() {
    if (this._isYouTube) this._ytDesiredPaused = false;
    if (!this._userHasPlayed) {
      this._showTapOverlay();
      return;
    }
    if (this._isYouTube) {
      await this._ytReadyPromise;
      try { this._ytPlayer.playVideo(); } catch (_) {}
      return;
    }
    try {
      await this._video.play();
    } catch (e) {
      console.warn('[VideoCtrl] play blocked:', e.message);
      this._showTapOverlay();
    }
  }

  /** 显示"点击播放"遮罩 */
  _showTapOverlay() {
    const overlay = document.getElementById('tapPlayOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    // 仅绑定一次
    if (!this._tapBound) {
      this._tapBound = true;
      const handler = async () => {
        if (this._isYouTube) {
          try {
            await this._ytReadyPromise;
            this._ytPlayer.playVideo();
          } catch (err) {
            console.warn('[VideoCtrl] YT manual play failed:', err && err.message);
            return;
          }
          this._userHasPlayed = true;
          this._hideTapOverlay();
          return;
        }
        try {
          await this._video.play();
        } catch (_) {
          // 降级：先静音播放再恢复
          try {
            this._video.muted = true;
            await this._video.play();
            this._video.muted = false;
          } catch (err) {
            console.warn('[VideoCtrl] manual play failed:', err.message);
            return;
          }
        }
        this._userHasPlayed = true;
        this._hideTapOverlay();
      };
      overlay.addEventListener('click', handler);
    }
  }

  /** 隐藏"点击播放"遮罩 */
  _hideTapOverlay() {
    const overlay = document.getElementById('tapPlayOverlay');
    if (overlay) overlay.classList.add('hidden');
  }

  /**
   * 暂停
   */
  pause() {
    if (this._isYouTube) {
      this._ytDesiredPaused = true;
      if (this._ytReady) { try { this._ytPlayer.pauseVideo(); } catch (_) {} }
      return;
    }
    this._video.pause();
  }

  /**
   * 跳转到指定时间
   * @param {number} time - 秒
   */
  seekTo(time) {
    if (this._isYouTube) {
      if (this._ytReady) this._ytPlayer.seekTo(time, true);
      this._ytLastTime = time;
      return;
    }
    this._video.currentTime = time;
  }

  /**
   * 设置音量
   * @param {number} level - 0~1
   */
  setVolume(level) {
    const v = Math.max(0, Math.min(1, level));
    if (this._isYouTube) {
      if (this._ytReady) {
        try {
          this._ytPlayer.setVolume(Math.round(v * 100));
          if (v <= 0) this._ytPlayer.mute(); else this._ytPlayer.unMute();
        } catch (_) {}
      }
      return;
    }
    this._video.volume = v;
  }

  /**
   * 设置播放速率
   * @param {number} rate
   */
  setPlaybackRate(rate) {
    if (this._isYouTube) {
      this._ytRate = rate;
      if (this._ytReady) { try { this._ytPlayer.setPlaybackRate(rate); } catch (_) {} }
      return;
    }
    this._video.playbackRate = rate;
  }

  /**
   * 监听视频事件。事件总是从底层 <video> 元素分发：
   *   YouTube 模式下由轮询循环合成 'timeupdate' / 'play' / 'pause' /
   *   'ended' / 'loadedmetadata' 事件并 dispatchEvent 到 <video>。
   * @param {string} event
   * @param {Function} cb
   */
  on(event, cb) {
    this._video.addEventListener(event, cb);
  }

  /**
   * 移除视频事件
   * @param {string} event
   * @param {Function} cb
   */
  off(event, cb) {
    this._video.removeEventListener(event, cb);
  }

  // =================== YouTube 模式 ===================

  /**
   * 切换到 YouTube IFrame Player 模式。
   * @param {string} videoId
   */
  _enableYouTubeMode(videoId) {
    this._isYouTube = true;
    // 隐藏原生 <video>，避免占用空间和接受点击
    this._video.style.display = 'none';
    this._video.removeAttribute('src');
    try { this._video.load(); } catch (_) {}

    const parent = this._video.parentElement;
    if (!parent) return;

    // 复用或新建 iframe 容器
    if (!this._ytContainer) {
      this._ytContainer = document.createElement('div');
      this._ytContainer.id = 'ytPlayerContainer';
      this._ytContainer.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;background:#000;';
      const inner = document.createElement('div');
      inner.id = 'ytPlayerInner';
      inner.style.cssText = 'width:100%;height:100%;';
      this._ytContainer.appendChild(inner);
      parent.style.position = parent.style.position || 'relative';
      parent.insertBefore(this._ytContainer, this._video);
    }
    this._ytContainer.style.display = 'block';

    // 销毁旧 player
    if (this._ytPlayer) {
      try { this._ytPlayer.destroy(); } catch (_) {}
      this._ytPlayer = null;
      this._ytReady = false;
    }

    this._ytReadyPromise = loadYouTubeIframeAPI().then((YT) => new Promise((resolve) => {
      this._ytPlayer = new YT.Player('ytPlayerInner', {
        videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          controls: 0,
          disablekb: 1,
        },
        events: {
          onReady: () => {
            this._ytReady = true;
            try { this._ytPlayer.setPlaybackRate(this._ytRate); } catch (_) {}
            // 触发 loadedmetadata 让外部读取 duration
            try { this._video.dispatchEvent(new Event('loadedmetadata')); } catch (_) {}
            this._startYouTubePolling();
            resolve();
          },
          onStateChange: (e) => this._onYouTubeStateChange(e),
        },
      });
    }));
  }

  /** 关闭 YouTube 模式，恢复原生 <video> 播放路径。 */
  _disableYouTubeMode() {
    if (!this._isYouTube) return;
    this._isYouTube = false;
    this._stopYouTubePolling();
    if (this._ytPlayer) {
      try { this._ytPlayer.destroy(); } catch (_) {}
      this._ytPlayer = null;
    }
    this._ytReady = false;
    if (this._ytContainer) this._ytContainer.style.display = 'none';
    this._video.style.display = '';
  }

  _startYouTubePolling() {
    this._stopYouTubePolling();
    this._ytLastTime = -1;
    this._ytPollTimer = setInterval(() => {
      if (!this._ytReady || !this._ytPlayer) return;
      let t = 0;
      try { t = this._ytPlayer.getCurrentTime() || 0; } catch (_) {}
      if (t !== this._ytLastTime) {
        this._ytLastTime = t;
        try { this._video.dispatchEvent(new Event('timeupdate')); } catch (_) {}
      }
    }, 100); // 10 Hz: 与 <video> timeupdate 频率相当
  }

  _stopYouTubePolling() {
    if (this._ytPollTimer) {
      clearInterval(this._ytPollTimer);
      this._ytPollTimer = null;
    }
  }

  _onYouTubeStateChange(e) {
    const YTState = (window.YT && window.YT.PlayerState) || {};
    const s = e.data;
    this._ytLastState = s;
    if (s === YTState.PLAYING) {
      this._ytPaused = false;
      // 外部期望暂停时，重新下发暂停（拦截用户点击 iframe 触发的意外播放）。
      if (this._ytDesiredPaused) {
        try { this._ytPlayer.pauseVideo(); } catch (_) {}
        return;
      }
      try { this._video.dispatchEvent(new Event('play')); } catch (_) {}
    } else if (s === YTState.PAUSED) {
      this._ytPaused = true;
      try { this._video.dispatchEvent(new Event('pause')); } catch (_) {}
    } else if (s === YTState.ENDED) {
      this._ytPaused = true;
      try { this._video.dispatchEvent(new Event('ended')); } catch (_) {}
    }
  }

  // =================== 慢镜头特效（帧缓存版） ===================

  /**
   * 进入慢镜头循环
   * forward: 以 slowRate 播放视频 + 每 1/captureFPS 秒采集一帧存入环形缓存
   * rewind:  暂停视频，从缓存倒序播放帧图片
   */
  enterSlowMotion() {
    if (this._slowmoActive) return;
    this._slowmoActive = true;
    this._dubbingStartTime = this.currentTime;

    // YouTube 模式：跨域 iframe 无法被 canvas 采样，简化为暂停 + 静音
    if (this._isYouTube) {
      this._overlay.classList.remove('hidden');
      this.setVolume(0);
      this.pause();
      return;
    }

    // 仅首次采集时初始化帧缓存；重试时复用已有缓存
    if (!this._captureComplete) {
      this._resetFrameCache();
    }
    this._resizeCanvas();

    // 显示遮罩
    this._overlay.classList.remove('hidden');

    // 完全静音视频（录音期间避免干扰麦克风）
    this.setVolume(0);

    // 始终显示画布覆盖视频
    this._showCanvas();

    // forward 阶段浮点游标（用于插值显示已缓存帧）
    this._forwardDisplayCursor = 0;
    this._lastForwardDisplayTime = 0;

    // 开始慢放前进
    this._startForwardPhase();
    this._runSlowMotionLoop();
  }

  /**
   * 退出慢镜头
   */
  exitSlowMotion() {
    if (!this._slowmoActive) return;
    this._slowmoActive = false;
    this._slowmoPhase = 'idle';

    if (this._slowmoRAF) {
      cancelAnimationFrame(this._slowmoRAF);
      this._slowmoRAF = null;
    }

    // YouTube 模式：恢复音量并继续播放，无 canvas 需要清理
    if (this._isYouTube) {
      this._overlay.classList.add('hidden');
      this.setVolume(SLOWMO_CONFIG.normalVolume);
      this.setPlaybackRate(1.0);
      // 由调用方决定是否 play()——保持与 <video> 模式一致行为
      return;
    }

    // 输出最后一帧的采集日志
    if (this._lastCaptureLog) {
      console.log(this._lastCaptureLog);
      this._lastCaptureLog = null;
    }

    // 隐藏遮罩和画布
    this._overlay.classList.add('hidden');
    this._hideCanvas();

    // 恢复正常
    this.setVolume(SLOWMO_CONFIG.normalVolume);
    this.setPlaybackRate(1.0);

    // 保留帧缓存供重试时复用，由 clearFrameCache() 在新句子开始时显式释放
  }

  /**
   * 释放帧缓存并重置采集状态，在新句子开始时调用
   */
  clearFrameCache() {
    this._releaseFrameCache();
    this._captureComplete = false;
  }

  // ---- 帧缓存管理 ----

  _resetFrameCache() {
    this._releaseFrameCache();
    const max = SLOWMO_CONFIG.maxCacheFrames;
    this._frameCache = new Array(max).fill(null);
    this._frameCacheCount = 0;
    this._frameCacheWriteIdx = 0;
    this._lastCaptureTime = 0;
  }

  _releaseFrameCache() {
    for (let i = 0; i < this._frameCache.length; i++) {
      if (this._frameCache[i] && typeof this._frameCache[i].close === 'function') {
        this._frameCache[i].close(); // ImageBitmap.close()
      }
      this._frameCache[i] = null;
    }
    this._frameCacheCount = 0;
    this._frameCacheWriteIdx = 0;
  }

  /**
   * 从视频当前帧采集一帧到环形缓存（异步，使用 createImageBitmap）
   */
  async _captureFrame() {
    const t0 = performance.now();
    const videoTime = this._video.currentTime;
    try {
      // 有些浏览器在 video 暂停或未 ready 时会抛异常
      if (this._video.readyState < 2) {
        console.log(`[SlowMo] capture skipped: readyState=${this._video.readyState}`);
        return;
      }
      const { width, height } = calcCaptureSize(
        this._video.videoWidth,
        this._video.videoHeight,
        SLOWMO_CONFIG.maxImageSide,
      );
      const bitmap = await createImageBitmap(this._video, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'low',
      });
      const idx = this._frameCacheWriteIdx;
      // 释放旧帧
      if (this._frameCache[idx] && typeof this._frameCache[idx].close === 'function') {
        this._frameCache[idx].close();
      }
      this._frameCache[idx] = bitmap;
      this._frameCacheWriteIdx = (idx + 1) % SLOWMO_CONFIG.maxCacheFrames;
      if (this._frameCacheCount < SLOWMO_CONFIG.maxCacheFrames) {
        this._frameCacheCount++;
      }
      this._lastCaptureLog = `[SlowMo] captured frame #${this._frameCacheCount} @ videoTime=${videoTime.toFixed(3)}s` +
        ` | size=${width}x${height} | took=${(performance.now() - t0).toFixed(1)}ms | slot=${idx}`;
    } catch (e) {
      console.warn(`[SlowMo] capture failed @ videoTime=${videoTime.toFixed(3)}s:`, e.message);
    }
  }

  /**
   * 返回缓存帧的有序数组（从最旧到最新）
   * @returns {ImageBitmap[]}
   */
  _getOrderedFrames() {
    const max = SLOWMO_CONFIG.maxCacheFrames;
    const count = this._frameCacheCount;
    const writeIdx = this._frameCacheWriteIdx;
    const result = [];
    // 最旧帧在 writeIdx（若已满），否则在 0
    const startIdx = count < max ? 0 : writeIdx;
    for (let i = 0; i < count; i++) {
      const idx = (startIdx + i) % max;
      if (this._frameCache[idx]) {
        result.push(this._frameCache[idx]);
      }
    }
    return result;
  }

  // ---- 阶段切换 ----

  /**
   * 实际采集帧率 = originalFPS × slowRate（视频帧在屏幕上出现的速率）
   * @returns {number} 每秒采集帧数
   */
  _getCaptureFPS() {
    return SLOWMO_CONFIG.originalFPS * SLOWMO_CONFIG.slowRate;
  }

  _startForwardPhase() {
    this._slowmoPhase = 'forward';
    this._slowmoPhaseStart = performance.now();
    this._lastForwardDisplayTime = performance.now();
    // 画布始终可见
    this._showCanvas();

    if (this._captureComplete) {
      // 后续轮次：视频已停，纯缓存回放，游标从 0 开始
      this._forwardDisplayCursor = 0;
      // 步进速率：在 forwardDuration 内走完所有帧
      const count = this._frameCacheCount;
      this._forwardStepPerMs = count > 1 ? (count - 1) / SLOWMO_CONFIG.forwardDuration : 0;
    } else {
      // 首轮：暂停视频，逐帧采集（capture-then-step，避免运动中采集导致抖动）
      this._forwardDisplayCursor = 0;
      this._forwardStepPerMs = 0; // 由 _drawForwardFrame 按采集速率推进
      this._lastCaptureTime = performance.now();
      this._video.pause();
      // 每次采集后视频前进的时间步长（秒）
      this._videoTimeStep = 1 / SLOWMO_CONFIG.originalFPS;
      // 标记是否正在进行采集+步进（防止并发）
      this._capturing = false;
    }
  }

  _startRewindPhase() {
    this._slowmoPhase = 'rewind';
    this._slowmoPhaseStart = performance.now();

    // 首轮采集完成 → 停止视频，后续纯缓存回放
    if (!this._captureComplete) {
      this._captureComplete = true;
    }
    this._video.pause();

    // 准备倒序帧列表
    this._rewindFrames = this._getOrderedFrames();
    // 浮点游标，从最后一帧开始向 0 递减，支持分数索引插值
    this._rewindCursor = this._rewindFrames.length - 1;
    // 回放速度：用与 forward 相同的挂钟时间播完所有帧
    const totalFrames = this._rewindFrames.length;
    const rewindWallMs = SLOWMO_CONFIG.forwardDuration;
    // 每毫秒消耗的帧索引步长
    this._rewindStepPerMs = totalFrames > 1 ? (totalFrames - 1) / rewindWallMs : 0;
    this._lastRewindTime = performance.now();
  }

  // ---- 插值绘制 ----

  /**
   * 在 canvas 上绘制两帧之间的交叉淡入插值
   * @param {ImageBitmap} frameA
   * @param {ImageBitmap} frameB
   * @param {number} t - 0~1，0 = 全 A，1 = 全 B
   */
  _drawInterpolated(frameA, frameB, t) {
    const w = this._canvas.width;
    const h = this._canvas.height;
    this._ctx.clearRect(0, 0, w, h);
    if (!frameB || t <= 0) {
      this._ctx.globalAlpha = 1;
      this._ctx.drawImage(frameA, 0, 0, w, h);
    } else if (!frameA || t >= 1) {
      this._ctx.globalAlpha = 1;
      this._ctx.drawImage(frameB, 0, 0, w, h);
    } else {
      // 先画底层帧 A
      this._ctx.globalAlpha = 1;
      this._ctx.drawImage(frameA, 0, 0, w, h);
      // 再用 alpha 混合帧 B
      this._ctx.globalAlpha = t;
      this._ctx.drawImage(frameB, 0, 0, w, h);
      this._ctx.globalAlpha = 1;
    }
  }

  // ---- 主循环 ----

  /**
   * forward 阶段：在画布上用插值显示已缓存的帧
   * 游标随采集速率前进，新帧被采集后游标自动跟进
   */
  _drawForwardFrame(now) {
    const count = this._frameCacheCount;
    if (count === 0) return; // 尚无缓存帧，视频在下方可见

    const dt = now - this._lastForwardDisplayTime;
    this._lastForwardDisplayTime = now;

    if (this._captureComplete) {
      // 后续轮次：按固定步长匀速遍历所有缓存帧
      this._forwardDisplayCursor += this._forwardStepPerMs * dt;
    } else {
      // 首轮：在已采集帧之间平滑插值推进
      // 步进速率 = 每采集间隔推进一帧索引，换算为每毫秒的步长
      const captureInterval = 1000 / this._getCaptureFPS();
      const stepPerMs = captureInterval > 0 ? 1 / captureInterval : 0;
      this._forwardDisplayCursor += stepPerMs * dt;
      // 不超过最新已采集帧
      const maxFirst = Math.max(0, this._frameCacheCount - 1);
      if (this._forwardDisplayCursor > maxFirst) {
        this._forwardDisplayCursor = maxFirst;
      }
    }

    // 限制游标不超过已有帧
    const maxIdx = count - 1;
    if (this._forwardDisplayCursor > maxIdx) {
      this._forwardDisplayCursor = maxIdx;
    }

    const cursor = this._forwardDisplayCursor;
    const frames = this._getOrderedFrames();
    if (frames.length === 0) return;

    const idxA = Math.min(Math.floor(cursor), frames.length - 1);
    const idxB = Math.min(idxA + 1, frames.length - 1);
    const t = cursor - Math.floor(cursor);
    this._drawInterpolated(frames[idxA], frames[idxB], t);
  }

  _runSlowMotionLoop() {
    if (!this._slowmoActive) return;

    // 每帧重新定位画布，确保窗口拖拽/缩放时画布跟随视频
    this._positionCanvas();

    const now = performance.now();

    if (this._slowmoPhase === 'forward') {
      // 首轮：逐帧采集（先 capture 当前静止帧，再 step 到下一帧）
      if (!this._captureComplete) {
        const captureInterval = 1000 / this._getCaptureFPS();
        if (!this._capturing && now - this._lastCaptureTime >= captureInterval) {
          this._lastCaptureTime = now;
          this._capturing = true;
          this._captureFrame().then(() => {
            // 采集完成后，步进视频到下一帧位置
            this._video.currentTime += this._videoTimeStep;
            this._capturing = false;
          }).catch(() => {
            this._capturing = false;
          });
        }
      }

      // 在画布上用插值显示已缓存帧（平滑慢动作）
      this._drawForwardFrame(now);

      // forward 阶段持续 forwardDuration 后切 rewind
      if (now - this._slowmoPhaseStart >= SLOWMO_CONFIG.forwardDuration) {
        this._startRewindPhase();
      }
    } else if (this._slowmoPhase === 'rewind') {
      const frames = this._rewindFrames;
      if (!frames || frames.length === 0) {
        this._rewindFrames = null;
        this._startForwardPhase();
      } else {
        // 按挂钟时间推进浮点游标
        const dt = now - this._lastRewindTime;
        this._lastRewindTime = now;
        this._rewindCursor -= this._rewindStepPerMs * dt;

        if (this._rewindCursor <= 0) {
          // 画第一帧，然后循环回 forward
          const first = frames[0];
          if (first) {
            this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            this._ctx.drawImage(first, 0, 0, this._canvas.width, this._canvas.height);
          }
          this._rewindFrames = null;
          this._startForwardPhase();
        } else {
          // 插值：idxA 是整数下标，t 是分数部分
          const idxA = Math.floor(this._rewindCursor);
          const t = this._rewindCursor - idxA;
          const idxB = Math.min(idxA + 1, frames.length - 1);
          this._drawInterpolated(frames[idxA], frames[idxB], t);
        }
      }
    }

    this._slowmoRAF = requestAnimationFrame(() => this._runSlowMotionLoop());
  }

  // =================== 重试预览 ===================

  /**
   * 播放配音段前 N 秒预览（带声音），然后回调
   * @param {number} startTime - 配音段开始时间
   * @param {Function} onPreviewEnd - 预览结束回调
   */
  playRetryPreview(startTime, onPreviewEnd) {
    const previewStart = Math.max(0, startTime - SLOWMO_CONFIG.retryPreviewSeconds);
    this.seekTo(previewStart);
    // 重试预览期间保持低音量（麦克风开启，避免干扰录音）
    this.setVolume(SLOWMO_CONFIG.dubbingVolume);
    this.setPlaybackRate(1.0);

    const checkEnd = () => {
      if (this._video.currentTime >= startTime) {
        this._video.removeEventListener('timeupdate', checkEnd);
        onPreviewEnd();
      }
    };

    this._video.addEventListener('timeupdate', checkEnd);
    this.play();
  }

  /**
   * 销毁
   */
  destroy() {
    this.exitSlowMotion();
    this._releaseFrameCache();
    if (this._canvas && this._canvas.parentElement) {
      this._canvas.parentElement.removeChild(this._canvas);
    }
    this._canvas = null;
    this._ctx = null;
    this._video.pause();
    this._video.removeAttribute('src');
    this._video.load();
  }
}
