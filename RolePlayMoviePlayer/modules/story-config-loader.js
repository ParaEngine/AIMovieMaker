// =================== 影视配音秀 — JSON 场景配置加载器 ===================

/**
 * @typedef {Object} WordTiming
 * @property {string} text
 * @property {number} startMs
 * @property {number} endMs
 */

/**
 * @typedef {Object} NativeSegment
 * @property {string} text
 * @property {number[]} targetWordIndexes
 * @property {number} [priority]
 */

/**
 * @typedef {Object} SubtitleTrack
 * @property {string} id
 * @property {number} startMs
 * @property {number} endMs
 * @property {number} [dubStartMs]
 * @property {number} [dubEndMs]
 * @property {number} [speakEndMs]
 * @property {number} [nextStartMs]
 * @property {number} [promptWindowStartMs]
 * @property {number} [promptWindowEndMs]
 * @property {boolean} [allowPromptInGap]
 * @property {string} nativeText - 母语参考文本
 * @property {string} targetText - 目标配音文本
 * @property {string} [nativeColor]
 * @property {string} [targetColor]
 * @property {string} [guideAudioSrc]
 * @property {WordTiming[]} [wordTiming]
 * @property {NativeSegment[]} [nativeSegments]
 * @property {string} [gloss] - 释义/文化注解 (L1)
 * @property {string} [ipa] - 国际音标 (L4)
 * @property {Phoneme[]|null} [phonemes] - 音素序列 (L2 音素球)
 */

/**
 * @typedef {Object} Phoneme
 * @property {string} ipa - IPA 符号
 * @property {'vowel'|'consonant'} type
 * @property {number} durationMs
 * @property {number} wordIndex
 * @property {'flat'|'rising'|'falling'} [pitch]
 * @property {boolean} [goldChant]
 */

/**
 * @typedef {Object} Scene
 * @property {string} id
 * @property {string} videoSrc
 * @property {string} [posterSrc]
 * @property {SubtitleTrack[]} subtitleTracks
 */

/**
 * @typedef {Object} StoryConfig
 * @property {string} title
 * @property {string} [description]
 * @property {Scene[]} scenes
 */

/**
 * @typedef {Object} OverlayUnit
 * @property {string} id
 * @property {string} word
 * @property {string} [ipa]
 * @property {string} [translation]
 * @property {{intro: {startMs:number, endMs:number, dubTriggerMs?:number}, movie: {startMs:number, endMs:number, dubTriggerMs?:number}, review: {startMs:number, endMs:number, dubTriggerMs?:number}}} stages
 * @property {SubtitleTrack[]} movieTracks
 */

/**
 * @typedef {Object} OverlayRuntimeConfig
 * @property {number} [videoFrameYOffset]
 * @property {number} [minGapMs]
 * @property {number} [stagePreludeMs]
 * @property {number} [stageChimeMs]
 */

/**
 * @typedef {Object} OverlayConfig
 * @property {string} title
 * @property {string} videoSrc
 * @property {'step2-overlay'} mode
 * @property {'cn-only'|'en-cn'|'hybrid'} [subtitlePlacementMode]
 * @property {OverlayRuntimeConfig} [overlay]
 * @property {OverlayUnit[]} units
 */

/**
 * 加载并解析 JSON 配置文件
 *
 * 角色扮演电影模式下，loader 会预先把翻译后的 StoryConfig 放在
 * `window.__roleplayMovieConfig` 中。如果存在则直接返回，跳过 fetch。
 *
 * @param {string} url - JSON 文件 URL
 * @returns {Promise<StoryConfig|OverlayConfig>}
 */
export async function loadStoryConfig(url) {
  if (typeof window !== 'undefined' && window.__roleplayMovieConfig) {
    const raw = window.__roleplayMovieConfig;
    if (raw.mode === 'step2-overlay') {
      return parseOverlayConfig(raw);
    }
    return parseStoryConfig(raw);
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`加载配置失败: ${resp.status} ${url}`);
  const raw = await resp.json();
  if (raw.mode === 'step2-overlay') {
    return parseOverlayConfig(raw);
  }
  return parseStoryConfig(raw);
}

/**
 * 解析 Step2 Overlay 配置
 * @param {Object} raw
 * @returns {OverlayConfig}
 */
export function parseOverlayConfig(raw) {
  if (!Array.isArray(raw.units)) {
    throw new Error('Overlay 配置格式错误: 缺少 units 数组');
  }
  return {
    title: raw.title || '电影记单词',
    videoSrc: raw.videoSrc || '',
    mode: 'step2-overlay',
    subtitlePlacementMode: raw.subtitlePlacementMode || 'hybrid',
    overlay: {
      videoFrameYOffset: optionalNumber(raw.overlay?.videoFrameYOffset),
      minGapMs: optionalNumber(raw.overlay?.minGapMs),
      stagePreludeMs: optionalNumber(raw.overlay?.stagePreludeMs),
      stageChimeMs: optionalNumber(raw.overlay?.stageChimeMs),
    },
    units: raw.units.map(normalizeOverlayUnit),
  };
}

/**
 * 规范化 overlay unit
 * @param {Object} raw
 * @returns {OverlayUnit}
 */
function normalizeOverlayUnit(raw) {
  const stages = {
    intro: {
      startMs: Number(raw.stages?.intro?.startMs) || 0,
      endMs: Number(raw.stages?.intro?.endMs) || 0,
      dubTriggerMs: optionalNumber(raw.stages?.intro?.dubTriggerMs),
    },
    movie: {
      startMs: Number(raw.stages?.movie?.startMs) || 0,
      endMs: Number(raw.stages?.movie?.endMs) || 0,
      dubTriggerMs: optionalNumber(raw.stages?.movie?.dubTriggerMs),
    },
    review: {
      startMs: Number(raw.stages?.review?.startMs) || 0,
      endMs: Number(raw.stages?.review?.endMs) || 0,
      dubTriggerMs: optionalNumber(raw.stages?.review?.dubTriggerMs),
    },
  };

  return {
    id: raw.id || '',
    word: raw.word || '',
    ipa: raw.ipa || '',
    translation: raw.translation || '',
    stages,
    movieTracks: normalizeOverlayMovieTracks(raw.movieTracks || [], stages.review.startMs),
  };
}

/**
 * 规范化 overlay movie tracks，并补齐句间停顿触发所需字段
 * @param {Object[]} rawTracks
 * @param {number} reviewStartMs
 * @returns {SubtitleTrack[]}
 */
function normalizeOverlayMovieTracks(rawTracks, reviewStartMs) {
  const tracks = rawTracks.map(normalizeTrack);
  return tracks.map((track, idx) => {
    const nextTrack = tracks[idx + 1] || null;
    const nextStartMs = track.nextStartMs ?? nextTrack?.startMs ?? reviewStartMs;
    const speakEndMs = track.speakEndMs ?? track.dubEndMs ?? track.endMs;
    return {
      ...track,
      nextStartMs,
      speakEndMs,
      promptWindowStartMs: track.promptWindowStartMs ?? speakEndMs,
      promptWindowEndMs: track.promptWindowEndMs ?? nextStartMs,
    };
  });
}

/**
 * 解析配置对象为 StoryConfig
 * @param {Object} raw - 已解析的 JSON 对象
 * @returns {StoryConfig}
 */
export function parseStoryConfig(raw) {
  if (!raw || !raw.scenes || !Array.isArray(raw.scenes)) {
    throw new Error('配置格式错误: 缺少 scenes 数组');
  }
  return {
    title: raw.title || '影视配音秀',
    description: raw.description || '',
    allowSkip: !!raw.allowSkip,
    scenes: raw.scenes.map(normalizeScene),
    // Role-play movie mode metadata (preserved verbatim from bootstrap)
    rolePlayMovie: raw.rolePlayMovie === true,
    clipScenes: Array.isArray(raw.clipScenes) ? raw.clipScenes.slice() : [],
    videoLengthMs: Number(raw.videoLengthMs) || 0,
  };
}

/**
 * 规范化单个 scene
 * @param {Object} raw
 * @returns {Scene}
 */
function normalizeScene(raw) {
  return {
    id: raw.id || 'scene',
    videoSrc: raw.videoSrc || '',
    posterSrc: raw.posterSrc || '',
    subtitleTracks: (raw.subtitleTracks || []).map(normalizeTrack),
  };
}

/**
 * 规范化字幕轨
 * @param {Object} raw
 * @returns {SubtitleTrack}
 */
function normalizeTrack(raw) {
  const wordTiming = (raw.wordTiming || []).map(w => ({
    text: w.text || '',
    startMs: Number(w.startMs) || 0,
    endMs: Number(w.endMs) || 0,
  }));
  const wordCount = wordTiming.length > 0
    ? wordTiming.length
    : String(raw.targetText || '').split(/\s+/).filter(Boolean).length;

  return {
    id: raw.id || '',
    startMs: Number(raw.startMs) || 0,
    endMs: Number(raw.endMs) || 0,
    dubStartMs: optionalNumber(raw.dubStartMs),
    dubEndMs: optionalNumber(raw.dubEndMs),
    speakEndMs: optionalNumber(raw.speakEndMs),
    nextStartMs: optionalNumber(raw.nextStartMs),
    promptWindowStartMs: optionalNumber(raw.promptWindowStartMs),
    promptWindowEndMs: optionalNumber(raw.promptWindowEndMs),
    allowPromptInGap: typeof raw.allowPromptInGap === 'boolean' ? raw.allowPromptInGap : undefined,
    nativeText: raw.nativeText || '',
    targetText: raw.targetText || '',
    nativeColor: raw.nativeColor || '#2F80ED',
    targetColor: raw.targetColor || '#EB5757',
    guideAudioSrc: raw.guideAudioSrc || '',
    wordTiming,
    nativeSegments: normalizeNativeSegments(raw.nativeSegments, wordCount, raw.id || ''),
    gloss: raw.gloss || '',
    ipa: raw.ipa || '',
    phonemes: Array.isArray(raw.phonemes) ? raw.phonemes.map(normalizePhoneme) : null,
    // Role-play movie mode: preserve speaker / player flag added by bootstrap
    speakerId: raw.speakerId || '',
    isPlayer: raw.isPlayer === true,
  };
}

/**
 * 规范化可选数字字段
 * @param {unknown} value
 * @returns {number|undefined}
 */
function optionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 规范化音素数据
 * @param {Object} raw
 * @returns {Phoneme}
 */
function normalizePhoneme(raw) {
  return {
    ipa: raw.ipa || '',
    type: raw.type === 'vowel' ? 'vowel' : 'consonant',
    durationMs: Number(raw.durationMs) || 100,
    wordIndex: Number(raw.wordIndex) || 0,
    pitch: ['flat', 'rising', 'falling'].includes(raw.pitch) ? raw.pitch : 'flat',
    goldChant: Boolean(raw.goldChant),
  };
}

/**
 * 规范化母语语义片段映射
 * @param {Object[]|undefined} rawSegments
 * @param {number} wordCount
 * @param {string} trackId
 * @returns {NativeSegment[]}
 */
function normalizeNativeSegments(rawSegments, wordCount, trackId) {
  if (!Array.isArray(rawSegments)) return [];

  return rawSegments
    .map((segment, idx) => {
      const text = typeof segment?.text === 'string' ? segment.text : '';
      if (!text) {
        console.warn(`[StoryConfig] nativeSegments[${idx}] 缺少 text，track="${trackId}"`);
      }

      const rawIndexes = Array.isArray(segment?.targetWordIndexes)
        ? segment.targetWordIndexes.map(n => Number(n)).filter(Number.isInteger)
        : [];
      const targetWordIndexes = rawIndexes.filter(n => n >= 0 && n < wordCount);

      if (rawIndexes.length !== targetWordIndexes.length) {
        console.warn(`[StoryConfig] nativeSegments[${idx}] 存在越界索引，track="${trackId}"`);
      }
      if (text && targetWordIndexes.length === 0) {
        console.warn(`[StoryConfig] nativeSegments[${idx}] 没有有效 targetWordIndexes，track="${trackId}"`);
      }

      const priority = Number.isFinite(Number(segment?.priority)) ? Number(segment.priority) : 0;
      return { text, targetWordIndexes, priority };
    })
    .filter(segment => segment.text);
}
