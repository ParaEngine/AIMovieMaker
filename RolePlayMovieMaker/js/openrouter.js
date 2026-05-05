// ============ OpenRouter path (uploads via Keepwork CDN, sends URL) ============
import { ui } from './ui.js';
import { log, setProgress } from './utils.js';
import { clampFps, looksLikeOpenRouterApiKey } from './settings.js';
import { uploadVideoToKeepwork } from './kwsdk.js';
import { readSSEStream, startWaitingIndicator } from './sse.js';
import { finalizeJson } from './output.js';

export function toOpenRouterModelId(model) {
  const m = String(model || '').trim();
  if (!m) return 'google/gemini-2.5-pro';
  if (m.includes('/')) return m;
  if (/^gemini/i.test(m)) return `google/${m}`;
  if (/^(gpt|o\d|chatgpt)/i.test(m)) return `openai/${m}`;
  if (/^claude/i.test(m)) return `anthropic/${m}`;
  return m;
}

export async function runOpenRouter(file, settings, signal) {
  log('OpenRouter 路径：上传视频到 Keepwork CDN，然后将 URL 发送给 OpenRouter…');
  const videoUrl = await uploadVideoToKeepwork(file, signal);
  setProgress(50);
  // Populate the URL field if the user hasn't set one manually.
  if (ui.urlInput && !ui.urlInput.value.trim()) {
    ui.urlInput.value = videoUrl;
    if (!ui.urlMime?.value?.trim() && ui.urlMime) ui.urlMime.value = file.type || 'video/mp4';
    ui.urlInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await runOpenRouterWithUrl(videoUrl, file.name, file.type || 'video/mp4', settings, signal);
}

export async function runOpenRouterWithUrl(videoUrl, filename, mimeType, settings, signal) {
  const prompt = settings.prompt;
  const orModel = toOpenRouterModelId(settings.model);
  const apiKey = String(settings.openrouterKey || '').trim();
  if (!looksLikeOpenRouterApiKey(apiKey)) {
    throw new Error('OpenRouter API Key 缺失或格式不正确。请在设置中填写以 sk-or- 开头的 OpenRouter Key。');
  }
  if (orModel !== settings.model) log(`使用 OpenRouter 模型 ID：${orModel}`);
  const isVideo = /^video\//i.test(mimeType || '') || /\.(mp4|mov|webm|mkv|avi)(\?|$)/i.test(videoUrl);
  const fps = clampFps(settings.fps);
  const mediaPart = isVideo
    ? { type: 'video_url', video_url: { url: videoUrl }, video_metadata: { fps } }
    : { type: 'image_url', image_url: { url: videoUrl } };
  const body = {
    model: orModel,
    stream: true,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        mediaPart,
      ],
    }],
  };

  log('向 OpenRouter 发送请求…');
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin || 'https://localhost',
      'X-Title': 'Video Parser',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`OpenRouter 调用失败：${resp.status} ${await resp.text()}`);

  let fullText = '';
  let reasoningText = '';
  let chunkCount = 0;
  let reasoningChunks = 0;
  let lastReasoningLogLen = 0;
  ui.output.value = '';
  ui.output.readOnly = false;
  const stopWait = startWaitingIndicator('等待 OpenRouter 开始返回流');
  await readSSEStream(resp, (chunkJson) => {
    chunkCount++;
    if (chunkCount === 1) stopWait();
    const delta = chunkJson?.choices?.[0]?.delta || chunkJson?.choices?.[0]?.message || {};
    let reasoningPiece = '';
    if (typeof delta.reasoning === 'string') reasoningPiece += delta.reasoning;
    if (Array.isArray(delta.reasoning_details)) {
      for (const d of delta.reasoning_details) {
        if (typeof d?.text === 'string') reasoningPiece += d.text;
      }
    }
    if (reasoningPiece) {
      reasoningChunks++;
      reasoningText += reasoningPiece;
      if (!fullText) {
        ui.output.value = '💭 思考中…\n\n' + reasoningText;
        ui.output.scrollTop = ui.output.scrollHeight;
      }
      if (reasoningText.length - lastReasoningLogLen >= 120) {
        const snippet = reasoningText.slice(lastReasoningLogLen).replace(/\s+/g, ' ').trim();
        if (snippet) log(`  💭 ${snippet.slice(0, 160)}${snippet.length > 160 ? '…' : ''}`);
        lastReasoningLogLen = reasoningText.length;
      }
      const cur = parseFloat(ui.progress.style.width) || 50;
      if (cur < 90) setProgress(cur + 0.2);
    }
    const piece = delta.content || '';
    if (piece) {
      if (!fullText && reasoningText) log(`  ✓ 思考完成（${reasoningText.length} 个字符），接收答案中…`);
      fullText += piece;
      ui.output.value = fullText;
      ui.output.scrollTop = ui.output.scrollHeight;
      if (chunkCount % 5 === 0) log(`  流传中… ${chunkCount} 块，${fullText.length} 字符`);
      const cur = parseFloat(ui.progress.style.width) || 50;
      if (cur < 95) setProgress(cur + 0.5);
    }
  }, signal);
  stopWait();
  if (reasoningChunks) log(`推理：${reasoningChunks} 块，${reasoningText.length} 字符。`);
  log(`流完成：${chunkCount} 块，${fullText.length} 字符。`, 'ok');

  if (!fullText) throw new Error('OpenRouter 返回为空。');
  finalizeJson(fullText);
  setProgress(100);
}
