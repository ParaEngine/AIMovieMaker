// =================== Step 2 Overlay — 单词视频叠加控制器 ===================

/**
 * OverlayController manages:
 * - Unit navigation (intro → movie → review → next unit)
 * - Overlay caption display for movie stage (Chinese translation + interactive EN)
 * - Triggering dubbing mode when the movie stage begins
 * - Tracking the current unit, stage, and movie track index
 *
 * It does NOT manage: video playback, subtitle rendering, dubbing sessions, scoring.
 * Those are handled by the existing gameplay.js + SubtitleManager + DubbingSession.
 */

/**
 * @typedef {'intro'|'movie'|'review'|'idle'} OverlayStage
 */

export class OverlayController {
  /**
   * @param {import('./story-config-loader.js').OverlayConfig} config
   */
  constructor(config) {
    /** @type {import('./story-config-loader.js').OverlayConfig} */
    this._config = config;
    /** @type {import('./story-config-loader.js').OverlayUnit[]} */
    this._units = config.units;

    this._currentUnitIdx = -1;
    /** @type {OverlayStage} */
    this._currentStage = 'idle';
    this._currentMovieTrackIdx = 0;
    this._dubbingTriggered = false;
    /** Whether intro/review dubbing has been triggered for the current unit+stage */
    this._wordDubbingTriggered = false;

    /** Ratio of stage duration after which intro/review dubbing is triggered */
    this._introDubRatio = 0.75;
    this._reviewDubRatio = 0.70;
    this._minGapMs = Number(config.overlay?.minGapMs) || 450;

    // DOM elements for overlay captions (set via setElements)
    /** @type {HTMLElement|null} */
    this._captionArea = null;
    /** @type {HTMLElement|null} */
    this._captionWord = null;
    /** @type {HTMLElement|null} */
    this._captionIpa = null;
    /** @type {HTMLElement|null} */
    this._captionZh = null;

    // Callbacks
    /** @type {((track: object, unitIdx: number, trackIdx: number) => void)|null} */
    this._onDubbingTrigger = null;
    /** @type {((unitIdx: number, stage: OverlayStage) => void)|null} */
    this._onStageChange = null;
  }

  /**
   * Bind DOM elements for overlay captions
   * @param {{captionArea: HTMLElement, captionWord: HTMLElement, captionIpa: HTMLElement, captionZh: HTMLElement}} els
   */
  setElements(els) {
    this._captionArea = els.captionArea;
    this._captionWord = els.captionWord;
    this._captionIpa = els.captionIpa;
    this._captionZh = els.captionZh;
  }

  /**
   * Register callback when dubbing should start for a movie track
   * @param {(track: object, unitIdx: number, trackIdx: number) => void} fn
   */
  onDubbingTrigger(fn) {
    this._onDubbingTrigger = fn;
  }

  /**
   * Register callback when stage changes
   * @param {(unitIdx: number, stage: OverlayStage) => void} fn
   */
  onStageChange(fn) {
    this._onStageChange = fn;
  }

  /** @returns {import('./story-config-loader.js').OverlayUnit|null} */
  get currentUnit() {
    return this._units[this._currentUnitIdx] || null;
  }

  /** @returns {OverlayStage} */
  get currentStage() {
    return this._currentStage;
  }

  /** @returns {number} */
  get currentUnitIdx() {
    return this._currentUnitIdx;
  }

  /** @returns {number} */
  get totalUnits() {
    return this._units.length;
  }

  /** @returns {string} */
  get placementMode() {
    return this._config.subtitlePlacementMode || 'hybrid';
  }

  /**
   * Get all movie tracks (flattened from all units) as SubtitleTrack-compatible objects.
   * Used by SubtitleManager.setTracks().
   * @returns {object[]}
   */
  getAllTracks() {
    return this._units.flatMap(u => u.movieTracks);
  }

  /**
   * Get the current movie track for dubbing
   * @returns {object|null}
   */
  getCurrentMovieTrack() {
    const unit = this.currentUnit;
    if (!unit || !unit.movieTracks.length) return null;
    return unit.movieTracks[this._currentMovieTrackIdx] || null;
  }

  /**
   * Advance to the next movie track within the current unit.
   * @returns {boolean} true if there is another track, false if unit is done
   */
  advanceMovieTrack() {
    const unit = this.currentUnit;
    if (!unit) return false;
    this._currentMovieTrackIdx++;
    if (this._currentMovieTrackIdx < unit.movieTracks.length) {
      this._dubbingTriggered = false;
      return true;
    }
    return false;
  }

  /**
   * Called on every video timeupdate. Determines current unit and stage,
   * updates overlay captions, and triggers dubbing when appropriate.
   * @param {number} timeMs - current video time in milliseconds
   */
  update(timeMs) {
    const { unitIdx, stage } = this._findUnitAndStage(timeMs);

    // Stage or unit changed
    if (unitIdx !== this._currentUnitIdx || stage !== this._currentStage) {
      const prevUnit = this._currentUnitIdx;
      const prevStage = this._currentStage;
      this._currentUnitIdx = unitIdx;
      this._currentStage = stage;

      // Reset movie track index when entering a new unit's movie stage
      if (unitIdx !== prevUnit || (stage === 'movie' && prevStage !== 'movie')) {
        this._currentMovieTrackIdx = 0;
        this._dubbingTriggered = false;
      }

      // Reset word dubbing flag when stage changes
      this._wordDubbingTriggered = false;

      this._updateOverlayCaption(unitIdx, stage);

      if (this._onStageChange) {
        this._onStageChange(unitIdx, stage);
      }
    }

    // Trigger dubbing in movie stage based on sentence-end / gap window
    if (stage === 'movie' && !this._dubbingTriggered) {
      const unit = this._units[unitIdx];
      if (unit && unit.movieTracks.length > 0) {
        const track = unit.movieTracks[this._currentMovieTrackIdx];
        if (track && this._shouldTriggerMovieTrack(track, unit, timeMs)) {
          this._dubbingTriggered = true;
          if (this._onDubbingTrigger) {
            this._onDubbingTrigger(track, unitIdx, this._currentMovieTrackIdx);
          }
        }
      }
    }

    // Trigger word dubbing in intro/review stages (after original audio plays)
    if ((stage === 'intro' || stage === 'review') && !this._wordDubbingTriggered) {
      const unit = this._units[unitIdx];
      if (unit) {
        const stageInfo = unit.stages[stage];
        const stageDuration = stageInfo.endMs - stageInfo.startMs;
        // Prefer precise dubTriggerMs from config, fallback to ratio-based estimate
        const dubTriggerMs = stageInfo.dubTriggerMs
          || (stageInfo.startMs + stageDuration
              * (stage === 'intro' ? this._introDubRatio : this._reviewDubRatio));

        if (timeMs >= dubTriggerMs) {
          this._wordDubbingTriggered = true;
          const wordTrack = this._buildWordTrack(unit, stage);
          if (this._onDubbingTrigger) {
            this._onDubbingTrigger(wordTrack, unitIdx, -1);
          }
        }
      }
    }
  }

  /**
   * Mark dubbing as not yet triggered for the current unit.
   * Call this when re-entering playing state after dubbing completes.
   */
  resetDubbingTrigger() {
    this._dubbingTriggered = true; // Already triggered, don't re-trigger
  }

  /**
   * Force-allow dubbing trigger for current unit (e.g., after advancing track).
   */
  allowDubbingTrigger() {
    this._dubbingTriggered = false;
  }

  /**
   * Find which unit and stage the given time falls into.
   * @param {number} timeMs
   * @returns {{unitIdx: number, stage: OverlayStage}}
   */
  _findUnitAndStage(timeMs) {
    for (let i = 0; i < this._units.length; i++) {
      const u = this._units[i];
      const s = u.stages;
      if (timeMs >= s.intro.startMs && timeMs < s.intro.endMs) {
        return { unitIdx: i, stage: 'intro' };
      }
      if (timeMs >= s.movie.startMs && timeMs < s.movie.endMs) {
        return { unitIdx: i, stage: 'movie' };
      }
      if (timeMs >= s.review.startMs && timeMs < s.review.endMs) {
        return { unitIdx: i, stage: 'review' };
      }
    }
    return { unitIdx: this._currentUnitIdx, stage: 'idle' };
  }

  /**
   * Update the overlay caption area based on current unit and stage.
   * - intro: hidden (video already shows word + IPA)
   * - movie: show word + IPA + Chinese translation (small, top of video)
   * - review: hidden (video already shows word + IPA + translation)
   * - idle: hidden
   * @param {number} unitIdx
   * @param {OverlayStage} stage
   */
  _updateOverlayCaption(unitIdx, stage) {
    if (!this._captionArea) return;

    const unit = this._units[unitIdx];
    // Hide caption during intro, review, and idle — video already shows the content
    if (!unit || stage === 'idle' || stage === 'intro' || stage === 'review') {
      this._captionArea.classList.add('hidden');
      return;
    }

    // Movie stage: show word + IPA + translation as small overlay
    this._captionArea.classList.remove('hidden');

    if (this._captionWord) this._captionWord.textContent = unit.word;
    if (this._captionIpa) this._captionIpa.textContent = unit.ipa || '';

    if (this._captionZh) {
      this._captionZh.textContent = unit.translation || '';
      this._captionZh.classList.remove('hidden');
    }

    this._captionArea.dataset.stage = stage;
  }

  /**
   * Build a synthetic dubbing track for word-level dubbing in intro/review stages.
   * @param {import('./story-config-loader.js').OverlayUnit} unit
   * @param {'intro'|'review'} stage
   * @returns {object} A track-like object compatible with enterDubbingMode
   */
  _buildWordTrack(unit, stage) {
    const stageInfo = unit.stages[stage];
    return {
      id: `${unit.id}_${stage}_word`,
      startMs: stageInfo.startMs,
      endMs: stageInfo.endMs,
      dubStartMs: stageInfo.startMs,
      dubEndMs: stageInfo.endMs,
      targetText: unit.word,
      nativeText: unit.translation || '',
      nativeColor: '#2F80ED',
      targetColor: '#EB5757',
      gloss: unit.word,
      ipa: unit.ipa || '',
      guideAudioSrc: '',
      nativeSegments: [],
      wordTiming: [{ text: unit.word, startMs: stageInfo.startMs, endMs: stageInfo.endMs }],
      _isWordDub: true,   // marker: this is a word-level dub, not a movie sentence
      _stage: stage,       // which stage triggered it
    };
  }

  /**
   * Decide whether a movie track should enter dubbing now.
   * Supports precise sentence-end triggering and gap-window prompting.
   * @param {import('./story-config-loader.js').SubtitleTrack} track
   * @param {import('./story-config-loader.js').OverlayUnit} unit
   * @param {number} timeMs
   * @returns {boolean}
   */
  _shouldTriggerMovieTrack(track, unit, timeMs) {
    const speakEndMs = Number(track.promptWindowStartMs ?? track.speakEndMs ?? track.endMs) || track.endMs;
    const nextStartMs = Number(track.nextStartMs) || unit.stages.review.startMs;
    const promptWindowEndMs = Number(track.promptWindowEndMs) || nextStartMs;
    const gapMs = Math.max(0, nextStartMs - speakEndMs);
    const allowPromptInGap = typeof track.allowPromptInGap === 'boolean'
      ? track.allowPromptInGap
      : gapMs >= this._minGapMs;

    if (allowPromptInGap) {
      return timeMs >= speakEndMs && timeMs < promptWindowEndMs;
    }

    return timeMs >= nextStartMs;
  }

  /**
   * Check if a track is a word-level dubbing track (intro/review)
   * @param {object} track
   * @returns {boolean}
   */
  static isWordDubTrack(track) {
    return !!track?._isWordDub;
  }

  /**
   * Reset controller state (e.g., on replay)
   */
  reset() {
    this._currentUnitIdx = -1;
    this._currentStage = 'idle';
    this._currentMovieTrackIdx = 0;
    this._dubbingTriggered = false;
    this._wordDubbingTriggered = false;
    if (this._captionArea) this._captionArea.classList.add('hidden');
  }

  /**
   * Force reset internal tracking so next update() re-evaluates unit/stage.
   * Used after user seeks the video to a different position.
   */
  forceReset() {
    this._currentUnitIdx = -1;
    this._currentStage = 'idle';
    this._currentMovieTrackIdx = 0;
    this._dubbingTriggered = false;
    this._wordDubbingTriggered = false;
  }
}
