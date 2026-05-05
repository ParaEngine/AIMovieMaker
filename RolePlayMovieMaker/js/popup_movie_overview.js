// ============ Movie Overview Popup ============
// Shows top-level video summary and cast information from the parsed JSON.

import { state } from './state.js';
import { MovieData } from './movieData.js';
import { parseTimestamp, formatTimecode } from './utils.js';

const POPUP_ID = 'movieOverviewPopup';

function ensurePopup() {
  let popup = document.getElementById(POPUP_ID);
  if (popup) return popup;

  popup = document.createElement('div');
  popup.id = POPUP_ID;
  popup.className = 'movie-overview-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');
  popup.setAttribute('aria-labelledby', 'movieOverviewTitle');
  popup.innerHTML = `
    <div class="movie-overview-card">
      <div class="movie-overview-head">
        <div>
          <h2 id="movieOverviewTitle">概要/角色列表</h2>
          <div class="movie-overview-sub" id="movieOverviewSub"></div>
        </div>
        <button type="button" class="secondary movie-overview-close" id="movieOverviewClose" aria-label="关闭">关闭</button>
      </div>
      <div class="movie-overview-content" id="movieOverviewContent"></div>
    </div>`;
  document.body.appendChild(popup);

  popup.addEventListener('click', (event) => {
    if (event.target === popup) hideMovieOverviewPopup();
  });
  popup.querySelector('#movieOverviewClose')?.addEventListener('click', hideMovieOverviewPopup);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popup.classList.contains('open')) hideMovieOverviewPopup();
  });
  return popup;
}

function appendTextBlock(parent, className, text) {
  const block = document.createElement('div');
  block.className = className;
  block.textContent = text;
  parent.appendChild(block);
  return block;
}

function countCharacterUsage(data, characterId) {
  const usage = { clips: 0, lines: 0 };
  if (!data || !Array.isArray(data.shortClips)) return usage;
  for (const clip of data.shortClips) {
    if (Array.isArray(clip.characters) && clip.characters.includes(characterId)) usage.clips += 1;
    if (!Array.isArray(clip.subtitles)) continue;
    for (const subtitle of clip.subtitles) {
      if (subtitle.speaker === characterId) usage.lines += 1;
    }
  }
  return usage;
}

function durationText(data) {
  const explicit = data?.videoLength || data?.duration_seconds;
  if (explicit) {
    const seconds = parseTimestamp(explicit);
    return seconds ? formatTimecode(seconds) : String(explicit);
  }
  let maxEnd = 0;
  if (Array.isArray(data?.shortClips)) {
    for (const clip of data.shortClips) maxEnd = Math.max(maxEnd, parseTimestamp(clip.end));
  }
  return maxEnd ? formatTimecode(maxEnd) : '未知';
}

function renderOverview(popup, data) {
  const sub = popup.querySelector('#movieOverviewSub');
  const content = popup.querySelector('#movieOverviewContent');
  content.innerHTML = '';

  if (!data || typeof data !== 'object') {
    sub.textContent = '尚未加载可预览的标注 JSON。';
    const empty = document.createElement('div');
    empty.className = 'movie-overview-empty';
    empty.textContent = '请先在阶段 2 生成或粘贴 JSON。';
    content.appendChild(empty);
    return;
  }

  const scenes = MovieData.getScenes(data);
  const subtitles = MovieData.getSubtitles(data);
  const characters = Array.isArray(data.characters) ? data.characters : [];
  sub.textContent = `${durationText(data)} · ${data.language || '未知语言'} · ${scenes.length} 个场景 · ${subtitles.length} 条字幕`;

  const summarySection = document.createElement('section');
  summarySection.className = 'movie-overview-section';
  appendTextBlock(summarySection, 'movie-overview-section-title', '视频概要');
  appendTextBlock(summarySection, 'movie-overview-summary', data.summary || '暂无概要。');
  content.appendChild(summarySection);

  const characterSection = document.createElement('section');
  characterSection.className = 'movie-overview-section';
  appendTextBlock(characterSection, 'movie-overview-section-title', '角色列表');

  if (!characters.length) {
    appendTextBlock(characterSection, 'movie-overview-empty inline', '暂无角色。');
  } else {
    const grid = document.createElement('div');
    grid.className = 'movie-overview-character-grid';
    for (const character of characters) {
      const card = document.createElement('article');
      card.className = 'movie-overview-character';

      const title = document.createElement('div');
      title.className = 'movie-overview-character-title';
      title.textContent = character.name || character.id || '未命名角色';
      card.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'movie-overview-character-meta';
      const usage = countCharacterUsage(data, character.id);
      const fields = [character.id, character.gender, character.age].filter(Boolean).join(' · ');
      meta.textContent = `${fields || '无 ID'} · ${usage.clips} 个场景 · ${usage.lines} 句台词`;
      card.appendChild(meta);

      const description = document.createElement('p');
      description.textContent = character.description || '暂无角色描述。';
      card.appendChild(description);

      grid.appendChild(card);
    }
    characterSection.appendChild(grid);
  }

  content.appendChild(characterSection);
}

export function showMovieOverviewPopup() {
  const popup = ensurePopup();
  renderOverview(popup, state.lastResultJson);
  popup.classList.add('open');
  popup.querySelector('#movieOverviewClose')?.focus();
}

export function hideMovieOverviewPopup() {
  const popup = document.getElementById(POPUP_ID);
  if (popup) popup.classList.remove('open');
}
