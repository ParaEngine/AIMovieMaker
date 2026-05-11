// ============ View: Projects (initial landing) ============
// Lists personal projects from Keepwork PersonalPageStore and offers a
// "+ New project" tile. Selecting a project loads it and switches to stage 1.

import { registerView, showView, setStagesEnabled } from './views.js';
import {
  listProjects,
  openProjectByName,
  newProject,
  deleteProjectByName,
  cloneProjectByName,
} from './project.js';
import { ensureKeepworkLogin, loadKeepworkSDK } from './kwsdk.js';
import { PROJECT_WORKSPACE, PROJECT_FILE_SUFFIX } from './constants.js';
import { log } from './utils.js';

let _galleryEl = null;
let _hintEl = null;

export function registerProjectsView() {
  registerView({
    id: 'projects',
    label: '项目',
    mount: mountProjectsView,
    onShow: () => { renderGallery(); },
  });
}

function mountProjectsView(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1>📂 项目</h1>
        <div class="vh-sub">工作区 <a href="#workspace" id="projectsWorkspaceLink" class="workspace-link" title="打开工作区文件"><code>${PROJECT_WORKSPACE}</code></a> 中的所有角色扮演电影项目。</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button type="button" class="secondary" id="btnRefreshGallery">刷新</button>
        <button type="button" id="btnNewFromGallery">+ 新建项目</button>
      </div>
    </div>
    <div class="hint" id="projectsHint">正在加载项目…</div>
    <div class="proj-gallery" id="projectsGallery"></div>
  `;
  _galleryEl = container.querySelector('#projectsGallery');
  _hintEl = container.querySelector('#projectsHint');
  container.querySelector('#projectsWorkspaceLink')?.addEventListener('click', () => {
    document.getElementById('btnWorkspace')?.click();
  });
  container.querySelector('#btnRefreshGallery').addEventListener('click', renderGallery);
  container.querySelector('#btnNewFromGallery').addEventListener('click', startNewProject);
}

async function startNewProject() {
  let created = false;
  try { created = await newProject(); } catch {}
  if (!created) return;
  setStagesEnabled(true);
  showView('stage1');
}

async function renderGallery() {
  if (!_galleryEl) return;
  _galleryEl.innerHTML = '';
  _hintEl.textContent = '正在加载项目…';

  // Try to load Keepwork SDK and list projects.
  const sdk = await loadKeepworkSDK().catch(() => null);
  if (!sdk) {
    _hintEl.textContent = 'Keepwork SDK 不可用 — 无法列出已保存的项目。';
    return;
  }
  if (!sdk.token) {
    _hintEl.innerHTML = `登录 Keepwork 后可查看你保存的项目。 <button type="button" class="secondary" id="btnGalleryLogin" style="margin-left:8px;">登录</button>`;
    const btn = _hintEl.querySelector('#btnGalleryLogin');
    btn?.addEventListener('click', async () => {
      try { await ensureKeepworkLogin(); renderGallery(); }
      catch (e) { log('登录失败：' + (e.message || e), 'err'); }
    });
    return;
  }

  let items = [];
  try { items = await listProjects(); }
  catch (e) {
    _hintEl.textContent = '加载项目失败：' + (e.message || e);
    return;
  }

  const suffixRe = new RegExp(PROJECT_FILE_SUFFIX.replace(/\./g, '\\.') + '$');
  const projects = items.filter(it => suffixRe.test(it.name))
    .map(it => ({
      name: it.name.replace(suffixRe, ''),
      modified: it.modifiedAt || it.updatedAt || it.mtime || '',
    }))
    .sort((a, b) => String(b.modified).localeCompare(String(a.modified)));

  _hintEl.textContent = projects.length
    ? `已保存 ${projects.length} 个项目。`
    : '还没有保存的项目 — 点击“+ 新建项目”创建一个。';

  for (const p of projects) {
    const card = document.createElement('div');
    card.className = 'proj-card';
    const meta = p.modified ? new Date(p.modified).toLocaleString() : '';
    card.innerHTML = `
      <div class="pc-title">${escapeHtml(p.name)}</div>
      <div class="pc-meta">${meta}</div>
      <div class="pc-actions">
        <button type="button" class="secondary pc-btn" data-action="clone">克隆</button>
        <button type="button" class="secondary pc-btn danger" data-action="delete">删除</button>
      </div>
    `;
    card.addEventListener('click', async () => {
      try {
        await openProjectByName(p.name);
        setStagesEnabled(true);
        showView('stage3'); // Open existing projects directly into the editor.
      } catch (e) { log('打开失败：' + (e.message || e), 'err'); }
    });
    const cloneBtn = card.querySelector('[data-action="clone"]');
    const deleteBtn = card.querySelector('[data-action="delete"]');
    cloneBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const suggestion = `${p.name}-副本`;
      const targetName = prompt('请输入克隆后的项目名称：', suggestion);
      if (targetName == null) return;
      try {
        await cloneProjectByName(p.name, targetName);
        await renderGallery();
      } catch (err) {
        log('克隆失败：' + (err.message || err), 'err');
      }
    });
    deleteBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`确认删除项目“${p.name}”？`)) return;
      try {
        await deleteProjectByName(p.name);
        await renderGallery();
      } catch (err) {
        log('删除失败：' + (err.message || err), 'err');
      }
    });
    _galleryEl.appendChild(card);
  }
}

export function refreshProjectsView() { renderGallery(); }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
