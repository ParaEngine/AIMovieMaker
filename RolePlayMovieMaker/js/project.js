// ============ Project save / load / share via Keepwork PersonalPageStore ============
import {
  PROJECT_WORKSPACE, PROJECT_FILE_SUFFIX, PROJECT_FORMAT, PROJECT_VERSION,
  REMOTE_STORE_PATH, LS_LAST_PROJECT,
} from './constants.js';
import { ui, projUI, mountHTML } from './ui.js';
import { state, projectState } from './state.js';
import { log, sanitizeProjectName } from './utils.js';
import { clampFps, refreshMainModelSelect } from './settings.js';
import { loadKeepworkSDK, ensureKeepworkLogin } from './kwsdk.js';
import { setTimelineVideoSrc } from './media.js';
import { rebuildTimeline } from './view_video_annotation_editor.js';
import { MovieData } from './movieData.js';

/* ---------------- HTML markup owned by this module ---------------- */
export function mountProjectUI() {
  if (document.getElementById('appHeader')) return;
  // AIMovieMaker-style topbar: brand + File menu on the left, project name
  // in the centre, Share + user profile on the right. All "major" project
  // operations (New/Open/Save/Workspace/Projects/Settings) live in the File
  // menu; only the project-name input and Share button stay outside.
  const headerHTML = `
<header id="appHeader">
  <div class="topbar-brand">
    <button type="button" id="appHomeBtn" class="app-emoji-btn" title="角色扮演电影制作" aria-label="角色扮演电影制作">🎬</button>
    <div class="file-menu-wrap">
      <button type="button" id="fileMenuBtn" class="file-menu-btn" aria-haspopup="true" aria-expanded="false">
        文件 <span class="caret">▼</span>
      </button>
      <div id="fileMenuDropdown" class="file-menu-dropdown" role="menu">
        <button type="button" id="btnNewProject" class="file-menu-item">📄 新建项目</button>
        <button type="button" id="btnOpenProject" class="file-menu-item">📂 打开项目…</button>
        <button type="button" id="btnSaveProject" class="file-menu-item">💾 保存</button>
        <div class="file-menu-divider"></div>
        <button type="button" id="btnGoProjects" class="file-menu-item">📋 项目列表</button>
        <button type="button" id="btnWorkspace" class="file-menu-item">🗂️ 工作区文件</button>
        <div class="file-menu-divider"></div>
        <button type="button" id="btnSettings" class="file-menu-item">⚙️ 设置…</button>
      </div>
    </div>
  </div>
  <div class="topbar-context">
    <input type="text" id="projectName" class="topbar-project-input" placeholder="未命名项目" title="项目名称（作为文件名）" />
    <span id="readonlyTag" class="ro-tag" style="display:none;">只读（分享）</span>
  </div>
  <div class="topbar-actions">
    <button type="button" id="btnSaveProjectTopbar" class="topbar-save-btn" title="保存项目">保存</button>
    <button type="button" id="btnShareProject" class="topbar-share-btn" title="复制分享链接" disabled>分享</button>
    <button type="button" id="userProfileBtn" class="user-profile-btn" hidden title="账户">
      <span class="avatar" id="userAvatar"></span>
      <span class="uname" id="userName"></span>
      <span class="caret">▼</span>
    </button>
    <div id="profileDropdown" class="profile-dropdown" role="menu"></div>
    <button type="button" id="btnLogin" class="topbar-login-btn" title="登录 Keepwork">登录</button>
  </div>
</header>`;
  const tpl = document.createElement('template');
  tpl.innerHTML = headerHTML.trim();
  document.body.prepend(tpl.content);

  document.getElementById('appHomeBtn')?.addEventListener('click', () => {
    document.getElementById('navProjects')?.click();
  });

  // File menu open/close.
  const menuBtn = document.getElementById('fileMenuBtn');
  const menu = document.getElementById('fileMenuDropdown');
  if (menuBtn && menu) {
    const closeMenu = () => {
      menu.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    };
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Close after picking any menu item.
    menu.addEventListener('click', (e) => {
      if (e.target.closest('.file-menu-item')) closeMenu();
    });
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('open')) return;
      if (!menu.contains(e.target) && e.target !== menuBtn) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  // Dialogs + workspace modal — appended at end of body.
  mountHTML(`
<dialog id="openProjDlg" class="proj-dlg">
  <form method="dialog" style="padding:20px;">
    <h2 style="margin:0 0 12px; font-size:16px;">打开项目</h2>
    <div class="hint" style="margin-bottom:8px;" id="openProjHint">正在加载项目列表…</div>
    <div class="proj-list" id="projList"><div class="proj-empty">加载中…</div></div>
    <div style="display:flex; justify-content:space-between; gap:8px; margin-top:12px;">
      <button type="button" id="btnRefreshProjList" class="secondary">刷新</button>
      <div style="display:flex; gap:8px;">
        <button type="submit" class="secondary">关闭</button>
      </div>
    </div>
  </form>
</dialog>

<dialog id="shareDlg" class="proj-dlg">
  <form method="dialog" style="padding:20px;">
    <h2 style="margin:0 0 12px; font-size:16px;">分享项目</h2>
    <div class="hint">任何拥有此链接的人都可以以只读方式打开项目（项目文件需已保存至 Keepwork）。</div>
    <input type="text" class="share-url" id="shareUrlText" readonly />
    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:12px;">
      <button type="button" id="btnCopyShareUrl">复制</button>
      <button type="submit" class="secondary">关闭</button>
    </div>
  </form>
</dialog>

<div id="workspaceViewerModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:1000; align-items:center; justify-content:center;">
  <div style="background:var(--panel); border:1px solid var(--border); border-radius:10px; width:min(1200px, calc(100vw - 32px)); height:min(820px, calc(100vh - 32px)); padding:18px; gap:14px; display:flex; flex-direction:column;">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <h2 style="margin:0; font-size:14px; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted);">工作区文件</h2>
      <button type="button" id="workspaceViewerClose" class="secondary" style="padding:6px 12px; font-size:12px;">关闭</button>
    </div>
    <div id="workspaceViewerHost" style="flex:1; min-height:0; border:1px solid var(--border); border-radius:6px; overflow:hidden;"></div>
  </div>
</div>`);
}

export function projectFileName(name) {
  const stem = sanitizeProjectName(name);
  if (!stem) return '';
  return stem + PROJECT_FILE_SUFFIX;
}

function promptForNewProjectName(defaultName = '') {
  const initial = sanitizeProjectName(defaultName) || '';
  const input = prompt('请输入新项目名称：', initial || '');
  if (input == null) return '';
  return sanitizeProjectName(input);
}

export function isReadonlyShare() { return !!projectState.loadedFromUser; }

function setReadonlyShareUI(on) {
  projUI.readonlyTag.style.display = on ? '' : 'none';
  projUI.saveBtn.disabled = on;
  if (projUI.topbarSaveBtn) projUI.topbarSaveBtn.disabled = on;
  projUI.name.readOnly = on;
}

export function getKwUsername() {
  const sdk = window.keepwork;
  return sdk?.user?.username || sdk?.user?.name || '';
}

export function updateLoginButton() {
  const sdk = window.keepwork;
  const profileBtn = document.getElementById('userProfileBtn');
  const loginBtn = projUI.loginBtn;
  if (sdk && sdk.token) {
    const u = sdk.user || {};
    const name = u.nickname || u.username || getKwUsername() || '已登录';
    const initial = (name[0] || '?').toUpperCase();
    const avatar = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');
    if (avatar) {
      if (u.portrait) avatar.innerHTML = `<img src="${u.portrait}" alt="">`;
      else avatar.textContent = initial;
    }
    if (nameEl) nameEl.textContent = name;
    if (profileBtn) profileBtn.hidden = false;
    if (loginBtn) loginBtn.hidden = true;
  } else {
    if (profileBtn) profileBtn.hidden = true;
    if (loginBtn) { loginBtn.hidden = false; loginBtn.textContent = '登录'; }
  }
}

export function updateShareButton() {
  const owner = projectState.ownerUsername || getKwUsername();
  projUI.shareBtn.disabled = !(owner && projectState.name);
}

function buildProjectEnvelope() {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: projectState.name,
    savedAt: new Date().toISOString(),
    input: {
      url: ui.urlInput?.value || '',
      urlMime: ui.urlMime?.value || '',
      fps: clampFps(ui.fps.value),
      provider: ui.provider.value,
      model: ui.model.value || '',
      prompt: ui.promptText.value || '',
    },
    output: state.lastResultJson && typeof state.lastResultJson === 'object' ? state.lastResultJson : null,
    outputRaw: (state.lastResultJson && typeof state.lastResultJson !== 'object') ? String(ui.output.value || '') : null,
    interactionPoints: state.interactionPoints && typeof state.interactionPoints === 'object' ? state.interactionPoints : null,
    interactionPointsRaw: (state.interactionPoints && typeof state.interactionPoints !== 'object') ? String(document.getElementById('interactionOutput')?.value || '') : null,
  };
}

function applyProjectEnvelope(env) {
  if (!env || env.format !== PROJECT_FORMAT) throw new Error('不是 videoParser 项目文件。');
  const inp = env.input || {};
  if (ui.urlInput) ui.urlInput.value = inp.url || '';
  if (ui.urlMime) ui.urlMime.value = inp.urlMime || '';
  if (typeof inp.fps !== 'undefined') ui.fps.value = clampFps(inp.fps);
  if (inp.prompt) ui.promptText.value = inp.prompt;
  if (inp.provider && (inp.provider === 'google' || inp.provider === 'openrouter')) {
    ui.provider.value = inp.provider;
    refreshMainModelSelect();
  }
  if (inp.model) {
    if (![...ui.model.options].some(o => o.value === inp.model)) {
      const o = document.createElement('option');
      o.value = inp.model; o.textContent = inp.model;
      ui.model.appendChild(o);
    }
    ui.model.value = inp.model;
  }
  const u = (inp.url || '').trim();
  if (u && /^https?:\/\//i.test(u)) setTimelineVideoSrc(u);

  if (env.output && typeof env.output === 'object') {
    state.lastResultJson = env.output;
    ui.output.value = JSON.stringify(env.output, null, 2);
    ui.copy.disabled = false;
    ui.download.disabled = false;
    ui.downloadSrt.disabled = !MovieData.getEnabledSubtitles(env.output).length;
  } else if (env.outputRaw) {
    state.lastResultJson = env.outputRaw;
    ui.output.value = env.outputRaw;
    ui.copy.disabled = false;
    ui.download.disabled = false;
    ui.downloadSrt.disabled = true;
  } else {
    state.lastResultJson = null;
    ui.output.value = '';
    ui.copy.disabled = true;
    ui.download.disabled = true;
    ui.downloadSrt.disabled = true;
  }
  if (env.interactionPoints && typeof env.interactionPoints === 'object') {
    state.interactionPoints = env.interactionPoints;
    const interactionOutput = document.getElementById('interactionOutput');
    if (interactionOutput) interactionOutput.value = JSON.stringify(env.interactionPoints, null, 2);
    document.getElementById('btnInteractionCopy')?.removeAttribute('disabled');
    document.getElementById('btnInteractionDownload')?.removeAttribute('disabled');
  } else if (env.interactionPointsRaw) {
    state.interactionPoints = env.interactionPointsRaw;
    const interactionOutput = document.getElementById('interactionOutput');
    if (interactionOutput) interactionOutput.value = env.interactionPointsRaw;
    document.getElementById('btnInteractionCopy')?.removeAttribute('disabled');
    document.getElementById('btnInteractionDownload')?.removeAttribute('disabled');
  } else {
    state.interactionPoints = null;
    const interactionOutput = document.getElementById('interactionOutput');
    if (interactionOutput) interactionOutput.value = '';
    document.getElementById('btnInteractionCopy')?.setAttribute('disabled', '');
    document.getElementById('btnInteractionDownload')?.setAttribute('disabled', '');
  }
  rebuildTimeline();
}

function getOwnedStore() {
  const sdk = window.keepwork;
  if (!sdk?.personalPageStore) return null;
  return sdk.personalPageStore.withWorkspace(PROJECT_WORKSPACE);
}

export async function newProject() {
  if (isReadonlyShare()) {
    if (!confirm('当前查看的是分享（只读）项目。放弃并新建项目？')) return;
    const u = new URL(location.href);
    u.searchParams.delete('shareuser');
    u.searchParams.delete('projectname');
    history.replaceState({}, '', u.toString());
  }
  const name = promptForNewProjectName(projUI.name.value || projectState.name || '');
  if (!name) {
    log('已取消新建项目。', 'warn');
    return false;
  }
  projectState.name = name;
  projectState.loadedFromUser = '';
  projectState.ownerUsername = getKwUsername();
  projUI.name.value = name;
  setReadonlyShareUI(false);
  updateShareButton();
  state.lastResultJson = null;
  state.interactionPoints = null;
  ui.output.value = '';
  const interactionOutput = document.getElementById('interactionOutput');
  if (interactionOutput) interactionOutput.value = '';
  ui.copy.disabled = ui.download.disabled = ui.downloadSrt.disabled = true;
  rebuildTimeline();
  localStorage.setItem(LS_LAST_PROJECT, name);
  const saved = await saveProject();
  if (saved) log(`已创建新项目“${name}”，并已保存到工作区。`, 'ok');
  else log(`已创建新项目“${name}”，但尚未保存到工作区。`, 'warn');
  window.dispatchEvent(new CustomEvent('rpmm:projectNew', { detail: { name } }));
  return true;
}

function flashSaveButton(stateName, message) {
  const buttons = [projUI.saveBtn, projUI.topbarSaveBtn].filter(Boolean);
  if (!buttons.length) return;
  const labelFor = (btn, fallback) => (btn === projUI.topbarSaveBtn ? fallback : (message || fallback));
  for (const btn of buttons) {
    if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent;
    if (btn._flashTimer) { clearTimeout(btn._flashTimer); btn._flashTimer = null; }
  }
  const restore = () => {
    for (const btn of buttons) {
      btn.textContent = btn.dataset.origLabel || '保存';
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = isReadonlyShare();
      btn._flashTimer = null;
    }
  };
  if (stateName === 'saving') {
    for (const btn of buttons) {
      btn.disabled = true;
      btn.textContent = labelFor(btn, '保存中…');
      btn.style.background = 'var(--warn)';
      btn.style.color = '#1a1500';
    }
    return;
  }
  if (stateName === 'saved') {
    for (const btn of buttons) {
      btn.disabled = true;
      btn.textContent = labelFor(btn, '✓ 已保存');
      btn.style.background = 'var(--ok)';
      btn.style.color = '#08130a';
      btn._flashTimer = setTimeout(restore, 1600);
    }
    return;
  }
  if (stateName === 'error') {
    for (const btn of buttons) {
      btn.disabled = isReadonlyShare();
      btn.textContent = labelFor(btn, '✗ 失败');
      btn.style.background = 'var(--err)';
      btn.style.color = '#fff';
      btn._flashTimer = setTimeout(restore, 2200);
    }
    return;
  }
  restore();
}

export async function saveProject() {
  if (isReadonlyShare()) {
    log('只读分享 — 请使用“新建”创建副本。', 'warn');
    flashSaveButton('error', '只读');
    return false;
  }
  flashSaveButton('saving');
  const sdk = await ensureKeepworkLogin().catch(e => { log('需要登录：' + (e.message || e), 'err'); return null; });
  if (!sdk) { flashSaveButton('error', '需要登录'); return false; }
  let name = sanitizeProjectName(projUI.name.value);
  if (!name) {
    name = prompt('项目名称？');
    if (!name) { flashSaveButton('reset'); return false; }
    name = sanitizeProjectName(name);
    if (!name) { log('项目名称无效。', 'err'); flashSaveButton('error', '名称无效'); return false; }
    projUI.name.value = name;
  }
  projectState.name = name;
  projectState.ownerUsername = getKwUsername();
  const store = getOwnedStore();
  if (!store) { log('PersonalPageStore 不可用。', 'err'); flashSaveButton('error'); return false; }
  const fileName = projectFileName(name);
  const json = JSON.stringify(buildProjectEnvelope(), null, 2);
  try {
    await store.createFile(fileName, json);
    log(`已保存项目“${name}”（${fileName}）。`, 'ok');
    localStorage.setItem(LS_LAST_PROJECT, name);
    updateShareButton();
    flashSaveButton('saved', `✓ 已保存“${name}”`);
    return true;
  } catch (e) {
    log('保存失败：' + (e.message || e), 'err');
    flashSaveButton('error');
    return false;
  }
}

export async function listProjects() {
  const sdk = await loadKeepworkSDK().catch(() => null);
  if (!sdk) return [];
  const store = getOwnedStore();
  if (!store) return [];
  try {
    const result = await store.listDir('', false);
    let arr = [];
    if (Array.isArray(result)) {
      arr = result;
    } else if (result && Array.isArray(result.files)) {
      arr = result.files;
    } else if (typeof result === 'string') {
      if (/^Directory is empty or not found/i.test(result)) return [];
      arr = result.split('\n').map(s => s.trim()).filter(Boolean);
    }
    return arr
      .map(it => (typeof it === 'string' ? { name: it } : it))
      .filter(it => it && it.name)
      .filter(it => !it.isDirectory && !it.is_dir && !/\/$/.test(it.name));
  } catch (e) {
    log('列出项目失败：' + (e.message || e), 'warn');
    return [];
  }
}

async function renderProjectList() {
  projUI.list.innerHTML = '<div class="proj-empty">加载中…</div>';
  const sdk = window.keepwork;
  if (!sdk?.token) {
    try { await ensureKeepworkLogin(); } catch (e) {
      projUI.list.innerHTML = `<div class="proj-empty">需要登录：${e.message || e}</div>`;
      return;
    }
  }
  const items = await listProjects();
  projUI.openHint.textContent = items.length
    ? `工作区“${PROJECT_WORKSPACE}”中共 ${items.length} 个文件。`
    : `工作区“${PROJECT_WORKSPACE}”中尚未保存任何文件。`;
  if (!items.length) {
    projUI.list.innerHTML = '<div class="proj-empty">暂无已保存项目。</div>';
    return;
  }
  projUI.list.innerHTML = '';
  const suffixRe = new RegExp(PROJECT_FILE_SUFFIX.replace(/\./g, '\\.') + '$');
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'proj-item';
    const isProjectFile = suffixRe.test(it.name);
    const stem = isProjectFile ? it.name.replace(suffixRe, '') : it.name;
    const meta = it.modifiedAt || it.updatedAt || it.mtime || '';
    const tag = isProjectFile ? '' : `<span class="meta" style="margin-left:6px; color:var(--warn);">[其他]</span>`;
    row.innerHTML = `
      <div style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;">
        <div>${stem}${tag}</div>
        ${meta ? `<div class="meta">${new Date(meta).toLocaleString()}</div>` : ''}
      </div>
      <div style="display:flex; gap:6px;">
        <button type="button" class="del-btn">删除</button>
      </div>`;
    row.addEventListener('click', async (e) => {
      if (e.target.classList.contains('del-btn')) return;
      if (!isProjectFile) {
        log(`“${it.name}”不是项目文件（需后缀 ${PROJECT_FILE_SUFFIX}）。`, 'warn');
        return;
      }
      await openProjectByName(stem);
      projUI.openDlg.close();
    });
    row.querySelector('.del-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`删除“${it.name}”？`)) return;
      const store = getOwnedStore();
      try {
        if (isProjectFile) {
          await store.clearPageData(stem);
        } else if (typeof store.deleteFile === 'function') {
          await store.deleteFile(it.name);
        } else {
          throw new Error('store 不支持 deleteFile。');
        }
        log(`已删除“${it.name}”。`, 'ok');
        renderProjectList();
      } catch (err) {
        log('删除失败：' + (err.message || err), 'err');
      }
    });
    projUI.list.appendChild(row);
  }
}

export async function openProjectByName(name) {
  const sdk = await ensureKeepworkLogin().catch(e => { log('需要登录：' + (e.message || e), 'err'); return null; });
  if (!sdk) return;
  const store = getOwnedStore();
  if (!store) { log('PersonalPageStore 不可用。', 'err'); return; }
  const fileName = projectFileName(name);
  try {
    const raw = await store.readFile(fileName);
    if (!raw) throw new Error('项目文件未找到。');
    const env = JSON.parse(raw);
    projectState.name = name;
    projectState.loadedFromUser = '';
    projectState.ownerUsername = getKwUsername();
    projUI.name.value = name;
    setReadonlyShareUI(false);
    applyProjectEnvelope(env);
    updateShareButton();
    localStorage.setItem(LS_LAST_PROJECT, name);
    log(`已打开项目“${name}”。`, 'ok');
    window.dispatchEvent(new CustomEvent('rpmm:projectOpened', { detail: { name } }));
  } catch (e) {
    log('打开失败：' + (e.message || e), 'err');
  }
}

export async function deleteProjectByName(name) {
  const projectName = sanitizeProjectName(name);
  if (!projectName) throw new Error('项目名称无效。');
  const sdk = await ensureKeepworkLogin().catch(e => { throw new Error('需要登录：' + (e.message || e)); });
  if (!sdk) throw new Error('Keepwork SDK 不可用。');
  const store = getOwnedStore();
  if (!store) throw new Error('PersonalPageStore 不可用。');

  try {
    await store.clearPageData(projectName);
  } catch (err) {
    if (typeof store.deleteFile === 'function') {
      await store.deleteFile(projectFileName(projectName));
    } else {
      throw err;
    }
  }

  if (projectState.name === projectName) {
    projectState.name = '';
    projUI.name.value = '';
    updateShareButton();
  }
  if (localStorage.getItem(LS_LAST_PROJECT) === projectName) {
    localStorage.removeItem(LS_LAST_PROJECT);
  }
  log(`已删除项目“${projectName}”。`, 'ok');
  return true;
}

export async function cloneProjectByName(sourceName, targetName) {
  const source = sanitizeProjectName(sourceName);
  const target = sanitizeProjectName(targetName);
  if (!source) throw new Error('源项目名称无效。');
  if (!target) throw new Error('目标项目名称无效。');
  if (source === target) throw new Error('目标名称不能与源项目相同。');

  const sdk = await ensureKeepworkLogin().catch(e => { throw new Error('需要登录：' + (e.message || e)); });
  if (!sdk) throw new Error('Keepwork SDK 不可用。');
  const store = getOwnedStore();
  if (!store) throw new Error('PersonalPageStore 不可用。');

  const sourceFile = projectFileName(source);
  const targetFile = projectFileName(target);
  const raw = await store.readFile(sourceFile);
  if (!raw) throw new Error('源项目不存在。');

  let payload = raw;
  try {
    const env = JSON.parse(raw);
    if (env && typeof env === 'object') {
      env.name = target;
      env.savedAt = new Date().toISOString();
      payload = JSON.stringify(env, null, 2);
    }
  } catch {
    // Keep raw content when it is not valid JSON.
  }

  await store.createFile(targetFile, payload);
  log(`已克隆项目“${source}”为“${target}”。`, 'ok');
  return target;
}

async function loadSharedProject(shareUser, projectname) {
  log(`正在加载分享项目：${shareUser}/${projectname}…`);
  const sdk = await loadKeepworkSDK().catch(e => { log('SDK 加载失败：' + (e.message || e), 'err'); return null; });
  if (!sdk) return;
  const store = sdk.personalPageStore;
  if (!store) { log('PersonalPageStore 不可用。', 'err'); return; }
  const stem = sanitizeProjectName(projectname);
  if (!stem) { log('分享链接中的 projectname 无效。', 'err'); return; }
  const fileName = stem + PROJECT_FILE_SUFFIX;
  const absPath = `//${shareUser}/${REMOTE_STORE_PATH}/${PROJECT_WORKSPACE}/${fileName}`;
  try {
    const raw = await store.readFile(absPath);
    if (!raw) throw new Error('未找到分享项目（可能是私有或已删除）。');
    const env = JSON.parse(raw);
    projectState.name = stem;
    projectState.loadedFromUser = shareUser;
    projectState.ownerUsername = shareUser;
    projUI.name.value = stem;
    setReadonlyShareUI(true);
    applyProjectEnvelope(env);
    updateShareButton();
    log(`已打开 ${shareUser} 分享的项目“${stem}”（只读）。`, 'ok');
    window.dispatchEvent(new CustomEvent('rpmm:projectOpened', { detail: { name: stem, shared: true } }));
  } catch (e) {
    log('加载分享项目失败：' + (e.message || e), 'err');
  }
}

function buildShareUrl() {
  const owner = projectState.ownerUsername || getKwUsername();
  if (!owner || !projectState.name) return '';
  const u = new URL(location.href);
  u.searchParams.delete('shareuser');
  u.searchParams.delete('projectname');
  u.searchParams.set('shareuser', owner);
  u.searchParams.set('projectname', projectState.name);
  return u.toString();
}

/* ---------------- workspace viewer ---------------- */
function destroyWorkspaceViewer() {
  if (state.workspaceViewerInstance && typeof state.workspaceViewerInstance.destroy === 'function') {
    try { state.workspaceViewerInstance.destroy(); } catch (e) { console.warn('WorkspaceViewer destroy failed:', e); }
  }
  state.workspaceViewerInstance = null;
}

function closeWorkspaceViewer() {
  if (projUI.workspaceModal) projUI.workspaceModal.style.display = 'none';
  destroyWorkspaceViewer();
}

async function openWorkspaceViewer() {
  const sdk = await ensureKeepworkLogin().catch(e => { log('Login required: ' + (e.message || e), 'err'); return null; });
  if (!sdk) return;
  const modal = projUI.workspaceModal;
  const host = projUI.workspaceHost;
  if (!modal || !host) return;
  destroyWorkspaceViewer();
  if (typeof window.createWorkspaceViewer !== 'function') {
    log('当前 SDK 构建不可用 WorkspaceViewer。', 'err');
    return;
  }
  modal.style.display = 'flex';
  try {
    state.workspaceViewerInstance = window.createWorkspaceViewer({
      container: host,
      workspace: PROJECT_WORKSPACE,
      hideTopbar: true,
      hideUserInfo: true,
      compact: true,
    });
  } catch (e) {
    log('打开工作区失败：' + (e.message || e), 'err');
    closeWorkspaceViewer();
  }
}

export function initProject() {
  projUI.newBtn.addEventListener('click', newProject);
  projUI.saveBtn.addEventListener('click', saveProject);
  if (projUI.topbarSaveBtn) projUI.topbarSaveBtn.addEventListener('click', saveProject);
  projUI.openBtn.addEventListener('click', () => {
    if (typeof projUI.openDlg.showModal === 'function') projUI.openDlg.showModal();
    else projUI.openDlg.setAttribute('open', '');
    renderProjectList();
  });
  if (projUI.workspaceBtn) projUI.workspaceBtn.addEventListener('click', openWorkspaceViewer);
  if (projUI.workspaceClose) projUI.workspaceClose.addEventListener('click', closeWorkspaceViewer);
  if (projUI.workspaceModal) projUI.workspaceModal.addEventListener('click', (e) => {
    if (e.target === projUI.workspaceModal) closeWorkspaceViewer();
  });
  projUI.refreshList.addEventListener('click', (e) => { e.preventDefault(); renderProjectList(); });
  projUI.shareBtn.addEventListener('click', () => {
    const url = buildShareUrl();
    if (!url) { log('请先保存项目以获取分享链接。', 'warn'); return; }
    projUI.shareUrl.value = url;
    if (typeof projUI.shareDlg.showModal === 'function') projUI.shareDlg.showModal();
    else projUI.shareDlg.setAttribute('open', '');
    setTimeout(() => projUI.shareUrl.select(), 50);
  });
  projUI.copyShare.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(projUI.shareUrl.value);
      log('已复制分享链接。', 'ok');
    } catch { projUI.shareUrl.select(); document.execCommand('copy'); }
  });
  projUI.name.addEventListener('change', () => {
    const v = sanitizeProjectName(projUI.name.value);
    projUI.name.value = v;
    projectState.name = v;
    updateShareButton();
  });

  projUI.loginBtn.addEventListener('click', async () => {
    const sdk = await loadKeepworkSDK().catch(e => { log('SDK 加载失败：' + (e.message || e), 'err'); return null; });
    if (!sdk) return;
    if (sdk.token) {
      if (!confirm('退出 Keepwork 登录？')) return;
      try { await sdk.logout?.(); } catch {}
      updateLoginButton();
      updateShareButton();
      log('已退出登录。', 'ok');
      window.dispatchEvent(new CustomEvent('rpmm:loginChanged', { detail: { loggedIn: false } }));
      return;
    }
    try {
      await ensureKeepworkLogin();
      updateLoginButton();
      if (!projectState.ownerUsername) projectState.ownerUsername = getKwUsername();
      updateShareButton();
      window.dispatchEvent(new CustomEvent('rpmm:loginChanged', { detail: { loggedIn: true } }));
    } catch (e) {
      log('登录失败：' + (e.message || e), 'err');
    }
  });

  // Avatar click toggles a profile dropdown (mirrors AIMovieMaker.html).
  setupProfileDropdown();
}

/* ---- Profile dropdown (account / logout) ---- */
function setupProfileDropdown() {
  const btn = document.getElementById('userProfileBtn');
  const dd = document.getElementById('profileDropdown');
  if (!btn || !dd) return;

  const closeDropdown = () => dd.classList.remove('open');

  function rebuildDropdown() {
    const sdk = window.keepwork || {};
    const u = sdk.user || {};
    const name = u.nickname || u.username || getKwUsername() || '已登录';
    const username = u.username || getKwUsername() || '';
    dd.innerHTML = `
      <div class="profile-header">
        <div class="profile-name">${escapeHtml(name)}</div>
        ${username && username !== name ? `<div class="profile-id">@${escapeHtml(username)}</div>` : ''}
      </div>
      <button type="button" class="profile-item" id="profileOpenProfile">
        👤 会员与用户信息
      </button>
      <div class="profile-divider"></div>
      <button type="button" class="profile-item danger" id="profileLogout">
        ↩️ 退出登录
      </button>
    `;
    dd.querySelector('#profileOpenProfile')?.addEventListener('click', async () => {
      closeDropdown();
      try {
        if (typeof sdk.showProfileWindow === 'function') {
          const result = await sdk.showProfileWindow();
          if (result && result.action === 'logout') {
            try { await sdk.logout?.(); } catch {}
            updateLoginButton();
            updateShareButton();
            window.dispatchEvent(new CustomEvent('rpmm:loginChanged', { detail: { loggedIn: false } }));
          } else if (sdk.token) {
            try { await sdk.getUserProfile?.({ forceRefresh: true }); } catch {}
            updateLoginButton();
          }
        } else {
          log('资料窗口不可用。', 'warn');
        }
      } catch (e) { console.error('Profile window error:', e); }
    });
    dd.querySelector('#profileLogout')?.addEventListener('click', () => {
      closeDropdown();
      projUI.loginBtn.click();
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dd.classList.contains('open')) { closeDropdown(); return; }
    rebuildDropdown();
    dd.classList.add('open');
  });
  document.addEventListener('click', (e) => {
    if (!dd.classList.contains('open')) return;
    if (!dd.contains(e.target) && e.target !== btn) closeDropdown();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDropdown(); });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------------- boot: handle ?shareuser=&projectname= and SDK init ----- */
export async function initProjectFlow() {
  // Reflect any cached login state immediately so we don't flash the 登录 button.
  try { updateLoginButton(); } catch {}

  loadKeepworkSDK().then(async () => {
    const sdk = window.keepwork;
    if (!sdk) return;

    // If a token was passed via URL (?token=… or #token=…), apply it before
    // validating so the rest of the boot flow sees the new session.
    try {
      const hashParams = new URLSearchParams((location.hash || '').slice(1));
      const queryParams = new URLSearchParams(location.search);
      const urlToken = hashParams.get('token') || queryParams.get('token');
      if (urlToken && urlToken !== sdk.token) {
        if (typeof sdk.setTokenAndRefresh === 'function') await sdk.setTokenAndRefresh(urlToken);
        else if (typeof sdk.setToken === 'function') sdk.setToken(urlToken);
      }
    } catch (e) { console.warn('[rpmm] URL token handling failed:', e); }

    // Validate the (cookie-restored or URL-supplied) token. A 401 here means
    // the saved session expired — clear it locally so the UI shows "登录".
    if (sdk.token) {
      try {
        if (typeof sdk.getUserProfile === 'function') {
          await sdk.getUserProfile({ useCache: false });
        }
      } catch (e) {
        console.warn('[rpmm] Saved session invalid, clearing:', e?.message || e);
        try { await sdk.logout?.(); } catch {}
      }
    }

    updateLoginButton();
    const u = getKwUsername();
    if (u && !projectState.ownerUsername) projectState.ownerUsername = u;
    updateShareButton();
    try {
      sdk.on?.('login', () => {
        updateLoginButton();
        const u2 = getKwUsername();
        if (u2 && !projectState.ownerUsername) projectState.ownerUsername = u2;
        updateShareButton();
        window.dispatchEvent(new CustomEvent('rpmm:loginChanged', { detail: { loggedIn: true } }));
      });
      sdk.on?.('logout', () => {
        updateLoginButton();
        updateShareButton();
        window.dispatchEvent(new CustomEvent('rpmm:loginChanged', { detail: { loggedIn: false } }));
      });
    } catch {}
  }).catch(() => {});

  const params = new URLSearchParams(location.search);
  const shareUser = params.get('shareuser');
  const projectname = params.get('projectname');
  if (shareUser && projectname) {
    await loadSharedProject(shareUser, projectname);
    return;
  }
  const last = localStorage.getItem(LS_LAST_PROJECT);
  if (last) projUI.name.value = last;
}
