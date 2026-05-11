// ============ View: Stage 4 — Generate Interaction Points ============
// Generates a standalone timeline-based IP JSON field for the project.

import { registerView, gotoPrevStage, gotoNextStage } from './views.js';
import { state } from './state.js';
import { DEFAULT_GOOGLE_MODELS, DEFAULT_OPENROUTER_MODELS } from './constants.js';
import { getSettings, loadSettings, saveSettings, fillModelSelect, looksLikeOpenRouterApiKey } from './settings.js';
import { readSSEStream, startWaitingIndicator } from './sse.js';
import { toOpenRouterModelId } from './openrouter.js';
import { rebuildTimeline } from './view_video_annotation_editor.js';
import { saveProject } from './project.js';
import { log, triggerDownload, suggestName } from './utils.js';

const SKILL_TYPES = [
  { value: 'multiple_choice', label: '选择题', hint: '检查剧情理解、词义或下一步判断。' },
  { value: 'follow_read_sentence', label: '跟读句子', hint: '让用户复述当前台词或关键词句。' },
  { value: 'role_play_response', label: '角色回应', hint: '让用户代入角色说一句回应。' },
  { value: 'open_question', label: '开放问答', hint: '围绕剧情提出简短思考问题。' },
  { value: 'load_minigame', label: '小游戏', hint: '可映射到 keepworkSDK minigame 的 load_minigame 工具。' },
];

const PRESETS = {
  balanced: '优先生成轻量互动，穿插选择题、跟读句子和角色回应；每个互动点控制在 20 秒左右完成。',
  language: '偏向语言学习：多生成跟读句子、词汇理解、语音挑战；题目必须贴合当前字幕。',
  comprehension: '偏向剧情理解：多生成选择题和开放问答；问题必须依赖互动点之前刚发生的内容。',
  roleplay: '偏向角色扮演：多生成角色回应和情景选择；让用户像电影角色一样回答。',
};

let lastAutoInteractionPrompt = '';

export function registerGenerateInteractionView() {
  registerView({
    id: 'stage4',
    label: '生成互动',
    stage: 4,
    mount: mountStage4,
    onShow: () => {
      syncPromptFromControls();
      updateInteractionResultSummary();
    },
  });
}

function mountStage4(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1>④ 生成互动</h1>
        <div class="vh-sub">基于阶段 2 的场景 JSON 生成独立的 AI Interaction Points（IP），不会写入 scenes 或 subtitles。</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="secondary" id="btnStage4Prev">← 编辑器</button>
        <button type="button" id="btnStage4Next">预览 →</button>
      </div>
    </div>

    <section class="panel parse-result-summary interaction-result-summary" id="interactionResultSummary" hidden>
      <div class="parse-result-head">
        <h2>已生成互动</h2>
        <div class="parse-result-count interaction-result-count" id="interactionResultStats">0 个 IP</div>
      </div>
      <div class="interaction-result-types" id="interactionResultTypes"></div>
    </section>

    <div class="view-grid-2">
      <section class="panel">
        <h2>生成设置</h2>
        <label for="ipProviderMainSel">提供商</label>
        <select id="ipProviderMainSel">
          <option value="google">Google</option>
          <option value="openrouter">OpenRouter</option>
        </select>

        <label for="ipModelSelect">模型</label>
        <select id="ipModelSelect"></select>

        <label>互动技能类型</label>
        <div class="ip-skill-grid" id="ipSkillGrid">
          ${SKILL_TYPES.map(skill => `
            <label class="ip-skill-option">
              <input type="checkbox" value="${skill.value}" ${skill.value === 'multiple_choice' || skill.value === 'follow_read_sentence' ? 'checked' : ''} />
              <span><strong>${skill.label}</strong><small>${skill.hint}</small></span>
            </label>`).join('')}
        </div>

        <div class="row">
          <label>电影播放<input type="number" id="ipMovieRatio" min="1" max="20" step="1" value="8" /></label>
          <label>互动播放<input type="number" id="ipInteractionRatio" min="1" max="10" step="1" value="2" /></label>
        </div>
        <div class="hint">默认玩学比为 8:2。若一个 IP 约 20 秒，则大约每 80 秒电影插入一个互动点。</div>

        <label for="ipDurationSeconds">单个 IP 预计时长（秒）</label>
        <input type="number" id="ipDurationSeconds" min="5" max="90" step="5" value="20" />

        <label for="ipPresetSel">提示词预设</label>
        <select id="ipPresetSel">
          <option value="balanced">综合互动</option>
          <option value="language">语言学习</option>
          <option value="comprehension">剧情理解</option>
          <option value="roleplay">角色扮演</option>
        </select>

        <div class="actions">
          <button id="btnGenerateInteractions">生成互动</button>
          <button id="btnCancelInteractions" class="secondary" disabled>取消</button>
        </div>
        <div class="progress"><div id="ipProgressBar"></div></div>
        <div class="status" id="ipStatus">就绪。</div>
      </section>

      <section class="panel">
        <h2>互动生成提示词</h2>
        <label for="interactionPromptText">发送给模型的提示词</label>
        <textarea id="interactionPromptText" style="min-height:560px;"></textarea>
        <div class="hint">提示词会自动嵌入当前阶段 2 的电影 JSON。IP 结果保存为项目文件中的独立字段。</div>
      </section>
    </div>

    <section class="panel" style="margin-top:20px;">
      <h2>Interaction Points JSON（可编辑）</h2>
      <div class="actions" style="margin-top:0;">
        <button id="btnInteractionCopy" class="secondary" disabled>复制</button>
        <button id="btnInteractionDownload" class="secondary" disabled>下载 .json</button>
        <button id="btnInteractionClear" class="secondary">清空</button>
      </div>
      <textarea class="output" id="interactionOutput" spellcheck="false" placeholder="// 在此粘贴 IP JSON，或点击“生成互动”…"></textarea>
      <div class="hint">支持 { "interactionPoints": [...] } 或直接 [...]。时间轴会把它作为独立 IP 轨道显示。</div>
    </section>
  `;

  container.querySelector('#btnStage4Prev').addEventListener('click', gotoPrevStage);
  container.querySelector('#btnStage4Next').addEventListener('click', gotoNextStage);
  updateInteractionResultSummary();
}

function interactionPointList(data = state.interactionPoints) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.interactionPoints)) return data.interactionPoints;
  return [];
}

function interactionTypeLabel(type) {
  const skill = SKILL_TYPES.find(item => item.value === type);
  return skill ? skill.label : (type || '未分类');
}

function interactionTypeBreakdown(points) {
  const counts = new Map();
  for (const point of points) {
    const type = point?.type || point?.skillType || '未分类';
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  const orderedTypes = [
    ...SKILL_TYPES.map(skill => skill.value).filter(type => counts.has(type)),
    ...[...counts.keys()].filter(type => !SKILL_TYPES.some(skill => skill.value === type)),
  ];
  return orderedTypes.map(type => `${interactionTypeLabel(type)} ${counts.get(type)}`).join(' · ');
}

function updateInteractionResultSummary(data = state.interactionPoints) {
  const summary = document.getElementById('interactionResultSummary');
  if (!summary) return;
  const points = interactionPointList(data);
  const count = points.length;
  if (!count) {
    summary.hidden = true;
    return;
  }
  document.getElementById('interactionResultStats').textContent = `${count} 个 IP`;
  document.getElementById('interactionResultTypes').textContent = interactionTypeBreakdown(points);
  summary.hidden = false;
}

function ipLog(message, level = '') {
  const status = document.getElementById('ipStatus');
  if (status) {
    const line = document.createElement('div');
    if (level) line.className = level;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    status.appendChild(line);
    status.scrollTop = status.scrollHeight;
  }
  try { log(message, level); } catch {}
}

function setIPProgress(value) {
  const bar = document.getElementById('ipProgressBar');
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function getSelectedSkillTypes() {
  return [...document.querySelectorAll('#ipSkillGrid input[type="checkbox"]:checked')].map(input => input.value);
}

function selectedProvider() {
  const provider = document.getElementById('ipProviderMainSel')?.value;
  return provider === 'openrouter' ? 'openrouter' : 'google';
}

function refreshIPModelSelect(provider = selectedProvider()) {
  const settings = getSettings();
  const list = provider === 'openrouter' ? DEFAULT_OPENROUTER_MODELS : DEFAULT_GOOGLE_MODELS;
  const current = provider === 'openrouter' ? settings.openrouterModel : settings.googleModel;
  fillModelSelect(document.getElementById('ipModelSelect'), list, current);
}

function parseMovieJsonFromOutput() {
  const text = document.getElementById('output')?.value || '';
  if (!text.trim()) return null;
  try { return JSON.parse(text); }
  catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
  }
  return null;
}

function hasMovieJsonData(data) {
  return data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0;
}

function getCurrentMovieJson() {
  if (hasMovieJsonData(state.lastResultJson)) return state.lastResultJson;
  const parsed = parseMovieJsonFromOutput();
  if (hasMovieJsonData(parsed)) {
    state.lastResultJson = parsed;
    return parsed;
  }
  return null;
}

function buildInteractionPrompt() {
  const movieRatio = Math.max(1, Number(document.getElementById('ipMovieRatio')?.value) || 8);
  const interactionRatio = Math.max(1, Number(document.getElementById('ipInteractionRatio')?.value) || 2);
  const durationSeconds = Math.max(5, Number(document.getElementById('ipDurationSeconds')?.value) || 20);
  const selectedTypes = getSelectedSkillTypes();
  const presetKey = document.getElementById('ipPresetSel')?.value || 'balanced';
  const movieData = getCurrentMovieJson();
  const movieJson = movieData ? JSON.stringify(movieData, null, 2) : '{}';
  const uninterruptedMovieSeconds = Math.round(durationSeconds * (movieRatio / interactionRatio));

  return `You are designing AI Interaction Points (IP) for an educational role-play movie.

AI Interaction Points are saved as a separate timeline-based project field. Do not modify, copy into, or mix IP data with shortClips, scenes, or subtitles.

Selected skill types: ${selectedTypes.join(', ') || 'multiple_choice'}
Play-to-learn ratio: ${movieRatio}:${interactionRatio}
Estimated single IP duration: ${durationSeconds} seconds
Target spacing: about ${uninterruptedMovieSeconds} seconds of uninterrupted movie playback between IPs.
Preset guidance: ${PRESETS[presetKey] || PRESETS.balanced}

Use keepworkSDK minigame integration only when type is "load_minigame". For that type, config should be compatible with a future call to load_minigame, for example { "relativePath": "skills/example/index.html", "width": 500, "height": 600 }. For ordinary learning interactions, keep config self-contained and simple.

Return ONLY JSON with EXACTLY this top-level shape:
{
  "version": 1,
  "ratio": "${movieRatio}:${interactionRatio}",
  "estimatedInteractionDurationSeconds": ${durationSeconds},
  "interactionPoints": [
    {
      "id": "ip_001",
      "time": "01:20,000",
      "type": "multiple_choice",
      "title": "Choose the best response",
      "prompt": "The digital human says this to the user when the movie pauses.",
      "value": "The exact text the digital human should read aloud to start the interaction.",
      "config": { "question": "...", "options": ["A", "B", "C"], "answerIndex": 0 },
      "estimatedDurationSeconds": 20
    }
  ]
}

Rules:
- Place IPs at meaningful story beats after enough context has appeared.
- Each time must be a timestamp string in MM:SS,mmm or HH:MM:SS,mmm format.
- Do not create IPs inside title cards, transitions, or moments without enough story context.
- Keep every prompt short enough for a digital human to read naturally.
- Only use the selected skill types.
- Do not include any other top-level fields.

Movie JSON:
${movieJson}`;
}

function isEmptyMoviePrompt(text) {
  return /Movie JSON:\s*\{\s*\}\s*$/i.test(String(text || '').trim());
}

function syncPromptFromControls({ force = false } = {}) {
  const prompt = document.getElementById('interactionPromptText');
  if (!prompt) return;
  const next = buildInteractionPrompt();
  const current = prompt.value || '';
  if (force || !current.trim() || current === lastAutoInteractionPrompt || isEmptyMoviePrompt(current)) {
    prompt.value = next;
    lastAutoInteractionPrompt = next;
  }
}

function finalizeInteractionJson(text) {
  let parsed = null;
  let pretty = text;
  try {
    parsed = JSON.parse(text);
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
        pretty = JSON.stringify(parsed, null, 2);
      } catch {}
    }
  }
  state.interactionPoints = parsed || text;
  const output = document.getElementById('interactionOutput');
  if (output) output.value = pretty;
  document.getElementById('btnInteractionCopy').disabled = !String(pretty || '').trim();
  document.getElementById('btnInteractionDownload').disabled = !String(pretty || '').trim();
  updateInteractionResultSummary();
  rebuildTimeline();
  ipLog(parsed ? '互动点 JSON 已生成。' : '生成完成，但 JSON 解析失败；已保留原始文本。', parsed ? 'ok' : 'warn');
}

function hasExistingInteractionPoints() {
  const current = state.interactionPoints;
  if (Array.isArray(current)) return current.length > 0;
  if (current && typeof current === 'object') {
    if (Array.isArray(current.interactionPoints)) return current.interactionPoints.length > 0;
    return Object.keys(current).length > 0;
  }
  if (typeof current === 'string' && current.trim()) return true;
  return Boolean(document.getElementById('interactionOutput')?.value.trim());
}

function supportsThinking(model) {
  if (!model) return false;
  return /gemini-(2\.5|3)/i.test(model);
}

function extractGeminiParts(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let text = '';
  let thought = '';
  for (const part of parts) {
    const piece = part?.text || '';
    if (!piece) continue;
    if (part.thought) thought += piece;
    else text += piece;
  }
  return { text, reasoning: thought };
}

function extractOpenRouterParts(chunk) {
  const delta = chunk?.choices?.[0]?.delta || chunk?.choices?.[0]?.message || {};
  let reasoning = '';
  if (typeof delta.reasoning === 'string') reasoning += delta.reasoning;
  if (Array.isArray(delta.reasoning_details)) {
    for (const detail of delta.reasoning_details) {
      if (typeof detail?.text === 'string') reasoning += detail.text;
    }
  }
  return { text: delta.content || '', reasoning };
}

async function runGoogleInteraction(settings, prompt, signal) {
  const generationConfig = {
    temperature: 0.35,
    responseMimeType: 'application/json',
  };
  if (supportsThinking(settings.model)) {
    generationConfig.thinkingConfig = { includeThoughts: true };
  }
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  };
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(settings.googleKey)}`,
    { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!resp.ok) throw new Error(`Gemini 生成失败：${resp.status} ${await resp.text()}`);
  await consumeStream(resp, extractGeminiParts, signal, 45, 'Gemini');
}

async function runOpenRouterInteraction(settings, prompt, signal) {
  const model = toOpenRouterModelId(settings.model);
  const apiKey = String(settings.openrouterKey || '').trim();
  if (!looksLikeOpenRouterApiKey(apiKey)) {
    throw new Error('OpenRouter API Key 缺失或格式不正确。请在设置中填写以 sk-or- 开头的 OpenRouter Key。');
  }
  const body = {
    model,
    stream: true,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  };
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin || 'https://localhost',
      'X-Title': 'Role Play Movie Maker',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`OpenRouter 生成失败：${resp.status} ${await resp.text()}`);
  await consumeStream(resp, extractOpenRouterParts, signal, 45, 'OpenRouter');
}

async function consumeStream(resp, extractParts, signal, progressFloor, providerLabel = '模型') {
  let fullText = '';
  let reasoningText = '';
  let chunkCount = 0;
  let reasoningChunks = 0;
  let lastReasoningLogLen = 0;
  const output = document.getElementById('interactionOutput');
  if (output) {
    output.value = '';
    output.readOnly = false;
  }
  const stopWait = startWaitingIndicator('等待互动 JSON 开始返回');
  await readSSEStream(resp, (chunkJson) => {
    chunkCount++;
    if (chunkCount === 1) stopWait();
    const extracted = extractParts(chunkJson) || {};
    const piece = typeof extracted === 'string' ? extracted : (extracted.text || '');
    const reasoningPiece = typeof extracted === 'string' ? '' : (extracted.reasoning || '');
    if (reasoningPiece) {
      reasoningChunks++;
      reasoningText += reasoningPiece;
      if (output && !fullText) {
        output.value = '💭 思考中…\n\n' + reasoningText;
        output.scrollTop = output.scrollHeight;
      }
      if (reasoningText.length - lastReasoningLogLen >= 120) {
        const snippet = reasoningText.slice(lastReasoningLogLen).replace(/\s+/g, ' ').trim();
        if (snippet) ipLog(`  💭 ${snippet.slice(0, 160)}${snippet.length > 160 ? '…' : ''}`);
        lastReasoningLogLen = reasoningText.length;
      }
      const current = parseFloat(document.getElementById('ipProgressBar')?.style.width) || progressFloor;
      if (current < 90) setIPProgress(current + 0.2);
    }
    if (piece) {
      if (!fullText && reasoningText) ipLog(`  ✓ 思考完成（${reasoningText.length} 个字符），接收答案中…`);
      fullText += piece;
      if (output) {
        output.value = fullText;
        output.scrollTop = output.scrollHeight;
      }
      if (chunkCount % 5 === 0) ipLog(`  流传中… ${chunkCount} 块，${fullText.length} 字符`);
      const current = parseFloat(document.getElementById('ipProgressBar')?.style.width) || progressFloor;
      if (current < 95) setIPProgress(current + 0.5);
    }
  }, signal);
  stopWait();
  if (reasoningChunks) ipLog(`推理：${reasoningChunks} 块，${reasoningText.length} 字符。`);
  ipLog(`${providerLabel} 流完成：${chunkCount} 块，${fullText.length} 字符。`, 'ok');
  if (!fullText) throw new Error('模型返回为空。');
  finalizeInteractionJson(fullText);
  setIPProgress(100);
}

function openSettingsForApiKey(provider) {
  document.getElementById('btnSettings')?.click();
  const target = provider === 'openrouter' ? document.getElementById('openrouterKey') : document.getElementById('googleKey');
  target?.focus();
  target?.select?.();
}

export function initInteractionGenerator() {
  const providerSel = document.getElementById('ipProviderMainSel');
  const modelSel = document.getElementById('ipModelSelect');
  if (!providerSel || !modelSel) return;

  const settings = getSettings();
  providerSel.value = settings.provider;
  refreshIPModelSelect(settings.provider);
  syncPromptFromControls();

  providerSel.addEventListener('change', () => {
    const provider = selectedProvider();
    const saved = loadSettings();
    saved.provider = provider;
    saveSettings(saved);
    refreshIPModelSelect(provider);
    syncPromptFromControls({ force: true });
  });
  modelSel.addEventListener('change', () => {
    const saved = loadSettings();
    if (selectedProvider() === 'openrouter') saved.openrouterModel = modelSel.value;
    else saved.googleModel = modelSel.value;
    saveSettings(saved);
  });
  ['ipSkillGrid', 'ipMovieRatio', 'ipInteractionRatio', 'ipDurationSeconds', 'ipPresetSel'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => syncPromptFromControls({ force: true }));
    document.getElementById(id)?.addEventListener('change', () => syncPromptFromControls({ force: true }));
  });

  document.getElementById('btnGenerateInteractions')?.addEventListener('click', async () => {
    const movieData = getCurrentMovieJson();
    if (!movieData) {
      ipLog('请先完成阶段 2，生成可解析的电影 JSON。', 'err');
      return;
    }
    const provider = selectedProvider();
    const base = getSettings();
    const settingsForRun = { ...base, provider, model: modelSel.value };
    if (provider === 'google' && !settingsForRun.googleKey) {
      ipLog('缺少 Google API 密钥。', 'err');
      openSettingsForApiKey('google');
      return;
    }
    if (provider === 'openrouter' && !looksLikeOpenRouterApiKey(settingsForRun.openrouterKey)) {
      ipLog('OpenRouter API Key 缺失或格式不正确。请填写以 sk-or- 开头的 Key。', 'err');
      openSettingsForApiKey('openrouter');
      return;
    }
    if (hasExistingInteractionPoints() && !window.confirm('重新生成互动会覆盖所有现有互动点。确定继续吗？')) {
      ipLog('已取消重新生成，现有互动点保持不变。', 'warn');
      return;
    }
    const generateBtn = document.getElementById('btnGenerateInteractions');
    const cancelBtn = document.getElementById('btnCancelInteractions');
    generateBtn.disabled = true;
    cancelBtn.disabled = false;
    setIPProgress(0);
    state.interactionAbortController = new AbortController();
    try {
      ipLog('开始生成互动点…');
      syncPromptFromControls();
      const prompt = document.getElementById('interactionPromptText')?.value || buildInteractionPrompt();
      if (provider === 'google') await runGoogleInteraction(settingsForRun, prompt, state.interactionAbortController.signal);
      else await runOpenRouterInteraction(settingsForRun, prompt, state.interactionAbortController.signal);
      await saveProject();
      ipLog('阶段 4 已完成并保存到项目文件。', 'ok');
    } catch (error) {
      if (error.name === 'AbortError') ipLog('已取消。', 'warn');
      else {
        console.error(error);
        ipLog('错误：' + (error.message || error), 'err');
      }
    } finally {
      generateBtn.disabled = false;
      cancelBtn.disabled = true;
      state.interactionAbortController = null;
    }
  });

  document.getElementById('btnCancelInteractions')?.addEventListener('click', () => {
    state.interactionAbortController?.abort();
  });

  document.getElementById('interactionOutput')?.addEventListener('input', () => {
    clearTimeout(state.interactionOutputEditTimer);
    state.interactionOutputEditTimer = setTimeout(() => {
      const text = document.getElementById('interactionOutput')?.value || '';
      let parsed = null;
      if (text.trim()) {
        try { parsed = JSON.parse(text); } catch {}
      }
      state.interactionPoints = parsed || (text.trim() ? text : null);
      document.getElementById('btnInteractionCopy').disabled = !text.trim();
      document.getElementById('btnInteractionDownload').disabled = !text.trim();
      updateInteractionResultSummary();
      rebuildTimeline();
    }, 300);
  });

  document.getElementById('btnInteractionCopy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('interactionOutput')?.value || '');
      ipLog('已复制互动点 JSON。', 'ok');
    } catch (error) { ipLog('复制失败：' + error.message, 'err'); }
  });

  document.getElementById('btnInteractionDownload')?.addEventListener('click', () => {
    const text = document.getElementById('interactionOutput')?.value || '';
    triggerDownload(new Blob([text], { type: 'application/json' }), suggestName('interactions.json'));
  });

  document.getElementById('btnInteractionClear')?.addEventListener('click', () => {
    state.interactionPoints = null;
    const output = document.getElementById('interactionOutput');
    if (output) output.value = '';
    document.getElementById('btnInteractionCopy').disabled = true;
    document.getElementById('btnInteractionDownload').disabled = true;
    updateInteractionResultSummary();
    rebuildTimeline();
    ipLog('互动点已清空。', 'warn');
  });
}