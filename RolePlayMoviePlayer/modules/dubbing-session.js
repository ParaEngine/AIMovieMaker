// =================== 影视配音秀 — 配音会话管理 ===================

import { PROMPTS } from '../config.js';

/**
 * 封装 DigitalHumanFrame 的配音判断会话
 * 负责：初始化 DHF、发送 prompt、收集 ASR、解析 LLM 判断
 */
export class DubbingSession {
  /**
   * @param {HTMLElement} container - DHF 挂载容器
   */
  constructor(container) {
    this._container = container;
    this._dhf = null;
    this._sdk = null;
    this._initialized = false;
    this._currentCue = null;
    this._onAsrUpdate = null;    // ASR 实时文字回调
    this._onJudgeResult = null;  // LLM 判断结果回调
    this._onAssistantText = null; // AI 助手文字回调
    this._collectingUserSpeech = '';
    this._waitingForJudgment = false;
    this._pendingResult = null;     // 待触发的 PASS/FAIL 结果（等语音播完）
    this._voiceTimer = null;        // 等待语音播放结束的定时器
    this._aiSpeaking = false;       // AI 是否正在说话
    this._userRecording = false;     // 用户是否正在录音（ASR 活跃）
    this._userRecordingTimer = null; // 用户录音超时定时器
    this._onSpeakingStateChange = null; // AI 说话状态回调
    this._onRecordingStateChange = null; // 用户录音状态回调
  }

  // =================== 初始化 ===================

  /**
   * 初始化 DigitalHumanFrame
   * @param {Object} options
   * @param {string} [options.configUrl] - 远程配置 URL
   * @param {Object} [options.config] - 本地配置对象
   */
  async init(options = {}) {
    // 检查 KeepworkSDK 是否可用
    if (typeof window.keepwork === 'undefined' || !window.DigitalHumanFrame) {
      console.warn('[DubbingSession] KeepworkSDK 或 DigitalHumanFrame 不可用');
      this._initialized = false;
      return;
    }

    this._sdk = window.keepwork;

    try {
      this._dhf = new window.DigitalHumanFrame({
        sdk: this._sdk,
        container: this._container,
        useExternalHtml: true,
        proxyCategories: ['story'],
      });

      if (options.configUrl) {
        await this._dhf.loadConfig(options.configUrl);
      } else if (options.config) {
        await this._dhf.initFromConfig(options.config);
      } else {
        // 使用默认配置
        await this._dhf.initFromConfig({
          character: { name: '配音教练' },
          llm_model: 'keepwork-flash',
          voiceChat: {},
        });
      }

      // 监听字幕事件（始终监听，包括初始问候）
      this._dhf.on('subtitle', (data) => this._handleSubtitle(data));

      // 监听 AI 说话状态（文本 TTS 生命周期）
      this._dhf.on('textSpeechStart', () => this._setAiSpeaking(true));
      this._dhf.on('textSpeechEnd', () => this._onAiSpeechFinished());
      this._dhf.on('textSpeechCanceled', () => this._onAiSpeechFinished());

      // 监听语音通道状态（RTC voiceChat 生命周期）
      // SPEAKING=3 → AI说话中, FINISHED=5/INTERRUPTED=4 → AI说完
      this._dhf.on('voiceChatState', (data) => {
        console.log(`[DubbingSession] voiceChatState: code=${data.code} label=${data.label}`);
        if (data.code === 3) {          // SPEAKING
          this._setAiSpeaking(true);
        } else if (data.code === 5 || data.code === 4) {  // FINISHED / INTERRUPTED
          this._onAiSpeechFinished();
        }
      });

      this._initialized = true;
      console.log('[DubbingSession] DHF 初始化完成');
    } catch (e) {
      console.error('[DubbingSession] DHF 初始化失败:', e);
      this._initialized = false;
    }
  }

  /**
   * 启动语音通道
   */
  async startVoiceChat() {
    if (!this._initialized || !this._dhf) return;
    try {
      await this._dhf.startVoiceChat();
      // 默认 mute
      this._dhf.muteMicrophone(true);
    } catch (e) {
      console.error('[DubbingSession] 启动语音失败:', e);
    }
  }

  /**
   * 停止语音通道
   */
  async stopVoiceChat() {
    this.stopDubbing();
    if (!this._dhf) return;
    try {
      await this._dhf.stopVoiceChat();
    } catch (e) {
      console.warn('[DubbingSession] 停止语音失败:', e);
    }
  }

  // =================== 配音流程 ===================

  /**
   * 开始一次配音
   * @param {import('./story-config-loader.js').SubtitleTrack} track - 字幕轨
   * @param {Function} onAsrUpdate - ASR 实时更新回调 (text: string)
   * @param {Function} onJudgeResult - LLM 判断回调 ({pass: boolean, message: string})
   */
  startDubbing(track, skipContext, onAsrUpdate, onJudgeResult) {
    this._currentCue = track;
    this._onAsrUpdate = onAsrUpdate;
    this._onJudgeResult = onJudgeResult;
    this._collectingUserSpeech = '';
    this._waitingForJudgment = false;
    this._clearPendingResult();

    if (!this._initialized || !this._dhf) {
      console.warn('[DubbingSession] DHF 未初始化，无法配音');
      return;
    }

    // 重试时跳过 sendContext（LLM 历史中已有句子信息），除非需要刷新上下文
    if (skipContext) {
      console.log('[DubbingSession] 跳过 sendContext（重试中）');
      return;
    }
    const context = PROMPTS.judgeDubbing(track);
    console.log('[DubbingSession] sendContext:', context);
    this._dhf.sendContext(context);
  }

  /**
   * 设置 AI 助手文字回调（全局，不受配音开始/停止影响）
   * @param {Function} callback - (text: string, definite: boolean) => void
   */
  onAssistantText(callback) {
    this._onAssistantText = callback;
  }

  /**
   * 设置 AI 说话状态变化回调
   * @param {Function} callback - (speaking: boolean) => void
   */
  onSpeakingStateChange(callback) {
    this._onSpeakingStateChange = callback;
  }

  /** AI 是否正在说话 */
  get aiSpeaking() {
    return this._aiSpeaking;
  }

  /**
   * 设置用户录音状态变化回调
   * @param {Function} callback - (recording: boolean) => void
   */
  onRecordingStateChange(callback) {
    this._onRecordingStateChange = callback;
  }

  /** 用户是否正在录音 */
  get userRecording() {
    return this._userRecording;
  }

  /**
   * 停止当前配音
   */
  stopDubbing() {
    this._currentCue = null;
    this._onAsrUpdate = null;
    this._onJudgeResult = null;
    this._collectingUserSpeech = '';
    this._waitingForJudgment = false;
    this._clearPendingResult();
    this._setUserRecording(false);
  }

  /**
   * 重置判断状态以准备重试，保留 ASR 回调和 currentCue
   * 这样在 retry 等待期间到达的 subtitle 事件仍然会更新 UI
   */
  resetForRetry() {
    this._collectingUserSpeech = '';
    this._waitingForJudgment = false;
    this._clearPendingResult();
  }

  /**
   * 静音麦克风（影片播放时调用）
   */
  muteMic() {
    if (this._initialized && this._dhf) {
      console.log('[DubbingSession] muteMic: 静音麦克风');
      this._dhf.muteMicrophone(true);
    }
  }

  /**
   * 解除麦克风静音（用户配音时调用）
   */
  unmuteMic() {
    if (this._initialized && this._dhf) {
      console.log('[DubbingSession] unmuteMic: 解除麦克风静音');
      this._dhf.muteMicrophone(false);
    }
  }

  // =================== 事件处理 ===================

  /**
   * 处理 DHF subtitle 事件
   * @param {Object} data - {isUser, text, definite}
   */
  _handleSubtitle(data) {
    if (data.definite) {
      console.log('[DubbingSession] subtitle事件:', data.isUser ? '用户' : 'AI', `definite=${!!data.definite}`, JSON.stringify(data.text || ''));
    }
    if (data.isUser) {
      // 用户语音 ASR（仅在配音中处理）
      if (!this._currentCue) return;
      this._collectingUserSpeech = data.text || '';
      // 有 ASR 文本 → 标记用户录音中
      this._setUserRecording(true);
      if (this._onAsrUpdate) {
        this._onAsrUpdate(this._collectingUserSpeech);
      }
      // 用户打断：清除待处理结果，等待下一次 AI 回复重新判断
      if (this._pendingResult) {
        console.log('[DubbingSession] 用户打断，清除待处理结果，等待下一次 AI 回复');
        this._clearPendingResult();
      }
    } else {
      // AI 回复 — 始终通知助手文字回调
      const aiText = (data.text || '').trim();
      if (!aiText) return;

      if (this._onAssistantText) {
        this._onAssistantText(aiText, !!data.definite);
      }

      // 配音中 + 尚未判定 + 文本已确定 → 解析并等语音播完再触发
      if (this._currentCue && !this._waitingForJudgment && data.definite) {
        const result = this._parseLLMJudgment(aiText);
        if (result) {
          this._pendingResult = result;
          this._scheduleResultCallback(aiText);
        }
      }
    }
  }

  /**
   * 等待助手语音播放完毕后触发判断回调
   * 如果有 textSpeechEnd/audioLevel 事件，由 _onAiSpeechFinished 直接触发。
   * 作为兜底仍保留估算定时器（最长 4s）。
   * @param {string} fullText
   */
  _scheduleResultCallback(fullText) {
    // 去掉括号内容，估算实际语音文本长度
    const spokenText = fullText.replace(/\([^)]*\)/g, '').trim();
    const estimatedMs = Math.max(500, Math.min(2000, spokenText.length * 150));
    console.log(`[DubbingSession] 等待语音 ${estimatedMs}ms 后触发结果 (spoken="${spokenText}")`);

    this._voiceTimer = setTimeout(() => {
      this._voiceTimer = null;
      this._fireResultCallback();
    }, estimatedMs);
  }

  /** 触发待处理的判断结果（仅触发一次） */
  _fireResultCallback() {
    if (this._pendingResult && this._onJudgeResult && !this._waitingForJudgment) {
      this._waitingForJudgment = true;
      const result = this._pendingResult;
      this._pendingResult = null;
      this._clearPendingResult();
      this._onJudgeResult(result);
    }
  }

  /** @private 更新 AI 说话状态 */
  _setAiSpeaking(speaking) {
    console.log(`[DubbingSession] _setAiSpeaking: ${this._aiSpeaking} → ${speaking}`);
    if (this._aiSpeaking === speaking) return;
    this._aiSpeaking = speaking;
    if (this._onSpeakingStateChange) {
      this._onSpeakingStateChange(speaking);
    }
  }

  /** @private 更新用户录音状态（ASR 活跃时为 true，无词 1.5s 后自动回 false） */
  _setUserRecording(recording) {
    if (this._userRecordingTimer) {
      clearTimeout(this._userRecordingTimer);
      this._userRecordingTimer = null;
    }
    if (recording) {
      if (!this._userRecording) {
        this._userRecording = true;
        if (this._onRecordingStateChange) this._onRecordingStateChange(true);
      }
      // ASR 无新文本 1.5s 后自动回到等待状态
      this._userRecordingTimer = setTimeout(() => {
        this._userRecordingTimer = null;
        this._userRecording = false;
        if (this._onRecordingStateChange) this._onRecordingStateChange(false);
      }, 1500);
    } else {
      if (this._userRecording) {
        this._userRecording = false;
        if (this._onRecordingStateChange) this._onRecordingStateChange(false);
      }
    }
  }

  /** @private AI 语音播放结束 — 立即触发待处理结果 */
  _onAiSpeechFinished() {
    this._setAiSpeaking(false);
    // AI 语音播完，立即触发待处理的判断结果（取消兜底定时器）
    if (this._pendingResult) {
      console.log('[DubbingSession] AI 语音结束，立即触发结果回调');
      if (this._voiceTimer) {
        clearTimeout(this._voiceTimer);
        this._voiceTimer = null;
      }
      this._fireResultCallback();
    }
  }

  /**
   * 清除待处理结果和语音等待定时器
   */
  _clearPendingResult() {
    this._pendingResult = null;
    if (this._voiceTimer) {
      clearTimeout(this._voiceTimer);
      this._voiceTimer = null;
    }
  }

  /**
   * 解析 LLM 判断结果 — 从括号文本中搜索 (PASS...) 或 (FAIL...)
   * @param {string} text
   * @returns {{pass: boolean, message: string}|null}
   */
  _parseLLMJudgment(text) {
    // 搜索 (PASS...) 或 (FAIL...) 括号标记
    const passMatch = text.match(/\(PASS[^)]*\)/i);
    if (passMatch) {
      const msg = text.replace(/\(PASS[^)]*\)/i, '').trim() || '很棒！';
      return { pass: true, message: msg };
    }
    const failMatch = text.match(/\(FAIL[^)]*\)/i);
    if (failMatch) {
      const msg = text.replace(/\(FAIL[^)]*\)/i, '').trim() || '再试一次';
      return { pass: false, message: msg };
    }
    return null;
  }

  // =================== 生命周期 ===================

  /**
   * 通过 DHF 朗读文字（TTS）
   * @param {string} text - 要朗读的文字
   * @param {Object} [options] - sendTTS 选项
   */
  sendTTS(text, options = {}) {
    if (this._initialized && this._dhf) {
      this._dhf.sendTTS(text, options);
    }
  }

  /**
   * 是否可用
   */
  get isAvailable() {
    return this._initialized;
  }

  /**
   * 销毁
   */
  destroy() {
    this.stopDubbing();
    if (this._dhf) {
      this._dhf.destroy();
      this._dhf = null;
    }
    this._initialized = false;
  }
}
