// ============ App entry point ============
// Pipeline-driven editor: a right sidebar with stage buttons switches between
// the Projects view and Stage 1–5. Most views are mounted eagerly so existing
// module init functions can wire DOM events on shared IDs; preview is lazy.

import { mountSettingsUI, initSettings } from './settings.js';
import { initUploads } from './uploads.js';
import { initPrompt } from './prompt.js';
import { initMedia } from './media.js';
import { initOutput } from './output.js';
import { initParse } from './parse.js';
import { mountProjectUI, initProject, initProjectFlow, updateLoginButton, updateShareButton } from './project.js';
import { mountSidebarUI, showView, setStagesEnabled, currentView, registerView } from './views.js';
import { registerProjectsView, refreshProjectsView } from './view_projects.js';
import { registerSelectSourceVideoView } from './view_select_source_video.js';
import { registerParseVideoView } from './view_parse_video.js';
import { registerGenerateInteractionView, initInteractionGenerator } from './view_generate_interactions.js';
import { registerAnnotationEditorView, initTimeline } from './view_video_annotation_editor.js';
import { initWelcome, showWelcomeModal } from './welcome.js';

/* ---------------- Mount HTML ---------------- */
mountProjectUI();        // header (project bar) + dialogs at top of body
mountSidebarUI();        // right-side stage buttons

// Register views (each mounts its own HTML inside #appMain immediately so
// that all DOM IDs exist before init*() wires events on them).
registerProjectsView();
registerSelectSourceVideoView();
registerParseVideoView();
registerAnnotationEditorView();
registerGenerateInteractionView();
registerView({
  id: 'stage5',
  label: '预览',
  stage: 5,
  mount: (container) => {
    container.innerHTML = '<section class="panel"><h2>预览</h2><div class="hint">首次打开时加载预览播放器…</div></section>';
  },
  onShow: async () => {
    try {
      const mod = await import('./view_preview.js');
      mod.mountPreviewView?.(document.getElementById('view-stage5'));
      mod.showPreviewView?.();
    } catch (e) {
      console.error('preview view failed:', e);
      const container = document.getElementById('view-stage5');
      if (container) container.innerHTML = `<section class="panel"><h2>预览加载失败</h2><div class="status err">${e?.message || e}</div></section>`;
    }
  },
  onHide: async () => {
    try {
      const mod = await import('./view_preview.js');
      mod.hidePreviewView?.();
    } catch {}
  },
});

mountSettingsUI();       // settings dialog appended to body

/* ---------------- Wire behaviour ---------------- */
initSettings();
initUploads();
initMedia();
initPrompt();
initOutput();
initParse();
initInteractionGenerator();
initTimeline();
initProject();
initProjectFlow();

/* ---------------- Initial view ---------------- */
const params = new URLSearchParams(location.search);
if (params.get('shareuser') && params.get('projectname')) {
  // Shared read-only project: project.js loads it; jump to the editor.
  setStagesEnabled(true);
  showView('stage3');
} else {
  // Default landing: project gallery.
  setStagesEnabled(false);
  showView('projects');
}

/* Header "Projects" link returns to the gallery. */
document.getElementById('btnGoProjects')?.addEventListener('click', () => {
  if (currentView() === 'projects') refreshProjectsView();
  else showView('projects');
});

/* Project lifecycle events from project.js drive the pipeline. */
window.addEventListener('rpmm:projectOpened', () => {
  setStagesEnabled(true);
  showView('stage3');
});
window.addEventListener('rpmm:projectNew', () => {
  setStagesEnabled(true);
  showView('stage1');
});

/* Refresh the project gallery whenever login state changes (sign-in/out). */
window.addEventListener('rpmm:loginChanged', () => {
  try { updateLoginButton(); } catch {}
  try { updateShareButton(); } catch {}
  try { refreshProjectsView(); } catch {}
});

/* Onboarding: Chinese welcome modal + login prompt. */
initWelcome();

window.addEventListener('rpmm:showWelcome', () => {
  showWelcomeModal();
});
