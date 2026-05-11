// ============ View: Stage 3 — Video Annotation Editor ============
// WYSIWYG editor for the parsed scene-description JSON. Hosts and owns the
// timeline player, tracks, and scene/subtitle preview canvas.

import { ui } from './ui.js';
import { state, media, projectState } from './state.js';
import { parseTimestamp, formatTimecode, log, wrapMeasure, wrapText, roundRect, colorForSpeaker } from './utils.js';
import { mediaCurrentTime, mediaDuration, mediaHasSource, mediaSeek, mediaPause, mediaPaused, mediaPlay } from './media.js';
import { registerView, gotoPrevStage, gotoNextStage } from './views.js';
import { MovieData } from './movieData.js';
import { showMovieOverviewPopup } from './popup_movie_overview.js';
import { updateParseVideoResultSummary } from './view_parse_video.js';

const MIN_SCENE_LENGTH = 0.05;
const MIN_SUBTITLE_LENGTH = 0.05;
const MAX_TIME_EDIT_DELTA = 1;

export function registerAnnotationEditorView() {
  registerView({
    id: 'stage3',
    label: '标注编辑器',
    stage: 3,
    mount: mountStage3,
    onHide: mediaPause,
  });
}

function mountStage3(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1>③ 标注编辑器</h1>
        <div class="vh-sub">在时间轴上预览阶段 2 生成或编辑的场景描述 JSON。</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="secondary" id="btnStage3Prev">← 解析</button>
        <button type="button" id="btnStage3Next">生成互动 →</button>
      </div>
    </div>

    <section class="panel" id="timelinePanel">
      <div class="timeline-panel-head">
        <h2>视频 + 时间轴</h2>
        <button type="button" class="secondary" id="btnMovieOverview">概要/角色(0)</button>
      </div>
      <div class="timeline-grid">
        <div class="player-row">
          <div class="player-cell">
            <h3 class="video-title" id="timelineSourceHint" title="尚未加载视频。">
              <label class="icon-file-btn" for="timelineFileInput" title="选择本地视频文件" aria-label="选择本地视频文件">📂</label>
              <span>视频</span>
              <span class="source-label">尚未加载视频</span>
            </h3>
            <input class="timeline-file-input" type="file" id="timelineFileInput" accept="video/mp4,video/*" />
            <video id="timelineVideo" controls></video>
            <div id="timelineYT" style="display:none; width:100%; aspect-ratio:16/9; background:black;"></div>
          </div>
          <div class="player-cell">
            <h3>场景 + 字幕预览</h3>
            <canvas id="previewCanvas" width="960" height="540"></canvas>
          </div>
        </div>
        <div class="timeline-toolbar">
          <label class="timeline-zoom-label" for="timelineZoom">缩放</label>
          <input type="range" id="timelineZoom" min="1" max="40" step="1" value="6" />
          <span id="timelineZoomValue" class="timeline-zoom-value">6 px/s</span>
        </div>
        <div class="timeline-wrap">
          <div class="timeline-scroll" id="timelineScroll">
            <div class="timeline-inner" id="timelineInner">
              <div class="time-ruler" id="timeRuler"></div>
              <div class="track" id="trackSubs">
                <div class="track-label" id="trackSubsLabel">字幕 <span class="track-count" id="trackSubsCount">(0)</span></div>
                <div class="timeline-empty" id="emptySubs">暂无字幕。</div>
              </div>
              <div class="track" id="trackScenes">
                <div class="track-label" id="trackScenesLabel">场景 <span class="track-count" id="trackScenesCount">(0)</span></div>
                <div class="timeline-empty" id="emptyScenes">暂无场景。</div>
              </div>
              <div class="track interaction-track" id="trackInteractionPoints">
                <div class="track-label" id="trackInteractionPointsLabel">互动 IP <span class="track-count" id="trackInteractionPointsCount">(0)</span></div>
                <div class="timeline-empty" id="emptyInteractionPoints">暂无互动点。</div>
              </div>
              <div class="time-cursor" id="timeCursor" style="display:none;"></div>
            </div>
          </div>
        </div>
        <div class="scene-editor" id="sceneEditor">
          <div class="scene-editor-empty" id="sceneEditorEmpty">选择一段场景或字幕后，可在这里编辑起止时间、播放状态与字幕内容。</div>
          <form class="scene-editor-form" id="sceneEditorForm" hidden>
            <div class="scene-editor-head">
              <h3 id="sceneEditorTitle">场景属性</h3>
              <div class="scene-editor-actions">
                <button type="button" class="secondary" id="subtitleAdd">添加字幕</button>
                <label class="scene-toggle"><input type="checkbox" id="sceneDisabled" /> 禁用播放</label>
              </div>
            </div>
            <div class="scene-editor-grid">
              <label>开始时间<input type="text" id="sceneStart" inputmode="decimal" autocomplete="off" /></label>
              <label>结束时间<input type="text" id="sceneEnd" inputmode="decimal" autocomplete="off" /></label>
              <label class="wide">场景描述<textarea id="sceneDescription" rows="3" spellcheck="false"></textarea></label>
              <label class="wide">画面文字<textarea id="sceneOnScreenText" rows="2" spellcheck="false"></textarea></label>
            </div>
            <div class="subtitle-editor-panel">
              <div class="subtitle-editor-head">
                <h3>字幕属性</h3>
                <button type="button" class="secondary" id="subtitleDelete" disabled>删除字幕</button>
              </div>
              <div class="scene-editor-empty" id="subtitleEditorEmpty">选择时间轴上的字幕，或点击“添加字幕”。</div>
              <div class="subtitle-list" id="subtitleList" hidden></div>
              <div class="subtitle-editor-body" id="subtitleEditorBody" hidden>
                <div class="scene-editor-grid subtitle-editor-grid">
                  <label>开始时间<input type="text" id="subtitleStart" inputmode="decimal" autocomplete="off" /></label>
                  <label>结束时间<input type="text" id="subtitleEnd" inputmode="decimal" autocomplete="off" /></label>
                  <label>说话人<input type="text" id="subtitleSpeaker" list="subtitleSpeakerOptions" autocomplete="off" /></label>
                  <label class="wide">字幕文本<textarea id="subtitleText" rows="2" spellcheck="false"></textarea></label>
                  <label class="scene-toggle subtitle-toggle"><input type="checkbox" id="subtitleDisabled" /> 禁用字幕</label>
                </div>
                <datalist id="subtitleSpeakerOptions"></datalist>
              </div>
            </div>
            <div class="interaction-editor-panel" id="interactionEditorPanel">
              <div class="subtitle-editor-head">
                <h3>互动点属性</h3>
              </div>
              <div class="scene-editor-empty" id="interactionEditorEmpty">选择时间轴上的互动点以编辑。</div>
              <div class="interaction-editor-body" id="interactionEditorBody" hidden>
                <label class="interaction-json-label">JSON<textarea id="interactionJson" rows="7" spellcheck="false"></textarea></label>
                <div class="hint">直接编辑当前互动点对象。失焦后会解析并同步到阶段 4 的 Interaction Points JSON。</div>
              </div>
            </div>
            <div class="hint">场景时间每次最多调整 1 秒；若边界接触相邻场景，会自动顺延以避免重叠。字幕时间会限制在所属场景内。</div>
          </form>
        </div>
      </div>
    </section>

  `;

  container.querySelector('#btnStage3Prev').addEventListener('click', gotoPrevStage);
  container.querySelector('#btnStage3Next').addEventListener('click', gotoNextStage);
  container.querySelector('#btnMovieOverview').addEventListener('click', showMovieOverviewPopup);
  updateMovieOverviewButton();
}

function updateMovieOverviewButton() {
  const button = document.getElementById('btnMovieOverview');
  if (!button) return;
  const characterCount = Array.isArray(state.lastResultJson?.characters) ? state.lastResultJson.characters.length : 0;
  button.textContent = `概要/角色(${characterCount})`;
}

function getSceneRecords(data = state.lastResultJson) {
  if (!data || !Array.isArray(data.shortClips)) return [];
  return data.shortClips.map((clip, index) => ({
    clip,
    index,
    start: parseTimestamp(clip.start),
    end: parseTimestamp(clip.end),
    disabled: !!clip.disabled,
    description: clip.scene?.description || '',
    on_screen_text: clip.scene?.on_screen_text || '',
    characters: Array.isArray(clip.characters) ? clip.characters : [],
  }));
}

function getSubtitleRecords(data = state.lastResultJson) {
  const records = [];
  if (!data || !Array.isArray(data.shortClips)) return records;
  data.shortClips.forEach((clip, clipIndex) => {
    if (!Array.isArray(clip.subtitles)) return;
    clip.subtitles.forEach((subtitle, subtitleIndex) => {
      records.push({
        ...subtitle,
        subtitle,
        clipIndex,
        subtitleIndex,
        disabled: !!clip.disabled || !!subtitle.disabled,
        clipDisabled: !!clip.disabled,
        start: subtitle.start,
        end: subtitle.end,
      });
    });
  });
  return records;
}

function getInteractionPointRecords(data = state.interactionPoints) {
  const list = Array.isArray(data) ? data : (Array.isArray(data?.interactionPoints) ? data.interactionPoints : []);
  return list.map((point, index) => {
    const timeValue = point.time || point.timestamp || point.start || point.at || 0;
    const time = parseTimestamp(timeValue);
    return {
      point,
      index,
      id: point.id || `ip_${index + 1}`,
      time,
      type: point.type || point.skillType || 'interaction',
      title: point.title || point.label || point.prompt || point.value || `IP ${index + 1}`,
      tips: point.tips || point.prompt || point.value || '',
      disabled: !!point.disabled,
    };
  }).filter(point => isFinite(point.time) && point.time >= 0)
    .sort((a, b) => a.time - b.time);
}

function formatEditableTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value - h * 3600 - m * 60;
  const sec = s.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(5, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function activeSceneAt(time, includeDisabled = false) {
  return getSceneRecords().find(scene => {
    if (!includeDisabled && scene.disabled) return false;
    return time >= scene.start && time < scene.end;
  });
}

function applyTimelineScale() {
  if (!ui.timelineInner) return;
  const baseWidth = ui.timelineInner.parentElement?.clientWidth || 720;
  const durationWidth = state.timelineDuration
    ? Math.ceil(state.timelineDuration * state.timelineZoomPxPerSecond)
    : baseWidth;
  ui.timelineInner.style.width = `${Math.max(baseWidth, durationWidth)}px`;
  if (ui.timelineZoom) ui.timelineZoom.value = String(state.timelineZoomPxPerSecond);
  if (ui.timelineZoomValue) ui.timelineZoomValue.textContent = `${state.timelineZoomPxPerSecond} px/s`;
}

function updateTrackCounts(subtitleCount, sceneCount, interactionPointCount) {
  if (ui.trackSubsCount) ui.trackSubsCount.textContent = `(${subtitleCount})`;
  if (ui.trackScenesCount) ui.trackScenesCount.textContent = `(${sceneCount})`;
  if (ui.trackInteractionPointsCount) ui.trackInteractionPointsCount.textContent = `(${interactionPointCount})`;
}

function updateTimelineScrollAnchor() {
  if (!ui.timelineInner || !ui.timelineScroll) return;
  ui.timelineInner.style.setProperty('--timeline-scroll-left', `${ui.timelineScroll.scrollLeft}px`);
}

export function rebuildTimeline() {
  const data = state.lastResultJson;
  for (const track of [ui.trackSubs, ui.trackScenes, ui.trackInteractionPoints]) {
    if (!track) continue;
    [...track.querySelectorAll('.bar')].forEach(bar => bar.remove());
  }
  state.timelineSubBars = [];
  state.timelineSceneBars = [];
  state.timelineIPBars = [];

  const subs = getSubtitleRecords(data);
  const scenes = getSceneRecords(data);
  const interactionPoints = getInteractionPointRecords();
  updateParseVideoResultSummary(data);
  updateMovieOverviewButton();
  updateTrackCounts(subs.length, scenes.length, interactionPoints.length);
  if (scenes.length && !scenes.some(scene => scene.index === state.selectedSceneIndex)) {
    state.selectedSceneIndex = scenes[0].index;
  } else if (!scenes.length) {
    state.selectedSceneIndex = null;
  }
  ui.emptySubs.style.display = subs.length ? 'none' : '';
  ui.emptyScenes.style.display = scenes.length ? 'none' : '';
  if (ui.emptyInteractionPoints) ui.emptyInteractionPoints.style.display = interactionPoints.length ? 'none' : '';

  let duration = (data && (parseTimestamp(data.videoLength) || Number(data.duration_seconds))) || 0;
  if (!duration && mediaDuration() && isFinite(mediaDuration())) {
    duration = mediaDuration();
  }
  if (!duration) {
    const all = [...subs, ...scenes];
    all.push(...interactionPoints.map(point => ({ end: point.time })));
    for (const item of all) duration = Math.max(duration, parseTimestamp(item.end) || 0);
  }
  state.timelineDuration = duration || 0;

  applyTimelineScale();
  updateTimelineScrollAnchor();
  renderRuler();
  for (const item of subs) addBar(ui.trackSubs, item, false, state.timelineSubBars);
  for (const item of scenes) addBar(ui.trackScenes, item, true, state.timelineSceneBars);
  for (const item of interactionPoints) addInteractionPointBar(item);

  ui.timeCursor.style.display = state.timelineDuration > 0 ? 'block' : 'none';
  updateCursor();
  updateActiveBars();
  updateReadout();
  renderSceneEditor();
  drawPreviewCanvas();
}

function addInteractionPointBar(item) {
  if (!state.timelineDuration || !ui.trackInteractionPoints) return;
  const leftPercent = (item.time / state.timelineDuration) * 100;
  const bar = document.createElement('div');
  bar.className = 'bar interaction-point';
  if (item.disabled) bar.classList.add('disabled');
  bar.style.left = leftPercent + '%';
  bar.style.width = 'max(14px, 0.8%)';
  bar.textContent = item.type;
  bar.title = `${formatTimecode(item.time)}\n${item.type}\n${item.title}`;
  if (item.index === state.selectedInteractionPointIndex) bar.classList.add('selected');
  bar.addEventListener('click', (event) => {
    event.stopPropagation();
    selectInteractionPoint(item.index);
    seekTo(item.time, { preservePlayback: true });
  });
  ui.trackInteractionPoints.appendChild(bar);
  state.timelineIPBars.push({ el: bar, start: item.time, end: item.time + 0.4, disabled: !!item.disabled, id: item.id, index: item.index, point: item.point });
}

function renderRuler() {
  ui.timeRuler.innerHTML = '';
  if (!state.timelineDuration) return;
  const niceSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const target = state.timelineDuration / 8;
  const step = niceSteps.find(seconds => seconds >= target) || niceSteps[niceSteps.length - 1];
  for (let time = 0; time <= state.timelineDuration + 0.001; time += step) {
    const percent = (time / state.timelineDuration) * 100;
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.left = percent + '%';
    ui.timeRuler.appendChild(tick);
    const label = document.createElement('span');
    label.style.left = percent + '%';
    label.textContent = formatTimecode(time);
    ui.timeRuler.appendChild(label);
  }
}

function addBar(track, item, isScene, store) {
  if (!state.timelineDuration) return;
  const start = Math.max(0, parseTimestamp(item.start) || 0);
  const end = Math.max(start, parseTimestamp(item.end) || start);
  const leftPercent = (start / state.timelineDuration) * 100;
  const widthPercent = Math.max(0.4, ((end - start) / state.timelineDuration) * 100);
  const bar = document.createElement('div');
  bar.className = 'bar' + (isScene ? ' scene' : '');
  if (item.disabled) bar.classList.add('disabled');
  if (isScene && item.index === state.selectedSceneIndex) bar.classList.add('selected');
  if (!isScene && subtitleRefEquals(item, state.selectedSubtitleRef)) bar.classList.add('selected');
  bar.style.left = leftPercent + '%';
  bar.style.width = widthPercent + '%';
  const label = isScene ? (item.description || '') : (item.text || '');
  bar.textContent = label;
  bar.title = `${formatTimecode(start)} \u2192 ${formatTimecode(end)}\n${label}`;
  bar.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isScene) selectScene(item.index);
    else selectSubtitle(item.clipIndex, item.subtitleIndex);
    seekTo(start, { preservePlayback: true });
  });
  track.appendChild(bar);
  store.push({
    el: bar,
    start,
    end,
    disabled: !!item.disabled,
    isScene,
    index: item.index,
    clipIndex: item.clipIndex,
    subtitleIndex: item.subtitleIndex,
  });
}

function subtitleRefEquals(a, b) {
  return !!a && !!b && a.clipIndex === b.clipIndex && a.subtitleIndex === b.subtitleIndex;
}

function selectScene(index) {
  state.selectedSceneIndex = Number.isInteger(index) ? index : null;
  state.selectedSubtitleRef = null;
  state.selectedInteractionPointIndex = null;
  updateActiveBars();
  renderSceneEditor();
  updateReadout();
  drawPreviewCanvas();
}

function selectSubtitle(clipIndex, subtitleIndex) {
  const clips = state.lastResultJson?.shortClips;
  const clip = Array.isArray(clips) ? clips[clipIndex] : null;
  if (!clip || !Array.isArray(clip.subtitles) || !clip.subtitles[subtitleIndex]) return;
  state.selectedSceneIndex = clipIndex;
  state.selectedSubtitleRef = { clipIndex, subtitleIndex };
  state.selectedInteractionPointIndex = null;
  updateActiveBars();
  renderSceneEditor();
  updateReadout();
  drawPreviewCanvas();
}

function selectInteractionPoint(index) {
  state.selectedInteractionPointIndex = Number.isInteger(index) ? index : null;
  state.selectedSubtitleRef = null;
  updateActiveBars();
  renderSceneEditor();
  updateReadout();
  drawPreviewCanvas();
}

function clearSelectedInteractionPoint() {
  if (!Number.isInteger(state.selectedInteractionPointIndex)) return;
  state.selectedInteractionPointIndex = null;
  updateActiveBars();
  renderSceneEditor();
  updateReadout();
  drawPreviewCanvas();
}

function selectedSceneRecord() {
  const scenes = getSceneRecords();
  if (!Number.isInteger(state.selectedSceneIndex)) return null;
  return scenes.find(scene => scene.index === state.selectedSceneIndex) || null;
}

function selectedSubtitleRecord() {
  const ref = state.selectedSubtitleRef;
  const clips = state.lastResultJson?.shortClips;
  if (!ref || !Array.isArray(clips)) return null;
  const clip = clips[ref.clipIndex];
  if (!clip || !Array.isArray(clip.subtitles)) return null;
  const subtitle = clip.subtitles[ref.subtitleIndex];
  if (!subtitle) return null;
  return {
    clip,
    subtitle,
    clipIndex: ref.clipIndex,
    subtitleIndex: ref.subtitleIndex,
    start: parseTimestamp(subtitle.start),
    end: parseTimestamp(subtitle.end),
  };
}

function selectedInteractionPointRecord() {
  if (!Number.isInteger(state.selectedInteractionPointIndex)) return null;
  return getInteractionPointRecords().find(point => point.index === state.selectedInteractionPointIndex) || null;
}

function getInteractionPointList() {
  const data = state.interactionPoints;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.interactionPoints)) return data.interactionPoints;
  return [];
}

function firstSubtitle(clip) {
  return Array.isArray(clip?.subtitles) && clip.subtitles.length ? clip.subtitles[0] : null;
}

function lastSubtitle(clip) {
  return Array.isArray(clip?.subtitles) && clip.subtitles.length ? clip.subtitles[clip.subtitles.length - 1] : null;
}

function syncOutputJson(message = '属性已更新。') {
  if (state.lastResultJson && typeof state.lastResultJson === 'object') {
    ui.output.value = JSON.stringify(state.lastResultJson, null, 2);
    ui.copy.disabled = false;
    ui.download.disabled = false;
    ui.downloadSrt.disabled = !MovieData.getEnabledSubtitles(state.lastResultJson).length;
  }
  rebuildTimeline();
  scheduleProjectAutoSave();
  log(message, 'ok');
}

function syncInteractionPointsJson(message = '互动点属性已更新。') {
  const output = document.getElementById('interactionOutput');
  if (output && state.interactionPoints && typeof state.interactionPoints === 'object') {
    output.value = JSON.stringify(state.interactionPoints, null, 2);
    document.getElementById('btnInteractionCopy')?.removeAttribute('disabled');
    document.getElementById('btnInteractionDownload')?.removeAttribute('disabled');
  }
  rebuildTimeline();
  scheduleProjectAutoSave();
  log(message, 'ok');
}

function scheduleProjectAutoSave() {
  if (!projectState.name || projectState.loadedFromUser || !window.keepwork?.token) return;
  if (state.sceneAutoSaveTimer) clearTimeout(state.sceneAutoSaveTimer);
  state.sceneAutoSaveTimer = setTimeout(async () => {
    state.sceneAutoSaveTimer = null;
    try {
      const { saveProject } = await import('./project.js');
      await saveProject();
    } catch (error) {
      log('自动保存失败：' + (error.message || error), 'warn');
    }
  }, 250);
}

function setClipStartEnd(clip, start, end) {
  clip.start = formatEditableTime(start);
  clip.end = formatEditableTime(end);
  const first = firstSubtitle(clip);
  const last = lastSubtitle(clip);
  if (first) first.start = clip.start;
  if (last) last.end = clip.end;
}

function commitSceneTextField(field) {
  const scene = selectedSceneRecord();
  if (!scene) return;
  const clip = scene.clip;
  if (field === 'description') {
    clip.scene = clip.scene || {};
    clip.scene.description = ui.sceneDescription.value;
  } else if (field === 'on_screen_text') {
    clip.scene = clip.scene || {};
    clip.scene.on_screen_text = ui.sceneOnScreenText.value;
  }
  syncOutputJson();
}

function sortClipSubtitlesAndSelect(clip, subtitle, clipIndex) {
  if (!Array.isArray(clip.subtitles)) clip.subtitles = [];
  clip.subtitles.sort((a, b) => parseTimestamp(a.start) - parseTimestamp(b.start));
  const subtitleIndex = clip.subtitles.indexOf(subtitle);
  state.selectedSubtitleRef = subtitleIndex >= 0 ? { clipIndex, subtitleIndex } : null;
}

function sortClipSubtitles(clip) {
  if (!Array.isArray(clip.subtitles)) clip.subtitles = [];
  clip.subtitles.sort((a, b) => parseTimestamp(a.start) - parseTimestamp(b.start));
}

function getSelectedOrActiveClipIndex() {
  if (Number.isInteger(state.selectedSceneIndex)) return state.selectedSceneIndex;
  const active = activeSceneAt(mediaCurrentTime(), true);
  if (active) return active.index;
  return Array.isArray(state.lastResultJson?.shortClips) && state.lastResultJson.shortClips.length ? 0 : -1;
}

function addSubtitle() {
  const clips = state.lastResultJson?.shortClips;
  const clipIndex = getSelectedOrActiveClipIndex();
  const clip = Array.isArray(clips) ? clips[clipIndex] : null;
  if (!clip) {
    log('请先加载包含场景的 JSON，再添加字幕。', 'warn');
    return;
  }
  const clipStart = parseTimestamp(clip.start);
  const clipEnd = Math.max(clipStart + MIN_SUBTITLE_LENGTH, parseTimestamp(clip.end));
  const current = mediaHasSource() ? mediaCurrentTime() : clipStart;
  let start = clamp(current, clipStart, Math.max(clipStart, clipEnd - MIN_SUBTITLE_LENGTH));
  let end = Math.min(clipEnd, start + 2);
  if (end - start < MIN_SUBTITLE_LENGTH) {
    start = Math.max(clipStart, end - MIN_SUBTITLE_LENGTH);
  }
  const subtitle = { start: formatEditableTime(start), end: formatEditableTime(end), speaker: '', text: '' };
  if (!Array.isArray(clip.subtitles)) clip.subtitles = [];
  clip.subtitles.push(subtitle);
  state.selectedSceneIndex = clipIndex;
  sortClipSubtitlesAndSelect(clip, subtitle, clipIndex);
  syncOutputJson('字幕已添加。');
}

function deleteSelectedSubtitle() {
  const record = selectedSubtitleRecord();
  if (!record) return;
  record.clip.subtitles.splice(record.subtitleIndex, 1);
  const nextIndex = Math.min(record.subtitleIndex, record.clip.subtitles.length - 1);
  state.selectedSubtitleRef = nextIndex >= 0 ? { clipIndex: record.clipIndex, subtitleIndex: nextIndex } : null;
  syncOutputJson('字幕已删除。');
}

function commitSubtitleField(field) {
  const record = selectedSubtitleRecord();
  if (!record) return;
  if (field === 'disabled') {
    record.subtitle.disabled = !!ui.subtitleDisabled.checked;
  } else if (field === 'speaker') {
    record.subtitle.speaker = ui.subtitleSpeaker.value.trim();
  } else if (field === 'text') {
    record.subtitle.text = ui.subtitleText.value;
  }
  syncOutputJson(field === 'disabled'
    ? (record.subtitle.disabled ? '字幕已禁用。' : '字幕已启用。')
    : '字幕属性已更新。');
}

function commitSubtitleTime(which) {
  const record = selectedSubtitleRecord();
  if (!record) return;
  const input = which === 'start' ? ui.subtitleStart : ui.subtitleEnd;
  const clipStart = parseTimestamp(record.clip.start);
  const clipEnd = Math.max(clipStart + MIN_SUBTITLE_LENGTH, parseTimestamp(record.clip.end));
  const requested = parseTimestamp(input.value);
  let nextStart = record.start;
  let nextEnd = record.end;
  if (which === 'start') {
    nextStart = clamp(requested, clipStart, nextEnd - MIN_SUBTITLE_LENGTH);
  } else {
    nextEnd = clamp(requested, nextStart + MIN_SUBTITLE_LENGTH, clipEnd);
  }
  record.subtitle.start = formatEditableTime(nextStart);
  record.subtitle.end = formatEditableTime(nextEnd);
  sortClipSubtitlesAndSelect(record.clip, record.subtitle, record.clipIndex);
  syncOutputJson('字幕时间已更新。');
}

function commitSceneSubtitleField(subtitle, field, value) {
  if (!subtitle) return;
  if (field === 'disabled') {
    subtitle.disabled = !!value;
  } else if (field === 'speaker') {
    subtitle.speaker = String(value || '').trim();
  } else if (field === 'text') {
    subtitle.text = String(value || '');
  }
  state.selectedSubtitleRef = null;
  syncOutputJson(field === 'disabled'
    ? (subtitle.disabled ? '字幕已禁用。' : '字幕已启用。')
    : '字幕属性已更新。');
}

function commitSceneSubtitleTime(clip, subtitle, which, value) {
  if (!clip || !subtitle) return;
  const clipStart = parseTimestamp(clip.start);
  const clipEnd = Math.max(clipStart + MIN_SUBTITLE_LENGTH, parseTimestamp(clip.end));
  const requested = parseTimestamp(value);
  let nextStart = parseTimestamp(subtitle.start);
  let nextEnd = parseTimestamp(subtitle.end);
  if (which === 'start') {
    nextStart = clamp(requested, clipStart, nextEnd - MIN_SUBTITLE_LENGTH);
  } else {
    nextEnd = clamp(requested, nextStart + MIN_SUBTITLE_LENGTH, clipEnd);
  }
  subtitle.start = formatEditableTime(nextStart);
  subtitle.end = formatEditableTime(nextEnd);
  sortClipSubtitles(clip);
  state.selectedSubtitleRef = null;
  syncOutputJson('字幕时间已更新。');
}

function commitSceneDisabled() {
  const scene = selectedSceneRecord();
  if (!scene) return;
  scene.clip.disabled = !!ui.sceneDisabled.checked;
  syncOutputJson(scene.clip.disabled ? '场景已禁用播放。' : '场景已恢复播放。');
}

function commitInteractionJson() {
  const record = selectedInteractionPointRecord();
  if (!record) return;
  let parsed;
  try {
    parsed = JSON.parse(ui.interactionJson.value || '{}');
  } catch (error) {
    renderInteractionEditor();
    log('互动点 JSON 解析失败：' + (error.message || error), 'err');
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    renderInteractionEditor();
    log('互动点 JSON 必须是对象。', 'err');
    return;
  }
  const list = getInteractionPointList();
  if (!list[record.index]) return;
  list[record.index] = parsed;
  state.selectedInteractionPointIndex = record.index;
  syncInteractionPointsJson('互动点 JSON 已更新。');
}

function commitSceneTime(which) {
  const scene = selectedSceneRecord();
  if (!scene) return;
  const clips = state.lastResultJson.shortClips;
  const clip = scene.clip;
  const oldStart = scene.start;
  const oldEnd = scene.end;
  const input = which === 'start' ? ui.sceneStart : ui.sceneEnd;
  const requested = parseTimestamp(input.value);
  let nextStart = oldStart;
  let nextEnd = oldEnd;

  if (which === 'start') {
    nextStart = oldStart + clamp(requested - oldStart, -MAX_TIME_EDIT_DELTA, MAX_TIME_EDIT_DELTA);
    nextStart = clamp(nextStart, 0, oldEnd - MIN_SCENE_LENGTH);
    const prevClip = clips[scene.index - 1];
    if (prevClip) {
      const prevStart = parseTimestamp(prevClip.start);
      nextStart = Math.max(nextStart, prevStart + MIN_SCENE_LENGTH);
      if (parseTimestamp(prevClip.end) > nextStart || Math.abs(parseTimestamp(prevClip.end) - oldStart) < 0.25) {
        setClipStartEnd(prevClip, prevStart, nextStart);
      }
    }
  } else {
    nextEnd = oldEnd + clamp(requested - oldEnd, -MAX_TIME_EDIT_DELTA, MAX_TIME_EDIT_DELTA);
    nextEnd = Math.max(nextEnd, oldStart + MIN_SCENE_LENGTH);
    const nextClip = clips[scene.index + 1];
    if (nextClip) {
      const nextEndTime = parseTimestamp(nextClip.end);
      nextEnd = Math.max(oldStart + MIN_SCENE_LENGTH, Math.min(nextEnd, nextEndTime - MIN_SCENE_LENGTH));
      if (parseTimestamp(nextClip.start) < nextEnd || Math.abs(parseTimestamp(nextClip.start) - oldEnd) < 0.25) {
        setClipStartEnd(nextClip, nextEnd, nextEndTime);
      }
    }
  }

  setClipStartEnd(clip, nextStart, nextEnd);
  syncOutputJson('场景时间已更新。');
}

function renderSceneEditor() {
  if (!ui.sceneEditorForm || !ui.sceneEditorEmpty) return;
  let scene = selectedSceneRecord();
  if (!scene) {
    const scenes = getSceneRecords();
    if (scenes.length) {
      state.selectedSceneIndex = scenes[0].index;
      scene = scenes[0];
    }
  }
  ui.sceneEditorEmpty.hidden = !!scene;
  ui.sceneEditorForm.hidden = !scene;
  if (!scene) return;
  const clip = scene.clip;
  ui.sceneEditorTitle.textContent = `场景 ${scene.index + 1}`;
  ui.sceneDisabled.checked = !!clip.disabled;
  ui.sceneStart.value = formatEditableTime(scene.start);
  ui.sceneEnd.value = formatEditableTime(scene.end);
  ui.sceneDescription.value = clip.scene?.description || '';
  ui.sceneOnScreenText.value = clip.scene?.on_screen_text || '';

  const speakerOptions = document.getElementById('subtitleSpeakerOptions');
  if (speakerOptions) {
    speakerOptions.innerHTML = '';
    const characters = Array.isArray(state.lastResultJson?.characters) ? state.lastResultJson.characters : [];
    for (const character of characters) {
      if (!character?.id) continue;
      const option = document.createElement('option');
      option.value = character.id;
      option.label = character.name || character.id;
      speakerOptions.appendChild(option);
    }
  }

  const subtitleRecord = selectedSubtitleRecord();
  const hasSubtitle = !!subtitleRecord && subtitleRecord.clipIndex === scene.index;
  const subtitles = Array.isArray(clip.subtitles) ? clip.subtitles : [];
  const subtitleList = document.getElementById('subtitleList');

  if (subtitleList) {
    subtitleList.hidden = hasSubtitle || !subtitles.length;
    if (!hasSubtitle) renderSceneSubtitleList(subtitleList, clip, subtitles);
  }
  if (ui.subtitleEditorEmpty) {
    ui.subtitleEditorEmpty.hidden = hasSubtitle || subtitles.length > 0;
    ui.subtitleEditorEmpty.textContent = subtitles.length
      ? '选择时间轴上的字幕以编辑单条字幕。'
      : '该场景暂无字幕，可点击“添加字幕”。';
  }
  if (ui.subtitleEditorBody) ui.subtitleEditorBody.hidden = !hasSubtitle;
  if (ui.subtitleDelete) ui.subtitleDelete.disabled = !hasSubtitle;
  if (hasSubtitle) {
    ui.subtitleDisabled.checked = !!subtitleRecord.subtitle.disabled;
    ui.subtitleStart.value = formatEditableTime(subtitleRecord.start);
    ui.subtitleEnd.value = formatEditableTime(subtitleRecord.end);
    ui.subtitleSpeaker.value = subtitleRecord.subtitle.speaker || '';
    ui.subtitleText.value = subtitleRecord.subtitle.text || '';
  }

  renderInteractionEditor();
}

function renderInteractionEditor() {
  if (!ui.interactionEditorEmpty || !ui.interactionEditorBody) return;
  const record = selectedInteractionPointRecord();
  const hasPoint = !!record;
  ui.interactionEditorEmpty.hidden = hasPoint;
  ui.interactionEditorBody.hidden = !hasPoint;
  if (!hasPoint) return;
  ui.interactionJson.value = JSON.stringify(record.point, null, 2);
}

function renderSceneSubtitleList(container, clip, subtitles) {
  container.innerHTML = '';
  subtitles.forEach((subtitle) => {
    const item = document.createElement('div');
    item.className = 'subtitle-list-item' + (subtitle.disabled ? ' disabled' : '');
    item.innerHTML = `
      <label>开始<input class="subtitle-list-start" type="text" inputmode="decimal" autocomplete="off" /></label>
      <label>结束<input class="subtitle-list-end" type="text" inputmode="decimal" autocomplete="off" /></label>
      <label>说话人<input class="subtitle-list-speaker" type="text" list="subtitleSpeakerOptions" autocomplete="off" /></label>
      <label class="subtitle-list-text-label">字幕<textarea class="subtitle-list-text" rows="1" spellcheck="false"></textarea></label>
      <label class="subtitle-list-disabled"><input class="subtitle-list-disabled-input" type="checkbox" /> 禁用</label>`;
    item.querySelector('.subtitle-list-start').value = formatEditableTime(parseTimestamp(subtitle.start));
    item.querySelector('.subtitle-list-end').value = formatEditableTime(parseTimestamp(subtitle.end));
    item.querySelector('.subtitle-list-speaker').value = subtitle.speaker || '';
    item.querySelector('.subtitle-list-text').value = subtitle.text || '';
    item.querySelector('.subtitle-list-disabled-input').checked = !!subtitle.disabled;
    item.querySelector('.subtitle-list-start').addEventListener('blur', (event) => {
      commitSceneSubtitleTime(clip, subtitle, 'start', event.currentTarget.value);
    });
    item.querySelector('.subtitle-list-end').addEventListener('blur', (event) => {
      commitSceneSubtitleTime(clip, subtitle, 'end', event.currentTarget.value);
    });
    item.querySelector('.subtitle-list-speaker').addEventListener('blur', (event) => {
      commitSceneSubtitleField(subtitle, 'speaker', event.currentTarget.value);
    });
    item.querySelector('.subtitle-list-text').addEventListener('blur', (event) => {
      commitSceneSubtitleField(subtitle, 'text', event.currentTarget.value);
    });
    item.querySelector('.subtitle-list-disabled-input').addEventListener('change', (event) => {
      commitSceneSubtitleField(subtitle, 'disabled', event.currentTarget.checked);
    });
    container.appendChild(item);
  });
}

function maybeSkipDisabledScene() {
  if (state.skipSeekGuard || !mediaHasSource()) return;
  if (mediaPaused()) return;
  if (Date.now() < state.suppressSkipUntil) return;
  const time = mediaCurrentTime();
  const disabledScene = activeSceneAt(time, true);
  if (!disabledScene || !disabledScene.disabled) return;
  state.skipSeekGuard = true;
  mediaSeek(disabledScene.end + 0.01);
  setTimeout(() => { state.skipSeekGuard = false; }, 80);
}

function maybePauseAtInteractionPoint() {
  if (!mediaHasSource() || mediaPaused()) return;
  const time = mediaCurrentTime();
  const point = getInteractionPointRecords().find(item => !item.disabled && Math.abs(time - item.time) < 0.25);
  if (!point || state.lastTriggeredInteractionPointId === point.id) return;
  state.lastTriggeredInteractionPointId = point.id;
  mediaPause();
  log(`到达互动点：${point.title}`, 'ok');
}

function trackClickHandler(event) {
  if (!state.timelineDuration) return;
  if (event.target.classList.contains('bar')) return;
  clearSelectedInteractionPoint();
  const rect = event.currentTarget.getBoundingClientRect();
  const percent = (event.clientX - rect.left) / rect.width;
  seekTo(percent * state.timelineDuration);
}

function initTimelineScrollGestures() {
  const scroll = ui.timelineScroll || document.querySelector('.timeline-scroll');
  if (!scroll) return;

  let touchState = null;
  let suppressClickUntil = 0;

  scroll.addEventListener('wheel', (event) => {
    const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    scroll.scrollLeft += delta;
    updateTimelineScrollAnchor();
  }, { passive: false });

  scroll.addEventListener('scroll', updateTimelineScrollAnchor, { passive: true });

  scroll.addEventListener('touchstart', (event) => {
    if (!event.touches.length) return;
    const touch = event.touches[0];
    touchState = {
      startX: touch.clientX,
      startY: touch.clientY,
      scrollLeft: scroll.scrollLeft,
      moved: false,
    };
  }, { passive: true });

  scroll.addEventListener('touchmove', (event) => {
    if (!touchState || !event.touches.length) return;
    const touch = event.touches[0];
    const dx = touch.clientX - touchState.startX;
    const dy = touch.clientY - touchState.startY;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    event.preventDefault();
    event.stopPropagation();
    touchState.moved = true;
    scroll.scrollLeft = touchState.scrollLeft - (Math.abs(dx) >= Math.abs(dy) ? dx : dy);
  }, { passive: false });

  scroll.addEventListener('touchend', () => {
    if (touchState?.moved) suppressClickUntil = Date.now() + 350;
    touchState = null;
  }, { passive: true });

  scroll.addEventListener('touchcancel', () => {
    touchState = null;
  }, { passive: true });

  scroll.addEventListener('click', (event) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}

function seekTo(seconds, options = {}) {
  if (!mediaHasSource()) {
    log('请在时间轴面板选择本地 MP4 或在上方粘贴 URL 以启用播放。', 'warn');
    return;
  }
  state.suppressSkipUntil = Date.now() + (options.preservePlayback ? 500 : 250);
  const wasPlaying = options.preservePlayback ? !mediaPaused() : false;
  mediaSeek(seconds);
  if (options.preservePlayback) {
    if (wasPlaying) mediaPlay();
    else if (media.mode !== 'youtube') mediaPause();
  }
  updateCursor();
  updateActiveBars();
  updateReadout();
}

export function updateCursor() {
  if (!state.timelineDuration) {
    ui.timeCursor.style.display = 'none';
    return;
  }
  maybeSkipDisabledScene();
  maybePauseAtInteractionPoint();
  ui.timeCursor.style.display = 'block';
  const time = mediaCurrentTime();
  const percent = Math.max(0, Math.min(100, (time / state.timelineDuration) * 100));
  ui.timeCursor.style.left = `calc(${percent}% - 1px)`;
}

export function updateActiveBars() {
  const time = mediaCurrentTime();
  for (const set of [state.timelineSubBars, state.timelineSceneBars]) {
    for (const bar of set) {
      const active = !bar.disabled && time >= bar.start && time < bar.end;
      bar.el.classList.toggle('active', active);
      if (bar.isScene) bar.el.classList.toggle('selected', bar.index === state.selectedSceneIndex);
      else bar.el.classList.toggle('selected', subtitleRefEquals(bar, state.selectedSubtitleRef));
    }
  }
  for (const bar of state.timelineIPBars) {
    const active = !bar.disabled && Math.abs(time - bar.start) < 0.5;
    bar.el.classList.toggle('active', active);
    bar.el.classList.toggle('selected', bar.index === state.selectedInteractionPointIndex);
  }
}

export function updateReadout() {
  if (!ui.timelineReadout) return;
  if (!state.timelineDuration) {
    ui.timelineReadout.textContent = state.lastResultJson
      ? '已加载 JSON，但没有可用的时间轴数据。'
      : '加载视频文件并进行解析以填充时间轴。';
    return;
  }
  const time = mediaCurrentTime();
  const subs = getSubtitleRecords(state.lastResultJson);
  const scenes = getSceneRecords(state.lastResultJson).filter(scene => !scene.disabled);
  const interactionPoints = getInteractionPointRecords().filter(point => !point.disabled);
  const map = MovieData.createCharacterMap(state.lastResultJson);
  const curSub = subs.find(sub => !sub.disabled && time >= parseTimestamp(sub.start) && time < parseTimestamp(sub.end));
  const curScene = scenes.find(scene => time >= parseTimestamp(scene.start) && time < parseTimestamp(scene.end));
  const curIP = interactionPoints.find(point => Math.abs(time - point.time) < 0.5);
  const selectedIP = selectedInteractionPointRecord();
  const displayIP = selectedIP || curIP;
  const parts = [`${formatTimecode(time)} / ${formatTimecode(state.timelineDuration)}`];
  if (curSub) {
    const who = curSub.speaker ? `${MovieData.getCharacterLabel(map, curSub.speaker)}: ` : '';
    parts.push(`\u201C${who}${(curSub.text || '').slice(0, 80)}\u201D`);
  }
  if (curScene) {
    const cast = Array.isArray(curScene.characters) && curScene.characters.length
      ? `场景角色：${curScene.characters.map(id => MovieData.getCharacterLabel(map, id)).join(', ')}`
      : '当前场景';
    parts.push(cast);
  }
  if (displayIP) parts.push(`互动：${displayIP.type} ${displayIP.title}`);
  ui.timelineReadout.textContent = parts.join('  \u2014  ');
}

function limitedLines(context, text, maxWidth, maxLines) {
  const lines = wrapMeasure(context, text, maxWidth);
  if (!maxLines || lines.length <= maxLines) return lines;
  const limited = lines.slice(0, maxLines);
  limited[limited.length - 1] = `${limited[limited.length - 1]}\u2026`;
  return limited;
}

function drawLines(context, lines, x, y, lineHeight, maxWidth) {
  lines.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight, maxWidth);
  });
}

function buildInteractionOverlayLayout(context, point, width, height, subtitleLayout) {
  const rightMargin = 14;
  const panelWidth = Math.min(width - rightMargin * 2, Math.max(220, width * 0.34));
  const reservesRight = width >= 480;
  const panelX = reservesRight ? width - panelWidth - rightMargin : rightMargin;
  const maxPanelHeight = Math.max(72, height * 0.25);
  context.font = '500 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const tipsText = point.tips || point.prompt || point.value || point.title || '';
  const tipLines = limitedLines(context, tipsText, panelWidth - 28, height < 340 ? 2 : 3);
  const panelHeight = Math.min(maxPanelHeight, 48 + tipLines.length * 20);
  const subtitleTop = subtitleLayout ? subtitleLayout.blockY : height - 18;
  const preferredY = reservesRight ? 78 : Math.max(68, subtitleTop - panelHeight - 12);
  return {
    x: panelX,
    y: clamp(preferredY, 64, Math.max(64, subtitleTop - panelHeight - 10)),
    width: panelWidth,
    height: panelHeight,
    typeText: point.type || point.skillType || 'interaction',
    tipLines,
    reservesRight,
    gap: 32,
  };
}

function drawInteractionOverlay(context, layout) {
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillStyle = 'rgba(15, 17, 23, 0.82)';
  roundRect(context, layout.x, layout.y, layout.width, layout.height, 8);
  context.fill();
  context.strokeStyle = 'rgba(251, 191, 36, 0.55)';
  context.stroke();
  context.fillStyle = '#fbbf24';
  context.font = '700 12px ui-monospace, Menlo, Consolas, monospace';
  context.fillText(layout.typeText, layout.x + 14, layout.y + 12, layout.width - 28);
  context.fillStyle = '#e6e8ee';
  context.font = '500 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  drawLines(context, layout.tipLines, layout.x + 14, layout.y + 34, 20, layout.width - 28);
}

export function drawPreviewCanvas() {
  const canvas = ui.previewCanvas;
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const cssWidth = Math.max(1, canvas.clientWidth || canvas.width || 640);
  const cssHeight = Math.max(1, canvas.clientHeight || Math.round(cssWidth * 9 / 16));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = cssWidth;
  const height = cssHeight;
  const time = mediaCurrentTime();
  const subs = getSubtitleRecords(state.lastResultJson);
  const scenes = getSceneRecords(state.lastResultJson).filter(scene => !scene.disabled);
  const interactionPoints = getInteractionPointRecords().filter(point => !point.disabled);
  const map = MovieData.createCharacterMap(state.lastResultJson);
  const curSub = subs.find(sub => !sub.disabled && time >= parseTimestamp(sub.start) && time < parseTimestamp(sub.end));
  const curScene = scenes.find(scene => time >= parseTimestamp(scene.start) && time < parseTimestamp(scene.end));
  const curIP = interactionPoints.find(point => Math.abs(time - point.time) < 0.5);
  const selectedIP = selectedInteractionPointRecord();
  const displayIP = selectedIP || curIP;
  let subtitleLayout = null;
  if (curSub && curSub.text) {
    const speakerName = curSub.speaker ? MovieData.getCharacterLabel(map, curSub.speaker) : '';
    const speakerPrefix = speakerName ? `${speakerName}: ` : '';
    const fullText = speakerPrefix + curSub.text;
    context.font = '700 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const padX = 24;
    const padY = 12;
    const maxWidth = width - 80;
    const lines = limitedLines(context, fullText, maxWidth, height < 340 ? 2 : 3);
    const lineHeight = 28;
    const blockHeight = lines.length * lineHeight + padY * 2;
    const blockY = height - blockHeight - 18;
    const blockWidth = Math.min(maxWidth + padX * 2,
      Math.max(...lines.map(line => context.measureText(line).width)) + padX * 2);
    subtitleLayout = {
      lines,
      lineHeight,
      blockHeight,
      blockWidth,
      blockX: (width - blockWidth) / 2,
      blockY,
      padY,
      speakerName,
      speakerPrefix,
      speakerColor: speakerName ? colorForSpeaker(curSub.speaker || speakerName) : '#fff',
    };
  }

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#1b2030');
  gradient.addColorStop(1, '#0a0d14');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.fillStyle = 'rgba(255,255,255,0.06)';
  context.fillRect(0, 0, width, 56);
  context.fillStyle = '#8a92a3';
  context.font = '600 12px ui-monospace, Menlo, Consolas, monospace';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  const timeStr = `${formatTimecode(time)}${state.timelineDuration ? ' / ' + formatTimecode(state.timelineDuration) : ''}`;
  context.fillText(timeStr, 20, 28, curScene ? Math.max(96, width * 0.42) : width - 40);
  if (curScene) {
    context.textAlign = 'right';
    context.fillStyle = '#b266ff';
    context.fillText(`${formatTimecode(parseTimestamp(curScene.start))} \u2192 ${formatTimecode(parseTimestamp(curScene.end))}`, width - 20, 28, Math.max(96, width * 0.42));
  }
  const ipLayout = displayIP ? buildInteractionOverlayLayout(context, displayIP, width, height, subtitleLayout) : null;

  if (curScene) {
    const contentX = 30;
    const contentWidth = ipLayout?.reservesRight
      ? Math.max(170, ipLayout.x - contentX - ipLayout.gap)
      : width - contentX * 2;
    const bottomLimit = subtitleLayout ? subtitleLayout.blockY - 14 : height - 24;

    context.fillStyle = '#e6e8ee';
    context.font = '500 18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    const descLineHeight = 26;
    const descLines = limitedLines(context, curScene.description || '', contentWidth, height < 340 ? 3 : 4);
    const descY = 78;
    drawLines(context, descLines, contentX, descY, descLineHeight, contentWidth);
    let nextY = descY + descLines.length * descLineHeight + 14;

    const cast = Array.isArray(curScene.characters) ? curScene.characters : [];
    if (cast.length && nextY + 22 <= bottomLimit) {
      context.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
      context.textBaseline = 'middle';
      let boxX = contentX;
      const boxY = nextY + 11;
      context.fillStyle = '#8a92a3';
      context.fillText('角色：', boxX, boxY);
      boxX += context.measureText('角色：').width + 10;
      for (const id of cast) {
        const label = MovieData.getCharacterLabel(map, id);
        const boxWidth = context.measureText(label).width + 16;
        if (boxX + boxWidth > width - 30) break;
        context.fillStyle = 'rgba(178, 102, 255, 0.18)';
        roundRect(context, boxX, boxY - 11, boxWidth, 22, 11);
        context.fill();
        context.strokeStyle = 'rgba(178, 102, 255, 0.5)';
        context.stroke();
        context.fillStyle = '#d6b3ff';
        context.fillText(label, boxX + 8, boxY);
        boxX += boxWidth + 6;
      }
      nextY += 34;
    }

    if (curScene.on_screen_text) {
      const panelY = nextY;
      const panelHeight = Math.min(94, bottomLimit - panelY);
      if (panelHeight >= 58) {
        context.fillStyle = 'rgba(78, 140, 255, 0.12)';
        roundRect(context, contentX, panelY, contentWidth, panelHeight, 10);
        context.fill();
        context.strokeStyle = 'rgba(78, 140, 255, 0.4)';
        context.stroke();
        context.fillStyle = '#8eb8ff';
        context.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
        context.fillText('画面文字', contentX + 14, panelY + 14);
        context.fillStyle = '#e6e8ee';
        context.font = '500 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        const screenLineHeight = 21;
        const screenMaxLines = Math.max(1, Math.floor((panelHeight - 38) / screenLineHeight));
        const screenLines = limitedLines(context, curScene.on_screen_text, contentWidth - 28, screenMaxLines);
        drawLines(context, screenLines, contentX + 14, panelY + 34, screenLineHeight, contentWidth - 28);
      }
    }
  } else {
    context.fillStyle = '#5a6275';
    context.font = 'italic 18px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(state.lastResultJson ? '该时间点没有场景。' : '粘贴 JSON 或解析视频以开始。', width / 2, height / 2);
  }

  if (ipLayout) drawInteractionOverlay(context, ipLayout);

  if (subtitleLayout) {
    const { lines, lineHeight, blockX, blockY, blockWidth, blockHeight, padY, speakerPrefix, speakerColor } = subtitleLayout;
    context.font = '700 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(0,0,0,0.7)';
    roundRect(context, blockX, blockY, blockWidth, blockHeight, 8);
    context.fill();

    let prefixRemaining = speakerPrefix;
    lines.forEach((line, index) => {
      const centerY = blockY + padY + lineHeight / 2 + index * lineHeight;
      const lineWidth = context.measureText(line).width;
      let centerX = width / 2 - lineWidth / 2;
      const previousAlign = context.textAlign;
      context.textAlign = 'left';

      let speakerPart = '';
      let restPart = line;
      if (prefixRemaining) {
        const take = Math.min(line.length, prefixRemaining.length);
        if (line.slice(0, take) === prefixRemaining.slice(0, take)) {
          speakerPart = line.slice(0, take);
          restPart = line.slice(take);
          prefixRemaining = prefixRemaining.slice(take);
        } else {
          prefixRemaining = '';
        }
      }

      if (speakerPart) {
        context.fillStyle = speakerColor;
        context.fillText(speakerPart, centerX, centerY);
        centerX += context.measureText(speakerPart).width;
      }
      if (restPart) {
        context.fillStyle = '#fff';
        context.fillText(restPart, centerX, centerY);
      }
      context.textAlign = previousAlign;
    });
  }
}

function previewLoop() {
  drawPreviewCanvas();
  state.previewRAF = requestAnimationFrame(previewLoop);
}

export function initTimeline() {
  ui.trackSubs.addEventListener('click', trackClickHandler);
  ui.trackScenes.addEventListener('click', trackClickHandler);
  ui.trackInteractionPoints?.addEventListener('click', trackClickHandler);
  initTimelineScrollGestures();

  if (ui.timelineZoom) {
    state.timelineZoomPxPerSecond = Number(ui.timelineZoom.value) || state.timelineZoomPxPerSecond;
    ui.timelineZoom.addEventListener('input', () => {
      state.timelineZoomPxPerSecond = Number(ui.timelineZoom.value) || 6;
      applyTimelineScale();
      renderRuler();
      updateCursor();
    });
  }

  ui.sceneDisabled?.addEventListener('change', commitSceneDisabled);
  ui.sceneStart?.addEventListener('blur', () => commitSceneTime('start'));
  ui.sceneEnd?.addEventListener('blur', () => commitSceneTime('end'));
  ui.sceneDescription?.addEventListener('blur', () => commitSceneTextField('description'));
  ui.sceneOnScreenText?.addEventListener('blur', () => commitSceneTextField('on_screen_text'));
  ui.subtitleAdd?.addEventListener('click', addSubtitle);
  ui.subtitleDelete?.addEventListener('click', deleteSelectedSubtitle);
  ui.subtitleDisabled?.addEventListener('change', () => commitSubtitleField('disabled'));
  ui.subtitleStart?.addEventListener('blur', () => commitSubtitleTime('start'));
  ui.subtitleEnd?.addEventListener('blur', () => commitSubtitleTime('end'));
  ui.subtitleSpeaker?.addEventListener('blur', () => commitSubtitleField('speaker'));
  ui.subtitleText?.addEventListener('blur', () => commitSubtitleField('text'));
  ui.interactionJson?.addEventListener('blur', commitInteractionJson);

  ui.timelineVideo.addEventListener('timeupdate', () => {
    updateCursor();
    updateActiveBars();
    updateReadout();
    drawPreviewCanvas();
  });
  ui.timelineVideo.addEventListener('seeked', () => {
    updateCursor();
    updateActiveBars();
    updateReadout();
    drawPreviewCanvas();
  });
  ui.timelineVideo.addEventListener('loadedmetadata', () => {
    if (!state.timelineDuration && ui.timelineVideo.duration) {
      state.timelineDuration = ui.timelineVideo.duration;
      rebuildTimeline();
    }
    if (media.mode !== 'youtube') media.mode = 'video';
    drawPreviewCanvas();
  });

  ui.timelineVideo.addEventListener('play', () => {
    if (!state.previewRAF) previewLoop();
  });
  ui.timelineVideo.addEventListener('pause', () => {
    if (state.previewRAF) {
      cancelAnimationFrame(state.previewRAF);
      state.previewRAF = null;
    }
    drawPreviewCanvas();
  });

  rebuildTimeline();
  drawPreviewCanvas();
}
