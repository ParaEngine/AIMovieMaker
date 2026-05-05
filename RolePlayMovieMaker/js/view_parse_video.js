// ============ View: Stage 2 — Parse Video ============
// Configure the prompt + provider/model, then run the analysis.
// Owns DOM IDs used by prompt.js, parse.js, settings.js (model select / fps),
// output.js, and progress / status reporting.

import { state } from './state.js';
import { MovieData } from './movieData.js';
import { registerView, gotoPrevStage, gotoNextStage } from './views.js';

export function registerParseVideoView() {
  registerView({
    id: 'stage2',
    label: '解析视频',
    stage: 2,
    mount: mountStage2,
  });
}

function mountStage2(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1>② 解析视频</h1>
        <div class="vh-sub">调整提示词、选择提供商与模型，然后运行分析；可在本阶段编辑并导出标注 JSON。</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="secondary" id="btnStage2Prev">← 源视频</button>
        <button type="button" id="btnStage2Next">编辑器 →</button>
      </div>
    </div>

    <section class="panel parse-result-summary" id="parseResultSummary" hidden>
      <div class="parse-result-head">
        <h2>已生成结果</h2>
        <div class="parse-result-count" id="parseResultStats">0 个角色 · 0 个场景 · 0 条字幕</div>
      </div>
      <p class="parse-result-description" id="parseResultDescription"></p>
      <div class="parse-result-cast" id="parseResultCast"></div>
    </section>

    <div class="view-grid-2">
      <section class="panel">
        <h2>提供商与模型</h2>

        <label for="providerMainSel">提供商</label>
        <select id="providerMainSel">
          <option value="google">Google</option>
          <option value="openrouter">OpenRouter</option>
        </select>
        <div class="hint">可在此直接切换；默认值来自设置。</div>

        <label for="modelSelect">模型</label>
        <select id="modelSelect"></select>
        <div class="hint">当前提供商：<span id="modelProviderTag">—</span>。模型列表会随提供商切换。</div>

        <label for="fpsInput">视频采样 FPS</label>
        <input type="number" id="fpsInput" min="1" max="24" step="1" value="2" />
        <div class="hint">Gemini 从视频中解码的每秒帧数。默认 2，范围 1–24。</div>

        <div class="actions" style="margin-top:14px;">
          <button id="btnParse">解析视频</button>
          <button id="btnCancel" class="secondary" disabled>取消</button>
        </div>

        <div class="progress"><div id="progressBar"></div></div>
        <div class="status" id="status">就绪。</div>
      </section>

      <section class="panel">
        <h2>提示词</h2>
        <label for="promptText">
          发送给模型的提示词
          <button type="button" id="btnResetPrompt" class="secondary" style="float:right; padding:2px 8px; font-size:11px;">恢复默认</button>
        </label>
        <textarea id="promptText" style="min-height:480px;"></textarea>
        <div class="hint">该文本会原样发送。响应也会受内置 JSON schema 约束。</div>
      </section>
    </div>

    <section class="panel" style="margin-top:20px;">
      <h2>标注 JSON（可编辑）</h2>
      <div class="actions" style="margin-top:0;">
        <button id="btnCopy" class="secondary" disabled>复制</button>
        <button id="btnDownload" class="secondary" disabled>下载 .json</button>
        <button id="btnDownloadSrt" class="secondary" disabled>下载 .srt</button>
        <button id="btnClear" class="secondary">清空</button>
      </div>
      <textarea class="output" id="output" spellcheck="false" placeholder="// 在此粘贴 JSON，或运行阶段 2（解析视频）生成…"></textarea>
      <div class="hint" id="outputEditHint">Edit the JSON freely — the timeline + downloads update automatically.</div>
    </section>
  `;

  container.querySelector('#btnStage2Prev').addEventListener('click', gotoPrevStage);
  container.querySelector('#btnStage2Next').addEventListener('click', gotoNextStage);
  updateParseVideoResultSummary();
}

function characterDisplayName(character, index) {
  if (!character || typeof character !== 'object') return `角色 ${index + 1}`;
  return character.name || character.id || `角色 ${index + 1}`;
}

export function updateParseVideoResultSummary(data = state.lastResultJson) {
  const summary = document.getElementById('parseResultSummary');
  if (!summary) return;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    summary.hidden = true;
    return;
  }

  const characters = Array.isArray(data.characters) ? data.characters : [];
  const scenes = MovieData.getScenes(data);
  const subtitles = MovieData.getSubtitles(data);
  const names = characters.map(characterDisplayName).filter(Boolean);
  document.getElementById('parseResultDescription').textContent = data.summary || '暂无概要。';
  document.getElementById('parseResultStats').textContent = `${characters.length} 个角色 · ${scenes.length} 个场景 · ${subtitles.length} 条字幕`;
  document.getElementById('parseResultCast').textContent = names.length ? names.join('、') : '暂无角色名称。';
  summary.hidden = false;
}
