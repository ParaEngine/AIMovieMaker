// ============ Server-Sent Events streaming helpers (Gemini / OpenRouter) ============
import { log } from './utils.js';

/* Read a Server-Sent Events stream from a fetch() Response. Calls onEvent(parsedJson) per data line. */
export async function readSSEStream(resp, onEvent, signal) {
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    const txt = await resp.text();
    flushBufferAsEvents(txt, onEvent);
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let parseErrors = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        parseErrors += processSSEEvent(event, onEvent);
      }
    }
    if (buffer.trim()) parseErrors += processSSEEvent(buffer, onEvent);
    if (parseErrors) log(`SSE：${parseErrors} 个块 JSON 解析失败。`, 'warn');
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

export function processSSEEvent(event, onEvent) {
  const dataLines = event.split('\n')
    .filter(l => l.startsWith('data:'))
    .map(l => l.slice(5).replace(/^ /, ''));
  if (!dataLines.length) return 0;
  const payload = dataLines.join('\n').trim();
  if (!payload || payload === '[DONE]') return 0;
  try { onEvent(JSON.parse(payload)); return 0; }
  catch (e) {
    console.warn('SSE JSON parse failed:', e, payload.slice(0, 200));
    return 1;
  }
}

export function flushBufferAsEvents(txt, onEvent) {
  const norm = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const ev of norm.split('\n\n')) processSSEEvent(ev, onEvent);
}

/* While we wait for the first streamed byte, give the user a reassuring,
 * periodic heartbeat so they don't think the page is frozen. */
export function startWaitingIndicator(label) {
  const start = Date.now();
  log(`${label || '等待首个流响应'}…（视频分析可能需要 30–90 秒，请耐心等待）`);
  const id = setInterval(() => {
    const sec = Math.round((Date.now() - start) / 1000);
    log(`  …仍在等待首个响应（已耗时 ${sec}秒）。模型正在处理视频。`);
  }, 8000);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(id);
    const sec = ((Date.now() - start) / 1000).toFixed(1);
    log(`  ✓ first response received after ${sec}s.`, 'ok');
  };
}
