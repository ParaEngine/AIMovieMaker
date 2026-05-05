// ============ Output JSON handling: finalize, edit, copy/download ============
import { ui, mountHTML } from './ui.js';
import { state } from './state.js';
import { log, humanSize, parseTimestamp, triggerDownload, suggestName } from './utils.js';
import { MovieData } from './movieData.js';
import { rebuildTimeline } from './view_video_annotation_editor.js';
import { setTimelineVideoSrc } from './media.js';

/* ---------------- HTML markup owned by this module ---------------- */
export function mountOutputPanelUI(parent) {
  if (document.getElementById('output')) return;
  const main = parent || document.getElementById('appMain') || document.body;
  mountHTML(`
<section class="panel">
  <h2>输出（JSON）</h2>
  <div class="actions" style="margin-top:0;">
    <button id="btnCopy" class="secondary" disabled>复制</button>
    <button id="btnDownload" class="secondary" disabled>下载 .json</button>
    <button id="btnDownloadSrt" class="secondary" disabled>下载 .srt</button>
    <button id="btnClear" class="secondary">清空</button>
  </div>
  <textarea class="output" id="output" spellcheck="false" placeholder="// 在此粘贴 JSON，或点击“解析视频”生成…"></textarea>
  <div class="hint" id="outputEditHint">你可以随时粘贴或编辑 JSON—时间轴会自动更新。搭配下方时间轴面板的本地视频，可以不调用 LLM 进行预览。</div>
</section>`, main);
}

export function subtitlesToSrt(subs) {
  const fmt = (sec) => {
    if (typeof sec !== 'number' || !isFinite(sec)) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec - Math.floor(sec)) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  };
  return subs.map((s, i) => {
    const speaker = s.speaker ? `[${s.speaker}] ` : '';
    return `${i + 1}\n${fmt(parseTimestamp(s.start))} --> ${fmt(parseTimestamp(s.end))}\n${speaker}${s.text || ''}\n`;
  }).join('\n');
}

export function finalizeJson(text) {
  let parsed = null;
  let pretty = text;
  try {
    parsed = JSON.parse(text);
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
        pretty = JSON.stringify(parsed, null, 2);
      } catch {}
    }
  }
  state.lastResultJson = parsed || text;
  ui.output.value = pretty;
  ui.output.readOnly = false;
  ui.copy.disabled = false;
  ui.download.disabled = false;
  ui.downloadSrt.disabled = !(parsed && MovieData.getEnabledSubtitles(parsed).length);
  rebuildTimeline();
  log(parsed ? '完成。JSON 解析成功。' : '完成，但 JSON 解析失败；显示原始文本。', parsed ? 'ok' : 'warn');
}

export function initOutput() {
  /* Re-parse on user edit/paste so the timeline + downloads stay in sync. */
  ui.output.addEventListener('input', () => {
    if (ui.output.readOnly) return;
    clearTimeout(state.outputEditTimer);
    state.outputEditTimer = setTimeout(() => {
      const text = ui.output.value;
      let parsed = null;
      if (text.trim()) {
        try { parsed = JSON.parse(text); }
        catch {
          const m = text.match(/\{[\s\S]*\}/);
          if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
        }
      }
      state.lastResultJson = parsed || (text.trim() ? text : null);
      ui.copy.disabled = !text.trim();
      ui.download.disabled = !text.trim();
      ui.downloadSrt.disabled = !(parsed && MovieData.getEnabledSubtitles(parsed).length);
      rebuildTimeline();
    }, 300);
  });

  ui.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ui.output.value);
      log('已复制到剪贴板。', 'ok');
    } catch (e) { log('复制失败：' + e.message, 'err'); }
  });

  ui.download.addEventListener('click', () => {
    const blob = new Blob([ui.output.value], { type: 'application/json' });
    triggerDownload(blob, suggestName('json'));
  });

  ui.downloadSrt.addEventListener('click', () => {
    const subs = MovieData.getEnabledSubtitles(state.lastResultJson);
    if (!subs.length) return;
    const map = MovieData.createCharacterMap(state.lastResultJson);
    const subsForSrt = subs.map(s => ({
      ...s,
      speaker: s.speaker ? MovieData.getCharacterLabel(map, s.speaker) : (s.speaker || ''),
    }));
    const srt = subtitlesToSrt(subsForSrt);
    triggerDownload(new Blob([srt], { type: 'text/plain' }), suggestName('srt'));
  });

  ui.clear.addEventListener('click', () => {
    ui.output.value = '';
    ui.output.readOnly = false;
    ui.copy.disabled = ui.download.disabled = ui.downloadSrt.disabled = true;
    state.lastResultJson = null;
    // setProgress(0) — local import would create a cycle with utils, so inline here.
    ui.progress.style.width = '0%';
    rebuildTimeline();
  });

  /* File input preview drives both the standalone <video> preview and the timeline. */
  ui.file.addEventListener('change', () => {
    const f = ui.file.files?.[0];
    if (!f) { ui.preview.style.display = 'none'; return; }
    const url = URL.createObjectURL(f);
    ui.preview.src = url;
    ui.preview.style.display = 'block';
    setTimelineVideoSrc(url);
    log(`已选择：${f.name} (${humanSize(f.size)})`);
  });
}
