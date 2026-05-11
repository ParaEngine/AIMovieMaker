// ============ Pipeline view manager ============
// Owns the right sidebar with stage buttons and switches between views.
//
// Views are registered with `registerView({ id, label, sub, stage, mount })`.
// Stage views appear in the sidebar; non-stage views (e.g. "projects")
// are reachable via `showView(id)` directly (project list, etc.).

const views = new Map();      // id -> { id, label, sub, stage, mount, container, mounted, onShow, onHide }
let currentId = null;
let sidebarOffsetBound = false;

const STAGES = [];            // ordered list of stage ids

export function mountSidebarUI() {
  const aside = document.getElementById('stageSidebar');
  if (!aside) return;
  if (aside.dataset.mounted === '1') return;
  aside.dataset.mounted = '1';
  aside.innerHTML = `
    <button type="button" class="stage-btn" data-view="projects" id="navProjects" title="项目列表">
      <span class="stage-num">📂</span>
      <span class="stage-label">项目</span>
    </button>
    <div class="sidebar-divider"></div>
    <button type="button" class="stage-btn" data-view="stage1" data-stage="1" id="navStage1" title="选择源视频" disabled>
      <span class="stage-num">1</span>
      <span class="stage-label">源视频</span>
    </button>
    <button type="button" class="stage-btn" data-view="stage2" data-stage="2" id="navStage2" title="解析视频" disabled>
      <span class="stage-num">2</span>
      <span class="stage-label">解析</span>
    </button>
    <button type="button" class="stage-btn" data-view="stage3" data-stage="3" id="navStage3" title="标注编辑器" disabled>
      <span class="stage-num">3</span>
      <span class="stage-label">编辑</span>
    </button>
    <button type="button" class="stage-btn" data-view="stage4" data-stage="4" id="navStage4" title="生成互动" disabled>
      <span class="stage-num">4</span>
      <span class="stage-label">互动</span>
    </button>
    <button type="button" class="stage-btn" data-view="stage5" data-stage="5" id="navStage5" title="预览电影" disabled>
      <span class="stage-num">5</span>
      <span class="stage-label">预览</span>
    </button>
    <div class="stage-spacer"></div>
    <button type="button" class="stage-btn bottom" id="sidebarHelpBtn" data-action="help" title="帮助">
      <span class="stage-num">?</span>
      <span class="stage-label">帮助</span>
    </button>
    <button type="button" class="stage-btn bottom" id="sidebarSettingsBtn" data-action="settings" title="设置">
      <span class="stage-num">⚙</span>
      <span class="stage-label">设置</span>
    </button>
  `;
  aside.addEventListener('click', (e) => {
    const btn = e.target.closest('.stage-btn');
    if (!btn || btn.disabled) return;
    if (btn.dataset.action === 'settings') {
      // Reuse the File menu's Settings entry so settings.js wiring stays single-source.
      document.getElementById('btnSettings')?.click();
      return;
    }
    if (btn.dataset.action === 'help') {
      window.dispatchEvent(new CustomEvent('rpmm:showWelcome'));
      return;
    }
    const id = btn.dataset.view;
    if (id) showView(id);
  });
  bindSidebarHeaderOffset();
}

function syncSidebarHeaderOffset() {
  const aside = document.getElementById('stageSidebar');
  if (!aside) return;
  const header = document.getElementById('appHeader');
  const headerHeight = header?.offsetHeight || 48;
  const visibleHeaderHeight = header
    ? Math.max(0, Math.min(headerHeight, header.getBoundingClientRect().bottom))
    : 0;
  aside.style.setProperty('--stage-sidebar-header-offset', `${Math.round(visibleHeaderHeight)}px`);
}

function bindSidebarHeaderOffset() {
  syncSidebarHeaderOffset();
  if (sidebarOffsetBound) return;
  sidebarOffsetBound = true;
  window.addEventListener('scroll', syncSidebarHeaderOffset, { passive: true });
  window.addEventListener('resize', syncSidebarHeaderOffset);
}

/* Register a view. Mounts immediately so all DOM IDs exist for module init,
 * but keeps the view hidden until showView(id) is called. */
export function registerView(def) {
  const main = document.getElementById('appMain') || document.body;
  const container = document.createElement('section');
  container.className = 'app-view';
  container.id = `view-${def.id}`;
  main.appendChild(container);
  const v = { ...def, container, mounted: false };
  views.set(def.id, v);
  if (def.stage) STAGES.push(def.id);
  try { def.mount && def.mount(container); v.mounted = true; }
  catch (e) { console.error('view mount failed:', def.id, e); }
}

export function showView(id) {
  const v = views.get(id);
  if (!v) { console.warn('未知视图:', id); return; }
  if (currentId === id) return;
  if (currentId) {
    const prev = views.get(currentId);
    if (prev) {
      prev.container.classList.remove('active');
      try { prev.onHide && prev.onHide(); } catch (e) { console.warn(e); }
    }
  }
  v.container.classList.add('active');
  currentId = id;
  try { v.onShow && v.onShow(); } catch (e) { console.warn(e); }
  updateSidebarActive();
}

export function currentView() { return currentId; }

function updateSidebarActive() {
  document.querySelectorAll('#stageSidebar .stage-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === currentId);
  });
}

/* Enable / disable stage buttons (e.g. disabled until a project is loaded). */
export function setStagesEnabled(enabled) {
  document.querySelectorAll('#stageSidebar .stage-btn[data-stage]').forEach(b => {
    b.disabled = !enabled;
  });
}

/* Convenience: jump to next/previous stage in the pipeline. */
export function gotoNextStage() {
  const idx = STAGES.indexOf(currentId);
  if (idx >= 0 && idx < STAGES.length - 1) showView(STAGES[idx + 1]);
}
export function gotoPrevStage() {
  const idx = STAGES.indexOf(currentId);
  if (idx > 0) showView(STAGES[idx - 1]);
}
