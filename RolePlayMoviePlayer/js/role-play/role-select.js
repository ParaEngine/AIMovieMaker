// =================== Role-Play Movie — Role Selection Screen ===================

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Build the role-pick HTML for a given movie.
 * @param {import('./format.js').MovieConfig} movie
 */
export function buildRoleSelectHTML(movie) {
  const chars = movie.characters || [];
  const lineCount = movie.tracks.length;

  const lineCountByChar = new Map();
  for (const t of movie.tracks) {
    if (!t.speakerId) continue;
    lineCountByChar.set(t.speakerId, (lineCountByChar.get(t.speakerId) || 0) + 1);
  }

  // Default-select the speaker with the most lines (only one).
  let topId = '';
  let topCount = 0;
  for (const [id, n] of lineCountByChar) {
    if (n > topCount) { topCount = n; topId = id; }
  }

  const cards = chars.length === 0
    ? '<div class="rp-empty">影片未识别到角色，将以预览模式播放。</div>'
    : chars.map(c => {
        const n = lineCountByChar.get(c.id) || 0;
        const meta = [c.gender, c.age].filter(Boolean).join(' · ');
        const checked = c.id === topId ? 'checked' : '';
        return `
          <label class="rp-char-card" data-char-id="${escHtml(c.id)}">
            <input type="checkbox" class="rp-char-check" value="${escHtml(c.id)}" ${checked} />
            <div class="rp-char-body">
              <div class="rp-char-head">
                <span class="rp-char-name">${escHtml(c.name)}</span>
                <span class="rp-char-meta">${escHtml(meta)}</span>
                <span class="rp-char-lines">${n} 句台词</span>
              </div>
              <div class="rp-char-desc">${escHtml(c.description)}</div>
            </div>
          </label>`;
      }).join('');

  return `
    <div class="rp-role-screen">
      <div class="rp-role-title">🎬 ${escHtml(movie.title)}</div>
      <div class="rp-role-desc">
        共 ${lineCount} 句台词。<br>
        勾选你想扮演的角色 — 当 TA 开口时，影片会暂停等你跟读。
      </div>
      <div class="rp-role-list">${cards}</div>
      <div class="rp-role-actions">
        <button type="button" class="rp-btn rp-btn-ghost" id="rpSelectAll">全选</button>
        <button type="button" class="rp-btn rp-btn-ghost" id="rpSelectNone">清空</button>
        <button type="button" class="rp-btn rp-btn-ghost" id="rpPreviewOnly">仅预览（不配音）</button>
        <button type="button" class="rp-btn rp-btn-primary" id="rpStartPlay">开始播放</button>
      </div>
    </div>
  `;
}

/**
 * Wire up the role-pick screen.
 * @param {HTMLElement} root - container holding the role-screen markup
 * @param {import('./format.js').MovieConfig} movie
 * @param {(opts: {playerRoleIds: Set<string>, previewOnly: boolean}) => void} onStart
 */
export function bindRoleSelect(root, movie, onStart) {
  const checks = () => Array.from(root.querySelectorAll('.rp-char-check'));
  const selected = () => new Set(checks().filter(c => c.checked).map(c => c.value));

  root.querySelector('#rpSelectAll')?.addEventListener('click', () => {
    checks().forEach(c => { c.checked = true; });
  });
  root.querySelector('#rpSelectNone')?.addEventListener('click', () => {
    checks().forEach(c => { c.checked = false; });
  });
  root.querySelector('#rpPreviewOnly')?.addEventListener('click', () => {
    onStart({ playerRoleIds: new Set(), previewOnly: true });
  });
  root.querySelector('#rpStartPlay')?.addEventListener('click', () => {
    const roles = selected();
    onStart({ playerRoleIds: roles, previewOnly: roles.size === 0 });
  });
}
