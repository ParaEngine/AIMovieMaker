// ============ Google Gemini path (Files API + streaming generateContent) ============
import { RESPONSE_SCHEMA } from './constants.js';
import { ui } from './ui.js';
import { log, humanSize, sleep, setProgress, fetchWithProgress } from './utils.js';
import { clampFps } from './settings.js';
import { addUpload, removeUpload } from './uploads.js';
import { getCachedKwUrl } from './kwsdk.js';
import { readSSEStream, startWaitingIndicator } from './sse.js';
import { finalizeJson } from './output.js';

/* Some Gemini models (2.0-flash, flash-lite) reject `thinkingConfig`. */
function supportsThinking(model) {
  if (!model) return false;
  return /gemini-(2\.5|3)/i.test(model);
}

function extractGeminiParts(data) {
  const cands = data?.candidates;
  if (!cands?.length) return { text: '', thought: '' };
  const parts = cands[0]?.content?.parts || [];
  let text = '', thought = '';
  for (const p of parts) {
    const t = p?.text || '';
    if (!t) continue;
    if (p.thought) thought += t;
    else text += t;
  }
  return { text, thought };
}

export async function runGoogle(file, cached, settings, signal) {
  const key = settings.googleKey;
  const model = settings.model;

  // Try a cached Keepwork CDN URL via fileData first — saves a multi-GB upload.
  if (!cached && file) {
    const kwUrl = getCachedKwUrl(file);
    if (kwUrl) {
      const mime = file.type || 'video/mp4';
      log(`找到该文件的 Keepwork 缓存 URL，尝试直接发送给 Gemini：${kwUrl}`);
      try {
        await runGoogleWithFileUri(kwUrl, mime, settings, signal);
        return;
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        log(`Gemini 未接受该公开 URL（${e.message || e}）。回退到 Files API 上传。`, 'warn');
      }
    }
  }

  let active;
  let fileName;

  if (cached) {
    log(`使用缓存文件 ${cached.name} — 验证状态中…`);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${cached.name}?key=${encodeURIComponent(key)}`, { signal });
    if (!r.ok) {
      removeUpload(cached.name);
      throw new Error(`缓存文件在 Gemini 上已不存在（${r.status}）。已从本地列表移除。`);
    }
    active = await r.json();
    fileName = active.name;
    setProgress(60);
  } else {
    log('启动 Files API 上传…');
    const startResp = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        signal,
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(file.size),
          'X-Goog-Upload-Header-Content-Type': file.type || 'video/mp4',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: file.name } }),
      }
    );
    if (!startResp.ok) throw new Error(`上传初始化失败：${startResp.status} ${await startResp.text()}`);
    const uploadUrl = startResp.headers.get('X-Goog-Upload-URL') || startResp.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('Files API 未返回上传 URL。');

    log(`上传 ${humanSize(file.size)} 中…`);
    const uploadResp = await fetchWithProgress(uploadUrl, file, signal, (loaded) => {
      setProgress((loaded / file.size) * 50);
    });
    if (!uploadResp.ok) throw new Error(`上传失败：${uploadResp.status} ${uploadResp.responseText}`);
    let fileMeta;
    try { fileMeta = JSON.parse(uploadResp.responseText).file; }
    catch { throw new Error('无法解析上传响应。'); }
    if (!fileMeta?.uri) throw new Error('上传响应缺少 file.uri。');
    log(`已上传。URI：${fileMeta.uri}`, 'ok');

    log('等待 Gemini 完成视频处理…');
    active = fileMeta;
    fileName = fileMeta.name;
    const pollStart = Date.now();
    while (active.state && active.state !== 'ACTIVE') {
      if (active.state === 'FAILED') throw new Error('Gemini 报告上传文件状态为 FAILED。');
      await sleep(2000, signal);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(key)}`, { signal });
      if (!r.ok) throw new Error(`状态查询失败：${r.status}`);
      active = await r.json();
      const elapsed = ((Date.now() - pollStart) / 1000).toFixed(0);
      log(`  state=${active.state} (${elapsed}s)`);
      setProgress(50 + Math.min(20, elapsed / 2));
    }

    addUpload({
      name: fileName,
      displayName: active.displayName || file.name,
      uri: active.uri,
      mimeType: active.mimeType || active.mime_type || file.type || 'video/mp4',
      sizeBytes: file.size,
      expiresAt: active.expirationTime || null,
      savedAt: new Date().toISOString(),
    });
  }

  if (active.state && active.state !== 'ACTIVE') {
    throw new Error(`文件状态为 ${active.state}，非 ACTIVE。`);
  }
  log('文件已 ACTIVE。生成分析中…', 'ok');
  setProgress(72);

  await streamGemini({
    fileUri: active.uri,
    mimeType: active.mimeType || active.mime_type || 'video/mp4',
    settings,
    signal,
    progressFloor: 72,
  });
}

/* Run Gemini streamGenerateContent with a file_uri instead of a Files API upload. */
export async function runGoogleWithFileUri(fileUri, mimeType, settings, signal) {
  setProgress(60);
  log('向 Gemini 发送请求（使用缓存公开 URL）…');
  await streamGemini({
    fileUri,
    mimeType: mimeType || 'video/mp4',
    settings,
    signal,
    progressFloor: 60,
  });
}

/* Shared Gemini streaming routine used by both runGoogle and runGoogleWithFileUri. */
async function streamGemini({ fileUri, mimeType, settings, signal, progressFloor }) {
  const key = settings.googleKey;
  const model = settings.model;
  const fps = clampFps(settings.fps);
  const generationConfig = {
    temperature: 0.2,
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
  };
  if (supportsThinking(model)) {
    generationConfig.thinkingConfig = { includeThoughts: true };
  }
  const body = {
    contents: [{
      role: 'user',
      parts: [
        {
          file_data: { mime_type: mimeType, file_uri: fileUri },
          video_metadata: { fps },
        },
        { text: settings.prompt },
      ],
    }],
    generationConfig,
  };

  log('向 Gemini 发送请求…');
  const genResp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!genResp.ok) throw new Error(`streamGenerateContent 失败：${genResp.status} ${await genResp.text()}`);

  let fullText = '';
  let thoughtText = '';
  let chunkCount = 0;
  let thoughtChunks = 0;
  let lastThoughtLogLen = 0;
  ui.output.value = '';
  ui.output.readOnly = false;
  const stopWait = startWaitingIndicator('等待 Gemini 开始返回流');
  await readSSEStream(genResp, (chunkJson) => {
    chunkCount++;
    if (chunkCount === 1) stopWait();
    const { text: piece, thought: thoughtPiece } = extractGeminiParts(chunkJson);
    if (thoughtPiece) {
      thoughtChunks++;
      thoughtText += thoughtPiece;
      if (!fullText) {
        ui.output.value = '💭 思考中…\n\n' + thoughtText;
        ui.output.scrollTop = ui.output.scrollHeight;
      }
      if (thoughtText.length - lastThoughtLogLen >= 120) {
        const snippet = thoughtText.slice(lastThoughtLogLen).replace(/\s+/g, ' ').trim();
        if (snippet) log(`  💭 ${snippet.slice(0, 160)}${snippet.length > 160 ? '…' : ''}`);
        lastThoughtLogLen = thoughtText.length;
      }
      const cur = parseFloat(ui.progress.style.width) || progressFloor;
      if (cur < 90) setProgress(cur + 0.2);
    }
    if (piece) {
      if (!fullText && thoughtText) log(`  ✓ 思考完成（${thoughtText.length} 个字符），接收答案中…`);
      fullText += piece;
      ui.output.value = fullText;
      ui.output.scrollTop = ui.output.scrollHeight;
      if (chunkCount % 5 === 0) log(`  流传中… ${chunkCount} 块，${fullText.length} 字符`);
      const cur = parseFloat(ui.progress.style.width) || progressFloor;
      if (cur < 95) setProgress(cur + 0.5);
    }
  }, signal);
  stopWait();
  if (thoughtChunks) log(`思考：${thoughtChunks} 块，${thoughtText.length} 字符。`);
  log(`流完成：${chunkCount} 块，${fullText.length} 字符。`, 'ok');

  if (!fullText) throw new Error('模型返回为空。');
  finalizeJson(fullText);
  setProgress(100);
}
