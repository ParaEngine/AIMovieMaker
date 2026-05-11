// ============ Lazy DOM lookup helpers ============
// Each JS module owns its own HTML markup (see the mountUI() function in
// each module). `ui` and `projUI` are Proxy objects that resolve element
// IDs lazily, so callers like `ui.parse` keep working regardless of the
// order in which modules mount their HTML.

export const $ = (id) => document.getElementById(id);

// Map of property name -> element id (the rest of the codebase reads
// `ui.<key>` / `projUI.<key>`).
const UI_IDS = {
  file: 'fileInput',
  urlInput: 'urlInput',
  urlMime: 'urlMime',
  preview: 'preview',
  model: 'modelSelect',
  modelProviderTag: 'modelProviderTag',
  providerMain: 'providerMainSel',
  googleModelSel: 'googleModelSel',
  googleModelCustom: 'googleModelCustom',
  openrouterModelSel: 'openrouterModelSel',
  openrouterModelCustom: 'openrouterModelCustom',
  fps: 'fpsInput',
  promptText: 'promptText',
  resetPrompt: 'btnResetPrompt',
  source: 'sourceSel',
  refreshFiles: 'btnRefreshFiles',
  deleteFile: 'btnDeleteFile',
  fileMetaHint: 'fileMetaHint',
  parse: 'btnParse',
  cancel: 'btnCancel',
  status: 'status',
  progress: 'progressBar',
  output: 'output',
  copy: 'btnCopy',
  download: 'btnDownload',
  downloadSrt: 'btnDownloadSrt',
  clear: 'btnClear',
  settingsBtn: 'btnSettings',
  settingsDlg: 'settingsDlg',
  provider: 'providerSel',
  googleKey: 'googleKey',
  openrouterKey: 'openrouterKey',
  settingsClear: 'btnSettingsClear',
  // Timeline
  timelineVideo: 'timelineVideo',
  timelineYT: 'timelineYT',
  timelineSourceHint: 'timelineSourceHint',
  timelineFileInput: 'timelineFileInput',
  timelineReadout: 'timelineReadout',
  timelineZoom: 'timelineZoom',
  timelineZoomValue: 'timelineZoomValue',
  timelineScroll: 'timelineScroll',
  timelineInner: 'timelineInner',
  timeRuler: 'timeRuler',
  trackSubs: 'trackSubs',
  trackSubsCount: 'trackSubsCount',
  trackScenes: 'trackScenes',
  trackScenesCount: 'trackScenesCount',
  trackInteractionPoints: 'trackInteractionPoints',
  trackInteractionPointsCount: 'trackInteractionPointsCount',
  emptySubs: 'emptySubs',
  emptyScenes: 'emptyScenes',
  emptyInteractionPoints: 'emptyInteractionPoints',
  timeCursor: 'timeCursor',
  previewCanvas: 'previewCanvas',
  sceneEditor: 'sceneEditor',
  sceneEditorEmpty: 'sceneEditorEmpty',
  sceneEditorForm: 'sceneEditorForm',
  sceneEditorTitle: 'sceneEditorTitle',
  sceneDisabled: 'sceneDisabled',
  sceneStart: 'sceneStart',
  sceneEnd: 'sceneEnd',
  sceneDescription: 'sceneDescription',
  sceneOnScreenText: 'sceneOnScreenText',
  subtitleEditorEmpty: 'subtitleEditorEmpty',
  subtitleEditorBody: 'subtitleEditorBody',
  subtitleDisabled: 'subtitleDisabled',
  subtitleStart: 'subtitleStart',
  subtitleEnd: 'subtitleEnd',
  subtitleSpeaker: 'subtitleSpeaker',
  subtitleText: 'subtitleText',
  subtitleAdd: 'subtitleAdd',
  subtitleDelete: 'subtitleDelete',
  interactionEditorPanel: 'interactionEditorPanel',
  interactionEditorEmpty: 'interactionEditorEmpty',
  interactionEditorBody: 'interactionEditorBody',
  interactionJson: 'interactionJson',
};

const PROJ_IDS = {
  name: 'projectName',
  newBtn: 'btnNewProject',
  openBtn: 'btnOpenProject',
  saveBtn: 'btnSaveProject',
  topbarSaveBtn: 'btnSaveProjectTopbar',
  shareBtn: 'btnShareProject',
  readonlyTag: 'readonlyTag',
  loginBtn: 'btnLogin',
  openDlg: 'openProjDlg',
  openHint: 'openProjHint',
  list: 'projList',
  refreshList: 'btnRefreshProjList',
  shareDlg: 'shareDlg',
  shareUrl: 'shareUrlText',
  copyShare: 'btnCopyShareUrl',
  workspaceBtn: 'btnWorkspace',
  workspaceModal: 'workspaceViewerModal',
  workspaceHost: 'workspaceViewerHost',
  workspaceClose: 'workspaceViewerClose',
};

function lazyLookup(map) {
  return new Proxy({}, {
    get(_t, prop) {
      const id = map[prop];
      return id ? document.getElementById(id) : undefined;
    },
    has(_t, prop) { return prop in map; },
    ownKeys() { return Object.keys(map); },
    getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
  });
}

export const ui = lazyLookup(UI_IDS);
export const projUI = lazyLookup(PROJ_IDS);

/* Append an HTML fragment to the given parent (default: document.body). */
export function mountHTML(html, parent = document.body) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html).trim();
  const nodes = [...tpl.content.childNodes];
  parent.append(...nodes);
  return nodes;
}
