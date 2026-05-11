// =================== Role-Play Movie — Bootstrap ===================
// 1. 列出 videoParser 工作区中所有已解析的项目，让用户选择
// 2. 解析项目 envelope，提取 videoUrl + 完整 videoParser output JSON
// 3. 显示角色选择屏（当 characters 非空时）
// 4. 把所选角色对应的台词翻译为 Vocabulary StoryConfig
// 5. 写入 window.__roleplayMovieConfig 并动态加载 ../modules/gameplay.js

import {
  buildMovie,
  loadVideoParserProject,
  listVideoParserProjects,
  loadSharedVideoParserProject,
  loadFromLocalFile,
  loadFromPaste,
  getUrlParams,
} from './role-play/loader.js';
import { buildRoleSelectHTML, bindRoleSelect } from './role-play/role-select.js';
import { buildLoaderScreen, renderProjectList } from './role-play/flow.js';
import { parseTimestamp } from './role-play/format.js';

const $ = (id) => document.getElementById(id);

/** Build a Vocabulary-compatible StoryConfig from a normalized MovieConfig.
 *
 * In role-play-movie mode we always include ALL tracks (so subtitles for other
 * characters still appear in the bottom panel), and tag each track with an
 * `isPlayer` flag indicating whether it belongs to a character the user
 * selected. previewOnly => no player tracks at all.
 */
function toStoryConfig(movie, { playerRoleIds, previewOnly }) {
  const subtitleTracks = movie.tracks.map((t, i) => ({
    id: t.id || `t_${i}`,
    startMs: t.startMs,
    endMs: t.endMs,
    targetText: t.targetText,
    nativeText: speakerLabel(movie, t),
    speakerId: t.speakerId || '',
    isPlayer: !previewOnly && playerRoleIds.has(t.speakerId),
    nativeColor: '#2F80ED',
    targetColor: '#EB5757',
    wordTiming: [],
    nativeSegments: [],
    gloss: '',
    ipa: '',
    phonemes: null,
  }));

  return {
    title: movie.title,
    description: movie.summary || (movie.characters?.length
      ? `共 ${movie.tracks.length} 句台词`
      : ''),
    allowSkip: true,
    rolePlayMovie: true,
    videoLengthMs: movie.videoLengthMs || 0,
    clipScenes: Array.isArray(movie.raw?.shortClips)
      ? movie.raw.shortClips.map((c, i) => ({
          id: c.id || `clip_${i}`,
          startMs: parseTimestamp(c.start),
          endMs: parseTimestamp(c.end),
          description: String(c.description || c.scene_description || c.summary || '').trim(),
        })).filter(s => s.endMs > s.startMs)
      : [],
    scenes: [
      {
        id: 'scene_main',
        videoSrc: movie.videoUrl,
        posterSrc: movie.posterUrl || '',
        subtitleTracks,
      },
    ],
  };
}

function speakerLabel(movie, track) {
  if (!track.speakerId) return '';
  const c = movie.characterById?.get?.(track.speakerId);
  return c ? c.name : track.speakerId;
}

class RolePlayBootstrap {
  constructor() {
    this.movie = null;
    this.overlay = null;
  }

  async start() {
    this._mountOverlay();
    this._renderLoader();
  }

  _mountOverlay() {
    let overlay = $('rpLoaderOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'rpLoaderOverlay';
      overlay.className = 'rp-loader-overlay';
      document.body.appendChild(overlay);
    }
    this.overlay = overlay;
  }

  _renderLoader(initialError) {
    const root = this.overlay;
    root.innerHTML = buildLoaderScreen();
    root.classList.remove('hidden');

    const params = getUrlParams();
    const msg = $('rpLoaderMsg');
    const errEl = $('rpLoaderErr');
    if (initialError) errEl.textContent = initialError;

    const showControls = () => {
      msg.style.display = 'none';
      $('rpLoaderControls').style.display = 'flex';
    };

    const setError = (e) => {
      errEl.textContent = (e && (e.message || String(e))) || '';
    };

    const refreshList = async () => {
      const listEl = $('rpProjectList');
      if (!listEl) return;
      listEl.innerHTML = '<div class="rp-empty">加载中…</div>';
      setError('');
      try {
        const items = await listVideoParserProjects();
        renderProjectList(listEl, items, async (name) => {
          msg.textContent = `加载 "${name}"…`;
          msg.style.display = '';
          $('rpLoaderControls').style.display = 'none';
          try {
            const { rawInner, videoUrl, title } = await loadVideoParserProject(name);
            await this._buildAndPick(rawInner, { title: title || name, videoUrl });
          } catch (e) {
            setError(e);
            showControls();
          }
        });
      } catch (e) {
        listEl.innerHTML = `<div class="rp-empty">无法加载项目列表：${(e && e.message) || e}<br>请先登录 Keepwork（点击右上角“登录”）。</div>`;
      }
    };

    $('rpRefreshListBtn').onclick = () => refreshList();
    $('rpChooseLocalBtn').onclick = () => $('rpLocalPicker').click();
    $('rpLocalPicker').onchange = async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      try {
        const { rawInner, videoUrl, title } = await loadFromLocalFile(f);
        await this._buildAndPick(rawInner, { title: title || f.name, videoUrl: videoUrl || params.video });
      } catch (e) { setError(e); }
    };
    $('rpPasteToggleBtn').onclick = () => {
      const w = $('rpPasteWrap');
      w.style.display = w.style.display === 'none' ? 'flex' : 'none';
    };
    $('rpLoadPasteBtn').onclick = async () => {
      const text = $('rpPasteArea').value.trim();
      if (!text) { setError(new Error('请粘贴 JSON 内容')); return; }
      const videoUrl = $('rpVideoUrl').value.trim();
      try {
        const { rawInner, videoUrl: u, title } = loadFromPaste(text, { videoUrl });
        await this._buildAndPick(rawInner, { title, videoUrl: u || videoUrl });
      } catch (e) { setError(e); }
    };

    // Shared (read-only) project via URL?
    if (params.shareUser && params.file) {
      msg.textContent = `加载共享项目 ${params.shareUser}/${params.file}…`;
      loadSharedVideoParserProject(params.shareUser, params.file)
        .then(({ rawInner, videoUrl, title }) =>
          this._buildAndPick(rawInner, { title: title || params.file, videoUrl: videoUrl || params.video }))
        .catch((e) => { setError(e); showControls(); refreshList(); });
      return;
    }

    // Direct project name in URL?
    if (params.file) {
      msg.textContent = `加载 "${params.file}"…`;
      loadVideoParserProject(params.file)
        .then(({ rawInner, videoUrl, title }) =>
          this._buildAndPick(rawInner, { title: title || params.file, videoUrl: videoUrl || params.video }))
        .catch((e) => { setError(e); showControls(); refreshList(); });
      return;
    }

    showControls();
    refreshList();
  }

  async _buildAndPick(rawInner, opts = {}) {
    const movie = buildMovie(rawInner, opts);
    this.movie = movie;
    if (movie.characters && movie.characters.length > 0) {
      this._renderRolePick();
    } else {
      this._launchGame({ playerRoleIds: new Set(), previewOnly: true });
    }
  }

  _renderRolePick() {
    const root = this.overlay;
    root.innerHTML = buildRoleSelectHTML(this.movie);
    bindRoleSelect(root, this.movie, ({ playerRoleIds, previewOnly }) => {
      this._launchGame({ playerRoleIds, previewOnly });
    });
  }

  async _launchGame({ playerRoleIds, previewOnly }) {
    const cfg = toStoryConfig(this.movie, { playerRoleIds, previewOnly });
    if (!cfg.scenes?.[0]?.videoSrc) {
      alert('该项目缺少 videoUrl，请在 videoParser 中确认输入 URL 后再保存。');
      return;
    }
    if (!cfg.scenes[0].subtitleTracks.length) {
      alert('未找到任何台词。请先选择至少一个角色，或导入包含字幕的项目。');
      this._renderRolePick();
      return;
    }

    window.__roleplayMovieConfig = cfg;
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';

    try {
      await import('../modules/gameplay.js');
    } catch (e) {
      console.error('[RolePlay] Failed to load game module', e);
      alert('游戏模块加载失败：' + (e.message || e));
    }
  }
}

const boot = new RolePlayBootstrap();
window.__rolePlayBootstrap = boot;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => boot.start());
} else {
  boot.start();
}
