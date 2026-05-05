// =================== Role-Play Movie — Flow Screens ===================

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildLoaderScreen() {
  return `
    <div class="rp-flow-screen">
      <div class="rp-flow-title">🎬 角色扮演 <span>互动电影</span></div>
      <div class="rp-flow-msg" id="rpLoaderMsg">准备加载…</div>
      <div class="rp-flow-controls" id="rpLoaderControls" style="display:none">
        <div class="rp-flow-msg">从 videoParser 工作区选择一个已解析的项目：</div>
        <div class="rp-project-list" id="rpProjectList">
          <div class="rp-empty">加载中…</div>
        </div>
        <div class="rp-row">
          <button class="rp-btn rp-btn-ghost" id="rpRefreshListBtn">刷新列表</button>
          <button class="rp-btn rp-btn-ghost" id="rpChooseLocalBtn">选择本地文件…</button>
          <button class="rp-btn rp-btn-ghost" id="rpPasteToggleBtn">粘贴 JSON</button>
        </div>
        <input id="rpLocalPicker" type="file" accept=".md,.json,.aimovie" style="display:none" />
        <div id="rpPasteWrap" style="display:none">
          <label class="rp-field">
            <span>粘贴 videoParser 项目 JSON 或原始 output JSON</span>
            <textarea id="rpPasteArea" placeholder='{ "format":"videoParser", "input":{"url":"https://..."}, "output":{ "characters":[...], "shortClips":[...] } }'></textarea>
          </label>
          <div class="rp-row">
            <label class="rp-field" style="flex:1">
              <span>视频 URL（若 JSON 缺少 videoUrl）</span>
              <input id="rpVideoUrl" type="text" placeholder="https://..." />
            </label>
            <button class="rp-btn rp-btn-primary" id="rpLoadPasteBtn">加载</button>
          </div>
        </div>
        <div class="rp-flow-link-row">
          <a class="rp-flow-link" href="../RolePlayMovieMaker/role-play-movie-maker.html" target="_blank" rel="noopener">🎞️ 制作互动视频</a>
        </div>
      </div>
      <div class="rp-flow-err" id="rpLoaderErr"></div>
    </div>
  `;
}

function escHtmlInline(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Render the videoParser project list inside #rpProjectList.
 * @param {HTMLElement} listEl
 * @param {Array<{name:string, fileName:string, modifiedAt?:string}>} items
 * @param {(name:string) => void} onPick
 */
export function renderProjectList(listEl, items, onPick) {
  if (!listEl) return;
  if (!items || !items.length) {
    listEl.innerHTML = '<div class="rp-empty">videoParser 工作区暂无项目。先在 videoParser 中解析并保存一个视频项目。</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'rp-project-item';
    const meta = it.modifiedAt ? new Date(it.modifiedAt).toLocaleString() : '';
    row.innerHTML = `
      <span class="rp-project-name">${escHtmlInline(it.name)}</span>
      ${meta ? `<span class="rp-project-meta">${escHtmlInline(meta)}</span>` : ''}
    `;
    row.addEventListener('click', () => onPick(it.name));
    listEl.appendChild(row);
  }
}

export function buildResultScreen(summary) {
  const stars = '⭐'.repeat(summary.stars) + '☆'.repeat(Math.max(0, 3 - summary.stars));
  return `
    <div class="rp-flow-screen rp-result-screen">
      <div class="rp-flow-title">🎉 影片完成</div>
      <div class="rp-result-stars">${stars}</div>
      <div class="rp-result-stats">
        通过台词：${summary.passed} / ${summary.total}<br>
        总分：${summary.score}<br>
        重试次数：${summary.retries}
      </div>
      <div class="rp-row">
        <button class="rp-btn rp-btn-primary" id="rpReplayBtn">再来一次</button>
        <button class="rp-btn rp-btn-ghost" id="rpBackToLoadBtn">换一部</button>
      </div>
    </div>
  `;
}

export function buildPreviewDoneScreen(movieTitle) {
  return `
    <div class="rp-flow-screen rp-result-screen">
      <div class="rp-flow-title">🎬 预览结束</div>
      <div class="rp-result-stats">${escHtml(movieTitle)}<br>已浏览全部内容。</div>
      <div class="rp-row">
        <button class="rp-btn rp-btn-primary" id="rpReplayBtn">再次播放</button>
        <button class="rp-btn rp-btn-ghost" id="rpBackToLoadBtn">换一部</button>
      </div>
    </div>
  `;
}
