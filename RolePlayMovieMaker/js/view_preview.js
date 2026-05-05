// ============ View: Stage 5 — Preview ============
// Lazy-loaded role-play movie preview. It mirrors the final movie layout:
// video on top, scene timeline, bottom subtitle panel, and a DigitalHumanFrame
// avatar that appears when an interaction point pauses playback.

import { ui } from './ui.js';
import { state } from './state.js';
import { parseTimestamp, formatTimecode } from './utils.js';
import { loadKeepworkSDK } from './kwsdk.js';
import { MovieData } from './movieData.js';
import { parseYouTubeId } from './media.js';
import { RolePlayBottomPanel } from '../../RolePlayMoviePlayer/modules/role-play-bottom-panel.js';
import { RolePlaySceneTimeline } from '../../RolePlayMoviePlayer/modules/role-play-scene-timeline.js';

const DHF_CONFIG_URL = new URL('../../RolePlayMoviePlayer/dhf-config.yaml', import.meta.url).href;
const DHF_FULL_ASPECT_RATIO = 720 / 968;
const DHF_PORTRAIT_HEIGHT_RATIO = 1 / 2;

let mounted = false;
let preview = null;

export function mountPreviewView(container) {
  if (!container || mounted) return;
  mounted = true;
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1>⑤ 预览</h1>
        <div class="vh-sub">按最终互动电影的布局播放；到达 IP 时暂停并显示右下角数字人。</div>
      </div>
      <div class="rp-preview-actions">
        <button type="button" class="secondary" id="rpPreviewRestart">从头播放</button>
        <button type="button" id="rpPreviewPlay">播放</button>
      </div>
    </div>

    <section class="rp-preview-stage panel">
      <div class="rp-preview-shell rp-movie-mode" id="rpPreviewShell">
        <div class="rp-preview-video-area">
          <video class="rp-preview-video" id="rpPreviewVideo" playsinline webkit-playsinline controls preload="metadata"></video>
          <div class="rp-preview-empty" id="rpPreviewEmpty"></div>
          <div class="rp-preview-ip-card hidden" id="rpPreviewIPCard">
            <div class="rp-preview-ip-type" id="rpPreviewIPType"></div>
            <div class="rp-preview-ip-title" id="rpPreviewIPTitle"></div>
            <div class="rp-preview-ip-prompt" id="rpPreviewIPPrompt"></div>
            <div class="rp-preview-ip-options" id="rpPreviewIPOptions"></div>
            <div class="actions">
              <button type="button" id="rpPreviewContinue">继续播放</button>
              <button type="button" class="secondary" id="rpPreviewReplayIP">重播提示</button>
            </div>
          </div>
        </div>
        <div class="rp-scene-timeline hidden" id="rpPreviewSceneTimeline"></div>
        <div class="rp-bottom-panel hidden" id="rpPreviewBottomPanel"></div>
        <div class="rps-dhf-container rps-dhf-avatar hidden" id="rpPreviewDHF"></div>
      </div>
      <div class="rp-preview-status" id="rpPreviewStatus">就绪。</div>
    </section>
  `;
  preview = new PreviewController(container);
}

export function showPreviewView() {
  preview?.show();
}

export function hidePreviewView() {
  preview?.hide();
}

class PreviewController {
  constructor(container) {
    this.container = container;
    this.shell = container.querySelector('#rpPreviewShell');
    this.video = container.querySelector('#rpPreviewVideo');
    this.empty = container.querySelector('#rpPreviewEmpty');
    this.status = container.querySelector('#rpPreviewStatus');
    this.playBtn = container.querySelector('#rpPreviewPlay');
    this.restartBtn = container.querySelector('#rpPreviewRestart');
    this.continueBtn = container.querySelector('#rpPreviewContinue');
    this.replayIPBtn = container.querySelector('#rpPreviewReplayIP');
    this.ipCard = container.querySelector('#rpPreviewIPCard');
    this.ipType = container.querySelector('#rpPreviewIPType');
    this.ipTitle = container.querySelector('#rpPreviewIPTitle');
    this.ipPrompt = container.querySelector('#rpPreviewIPPrompt');
    this.ipOptions = container.querySelector('#rpPreviewIPOptions');
    this.dhfContainer = container.querySelector('#rpPreviewDHF');
    this.bottomPanel = new RolePlayBottomPanel(container.querySelector('#rpPreviewBottomPanel'));
    this.sceneTimeline = new RolePlaySceneTimeline(container.querySelector('#rpPreviewSceneTimeline'));
    this.tracks = [];
    this.scenes = [];
    this.interactionPoints = [];
    this.triggeredIPIds = new Set();
    this.activeIP = null;
    this.dhf = null;
    this.dhfInitPromise = null;
    this.lastSource = '';

    this.applyDHFVariables();
    this.bindEvents();
  }

  bindEvents() {
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.restartBtn.addEventListener('click', () => this.restart());
    this.continueBtn.addEventListener('click', () => this.resumeFromIP());
    this.replayIPBtn.addEventListener('click', () => this.speakActiveIP());
    this.video.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.video.addEventListener('play', () => this.syncPlayButton());
    this.video.addEventListener('pause', () => this.syncPlayButton());
    this.video.addEventListener('loadedmetadata', () => this.syncDuration());
    this.video.addEventListener('seeking', () => this.resetTriggeredAfterSeek());
    this.video.addEventListener('click', () => this.togglePlay());
    this.sceneTimeline.on('seek', (ms) => this.seek(ms / 1000));
  }

  applyDHFVariables() {
    const portraitAR = DHF_FULL_ASPECT_RATIO / DHF_PORTRAIT_HEIGHT_RATIO;
    document.documentElement.style.setProperty('--dhf-full-aspect-ratio', DHF_FULL_ASPECT_RATIO);
    document.documentElement.style.setProperty('--dhf-portrait-aspect-ratio', portraitAR);
  }

  show() {
    this.refreshData();
    this.initDHF();
  }

  hide() {
    this.video.pause();
    this.hideIP();
  }

  refreshData() {
    const source = this.getVideoSource();
    const sourceChanged = source && source !== this.lastSource;
    this.tracks = buildSubtitleTracks(state.lastResultJson);
    this.scenes = buildScenes(state.lastResultJson);
    this.interactionPoints = buildInteractionPoints(state.interactionPoints);

    this.bottomPanel.setTracks(this.tracks);
    this.bottomPanel.show();
    this.sceneTimeline.setScenes(this.scenes, this.getDurationMs());
    this.sceneTimeline.show();

    if (!state.lastResultJson) {
      this.showEmpty('请先完成阶段 2/3，生成并保存电影 JSON。');
    } else if (!source) {
      this.showEmpty('请在阶段 1 选择 MP4 URL，或在阶段 3 加载本地视频后再预览。');
    } else if (parseYouTubeId(source)) {
      this.showEmpty('预览播放器暂不支持 YouTube。请使用 MP4 URL 或本地视频源。');
    } else {
      this.empty.textContent = '';
      this.empty.classList.add('hidden');
      this.video.classList.remove('hidden');
      if (sourceChanged || !this.video.src) {
        this.lastSource = source;
        this.video.src = source;
        this.video.load();
      }
    }

    this.updateSubtitleForTime();
    this.updateStatus();
  }

  getVideoSource() {
    const directUrl = (ui.urlInput?.value || '').trim();
    if (directUrl) return directUrl;
    const timelineSrc = ui.timelineVideo?.currentSrc || ui.timelineVideo?.src || '';
    if (timelineSrc) return timelineSrc;
    const sceneVideo = state.lastResultJson?.scenes?.[0]?.videoSrc || state.lastResultJson?.videoUrl || '';
    return String(sceneVideo || '').trim();
  }

  showEmpty(message) {
    this.video.pause();
    this.video.classList.add('hidden');
    this.empty.classList.remove('hidden');
    this.empty.textContent = message;
  }

  getDurationMs() {
    const configured = parseTimestamp(state.lastResultJson?.videoLength) * 1000
      || Number(state.lastResultJson?.videoLengthMs)
      || Number(state.lastResultJson?.duration_seconds) * 1000
      || 0;
    const videoDuration = isFinite(this.video.duration) ? this.video.duration * 1000 : 0;
    const contentDuration = Math.max(
      ...this.tracks.map(track => track.endMs),
      ...this.scenes.map(scene => scene.endMs),
      ...this.interactionPoints.map(point => point.timeMs),
      0,
    );
    return Math.max(configured, videoDuration, contentDuration);
  }

  syncDuration() {
    this.sceneTimeline.setDuration(this.getDurationMs());
  }

  togglePlay() {
    if (this.video.classList.contains('hidden')) return;
    if (this.activeIP) return;
    if (this.video.paused) this.video.play().catch(() => {});
    else this.video.pause();
  }

  restart() {
    this.triggeredIPIds.clear();
    this.hideIP();
    this.seek(0);
    this.video.play().catch(() => {});
  }

  seek(seconds) {
    this.hideIP();
    this.video.currentTime = Math.max(0, seconds || 0);
    this.resetTriggeredAfterSeek();
    this.onTimeUpdate();
  }

  resetTriggeredAfterSeek() {
    const currentMs = (this.video.currentTime || 0) * 1000;
    for (const point of this.interactionPoints) {
      if (point.timeMs >= currentMs - 500) this.triggeredIPIds.delete(point.id);
    }
  }

  onTimeUpdate() {
    const currentMs = (this.video.currentTime || 0) * 1000;
    this.sceneTimeline.setCurrent(currentMs);
    this.updateSubtitleForTime(currentMs);
    this.maybeTriggerIP(currentMs);
  }

  updateSubtitleForTime(currentMs = (this.video.currentTime || 0) * 1000) {
    let index = this.tracks.findIndex(track => currentMs >= track.startMs && currentMs < track.endMs);
    if (index < 0) index = this.tracks.findIndex(track => track.endMs > currentMs);
    if (index < 0 && this.tracks.length) index = this.tracks.length;
    this.bottomPanel.setCurrent(index);
    this.bottomPanel.setPaused(this.video.paused || !!this.activeIP);
  }

  maybeTriggerIP(currentMs) {
    if (this.activeIP || this.video.paused) return;
    const point = this.interactionPoints.find(item => (
      !item.disabled &&
      !this.triggeredIPIds.has(item.id) &&
      currentMs >= item.timeMs &&
      currentMs < item.timeMs + 700
    ));
    if (point) this.showIP(point);
  }

  showIP(point) {
    this.activeIP = point;
    this.triggeredIPIds.add(point.id);
    this.video.pause();
    this.ipType.textContent = point.type;
    this.ipTitle.textContent = point.title || `互动点 ${point.index + 1}`;
    this.ipPrompt.textContent = point.prompt || point.value || point.tips || '';
    this.ipOptions.innerHTML = renderIPOptions(point);
    this.ipCard.classList.remove('hidden');
    this.dhfContainer.classList.remove('hidden');
    this.bottomPanel.setPaused(true);
    this.updateStatus(`已暂停在 ${formatTimecode(point.timeMs / 1000)}：${point.title || point.type}`);
    this.speakActiveIP();
  }

  hideIP() {
    this.activeIP = null;
    this.ipCard.classList.add('hidden');
    this.dhfContainer.classList.add('hidden');
  }

  resumeFromIP() {
    this.hideIP();
    this.video.play().catch(() => {});
    this.updateStatus();
  }

  async initDHF() {
    if (this.dhf || this.dhfInitPromise) return this.dhfInitPromise;
    this.dhfInitPromise = (async () => {
      try {
        const sdk = await loadKeepworkSDK();
        if (!window.DigitalHumanFrame) throw new Error('DigitalHumanFrame 不可用。');
        this.dhf = new window.DigitalHumanFrame({
          sdk,
          container: this.dhfContainer,
          useExternalHtml: true,
          proxyCategories: ['story'],
        });
        await this.dhf.loadConfig(DHF_CONFIG_URL);
        this.updateStatus('预览数字人已就绪。');
      } catch (e) {
        this.updateStatus(`数字人初始化失败：${e?.message || e}`);
      } finally {
        this.dhfInitPromise = null;
      }
    })();
    return this.dhfInitPromise;
  }

  async speakActiveIP() {
    const text = this.activeIP && (this.activeIP.value || this.activeIP.prompt || this.activeIP.title || '');
    if (!text) return;
    await this.initDHF();
    try {
      this.dhf?.sendTTS?.(text, { interrupt: true });
    } catch (e) {
      this.updateStatus(`数字人朗读失败：${e?.message || e}`);
    }
  }

  syncPlayButton() {
    this.playBtn.textContent = this.video.paused ? '播放' : '暂停';
    this.bottomPanel.setPaused(this.video.paused || !!this.activeIP);
  }

  updateStatus(message) {
    if (message) {
      this.status.textContent = message;
      return;
    }
    const parts = [`字幕 ${this.tracks.length} 条`, `IP ${this.interactionPoints.length} 个`];
    if (this.video.duration && isFinite(this.video.duration)) parts.push(`时长 ${formatTimecode(this.video.duration)}`);
    this.status.textContent = parts.join(' · ');
  }
}

function buildSubtitleTracks(data) {
  if (!data || !Array.isArray(data.shortClips)) return [];
  const map = MovieData.createCharacterMap(data);
  const tracks = [];
  data.shortClips.forEach((clip, clipIndex) => {
    if (clip?.disabled || !Array.isArray(clip.subtitles)) return;
    clip.subtitles.forEach((subtitle, subtitleIndex) => {
      if (!subtitle || subtitle.disabled) return;
      const startMs = parseTimestamp(subtitle.start) * 1000;
      const endMs = parseTimestamp(subtitle.end) * 1000;
      if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return;
      const speakerId = subtitle.speaker || subtitle.characterId || subtitle.character || '';
      tracks.push({
        id: subtitle.id || `s_${clipIndex}_${subtitleIndex}`,
        startMs,
        endMs,
        targetText: subtitle.text || subtitle.targetText || '',
        nativeText: MovieData.getCharacterLabel(map, speakerId),
        speakerId,
        isPlayer: false,
        wordTiming: [],
      });
    });
  });
  return tracks.sort((a, b) => a.startMs - b.startMs);
}

function buildScenes(data) {
  if (!data || !Array.isArray(data.shortClips)) return [];
  return data.shortClips.map((clip, index) => {
    const startMs = parseTimestamp(clip.start) * 1000;
    const endMs = parseTimestamp(clip.end) * 1000;
    return {
      id: clip.id || `clip_${index}`,
      startMs,
      endMs,
      description: clip.scene?.description || clip.description || `场景 ${index + 1}`,
    };
  }).filter(scene => isFinite(scene.startMs) && isFinite(scene.endMs) && scene.endMs > scene.startMs);
}

function buildInteractionPoints(data) {
  const list = Array.isArray(data) ? data : (Array.isArray(data?.interactionPoints) ? data.interactionPoints : []);
  return list.map((point, index) => {
    const timeMs = parseTimestamp(point.time || point.timestamp || point.start || point.at || 0) * 1000;
    return {
      ...point,
      index,
      id: point.id || `ip_${index + 1}_${Math.round(timeMs)}`,
      timeMs,
      type: point.type || point.skillType || 'interaction',
      title: point.title || point.label || point.prompt || point.value || `互动点 ${index + 1}`,
      prompt: point.prompt || point.value || point.tips || '',
      disabled: !!point.disabled,
    };
  }).filter(point => isFinite(point.timeMs) && point.timeMs >= 0)
    .sort((a, b) => a.timeMs - b.timeMs);
}

function renderIPOptions(point) {
  const options = Array.isArray(point.config?.options) ? point.config.options : [];
  if (!options.length) return '';
  return options.map((option, index) => (
    `<div class="rp-preview-ip-option"><span>${String.fromCharCode(65 + index)}</span>${escapeHtml(option)}</div>`
  )).join('');
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}