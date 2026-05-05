// ============ Shared mutable runtime state ============
// Modules read/write these directly. Each property is module-local to this
// module; importers see live values via the exported objects.

export const state = {
  abortController: null,
  interactionAbortController: null,
  lastResultJson: null,
  interactionPoints: null,
  outputEditTimer: null,
  interactionOutputEditTimer: null,
  workspaceViewerInstance: null,
  // Timeline
  timelineDuration: 0,
  timelineZoomPxPerSecond: 6,
  timelineSubBars: [],
  timelineSceneBars: [],
  timelineIPBars: [],
  selectedSceneIndex: null,
  selectedSubtitleRef: null,
  selectedInteractionPointIndex: null,
  sceneAutoSaveTimer: null,
  previewRAF: null,
  skipSeekGuard: false,
  suppressSkipUntil: 0,
  lastTriggeredInteractionPointId: '',
};

/* Timeline media abstraction (MP4 <video> | YouTube iframe). */
export const media = {
  mode: 'none',          // 'none' | 'video' | 'youtube'
  ytPlayer: null,
  ytReady: false,
  ytApiPromise: null,
  ytPollTimer: null,
  ytLastTime: 0,
  ytDuration: 0,
  ytPaused: true,
  ytSeekTarget: null,
  ytSeekSettlingUntil: 0,
  ytSeekPauseTimer: null,
  ytSeekPauseToken: 0,
};

export const projectState = {
  name: '',
  loadedFromUser: '',   // non-empty means read-only shared view
  ownerUsername: '',    // username under which the project is stored
};
