// =================== Role-Play Movie — Loader ===================
// Source of truth: videoParser projects in PersonalPageStore workspace
// "videoParser". Each project file is "<name>.md" containing an envelope:
//   { format:"videoParser", version, name, input:{url,...}, output:<json> }
// We also support local file picker / paste-JSON as offline fallbacks,
// and shared projects via ?shareuser=&projectname= URL params.

import { normalizeMovie, validateMovie } from './format.js';

const VIDEOPARSER_WORKSPACE = 'videoParser';
const VIDEOPARSER_FILE_SUFFIX = '.md';
const VIDEOPARSER_REMOTE_STORE_PATH = 'edunotes/store';

/** Try to extract JSON from a workspace file (.md / .json / raw JSON). */
function extractJsonFromText(text) {
  if (!text) throw new Error('文件为空');
  let trimmed = String(text).trim();
  // Strip optional YAML frontmatter ("---\n...---\n") that some markdown
  // pipelines may prepend.
  if (trimmed.startsWith('---')) {
    const m = trimmed.match(/^---[\s\S]*?\n---\s*\n?/);
    if (m) trimmed = trimmed.slice(m[0].length).trim();
  }
  // Strip optional ```json fences.
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fence) trimmed = fence[1].trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('无法解析为 JSON（文件首字符：' + JSON.stringify(trimmed.slice(0, 32)) + '…）');
}

/** Sanitize project name to file-safe stem (mirror videoParser.html). */
function sanitizeProjectName(s) {
  return String(s || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '');
}

function projectFileName(name) {
  const stem = sanitizeProjectName(name);
  return stem ? stem + VIDEOPARSER_FILE_SUFFIX : '';
}

/** Get the videoParser workspace store, or throw. */
function getVideoParserStore() {
  const sdk = window.keepwork;
  if (!sdk || !sdk.personalPageStore) {
    throw new Error('未登录或 SDK 不可用');
  }
  return sdk.personalPageStore.withWorkspace(VIDEOPARSER_WORKSPACE);
}

/**
 * Unwrap a videoParser project envelope and resolve its videoUrl.
 * Falls back to opts.videoUrl when the envelope has no input.url.
 */
function unwrapProjectEnvelope(env, opts = {}) {
  // Some markdown pipelines may wrap our JSON inside a top-level `content`
  // string. Unwrap that first.
  if (env && typeof env === 'object' && !Array.isArray(env)
      && typeof env.content === 'string' && !env.format && !env.output && !env.shortClips) {
    try { env = extractJsonFromText(env.content); }
    catch (e) { /* fall through to validation below */ }
  }
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new Error('项目文件为空或不是 JSON 对象');
  }
  if (env.format && env.format !== 'videoParser') {
    throw new Error('不是 videoParser 项目文件（format=' + env.format + '）');
  }
  let inner;
  if (env.output && typeof env.output === 'object' && !Array.isArray(env.output)) {
    inner = env.output;
  } else if (typeof env.output === 'string' && env.output.trim()) {
    try { inner = extractJsonFromText(env.output); }
    catch (e) { throw new Error('output 字段不是合法 JSON'); }
  } else if (env.outputRaw) {
    try { inner = extractJsonFromText(String(env.outputRaw)); }
    catch (e) { throw new Error('项目尚未完成解析（outputRaw 不可解析）'); }
  } else if (env.shortClips || env.characters) {
    // Raw videoParser JSON without an envelope — accept directly.
    inner = env;
  } else {
    throw new Error('项目尚未完成解析（output 字段为空，请先在 videoParser 中运行解析并保存）');
  }
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
    throw new Error('output 解析结果不是 JSON 对象');
  }
  const url = (env.input && env.input.url) || opts.videoUrl || inner.videoUrl || '';
  return { rawInner: inner, videoUrl: url, title: opts.title || env.name || inner.title || '' };
}

/**
 * List all videoParser projects in the user's workspace.
 * @returns {Promise<Array<{name:string, fileName:string, modifiedAt?:string}>>}
 */
export async function listVideoParserProjects() {
  const store = getVideoParserStore();
  const result = await store.listDir('', false);
  let arr = [];
  if (Array.isArray(result)) {
    arr = result;
  } else if (result && Array.isArray(result.files)) {
    arr = result.files;
  } else if (typeof result === 'string') {
    if (/^Directory is empty or not found/i.test(result)) return [];
    arr = result.split('\n').map(s => s.trim()).filter(Boolean);
  }
  const suffixRe = new RegExp(VIDEOPARSER_FILE_SUFFIX.replace(/\./g, '\\.') + '$');
  return arr
    .map(it => (typeof it === 'string' ? { name: it } : it))
    .filter(it => it && it.name)
    .filter(it => !it.isDirectory && !it.is_dir && !/\/$/.test(it.name))
    .filter(it => suffixRe.test(it.name))
    .map(it => ({
      name: it.name.replace(suffixRe, ''),
      fileName: it.name,
      modifiedAt: it.modifiedAt || it.updatedAt || it.mtime || '',
    }))
    .sort((a, b) => {
      const ta = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
      const tb = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
      if (tb !== ta) return tb - ta;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Load a project from the user's videoParser workspace by name.
 * @param {string} name - project stem (without .md suffix)
 * @returns {Promise<{rawInner:Object, videoUrl:string, title:string}>}
 */
export async function loadVideoParserProject(name) {
  const store = getVideoParserStore();
  const fileName = projectFileName(name);
  if (!fileName) throw new Error('无效的项目名');
  const raw = await store.readFile(fileName);
  if (!raw || !String(raw).trim()) throw new Error('项目文件不存在或为空');
  let env;
  try { env = extractJsonFromText(String(raw)); }
  catch (e) {
    console.error('[RolePlay] JSON parse failed; raw preview:', String(raw).slice(0, 300));
    throw e;
  }
  return unwrapProjectEnvelope(env, { title: name });
}

/**
 * Load a shared (read-only) project: //{user}/edunotes/store/videoParser/<file>
 */
export async function loadSharedVideoParserProject(shareUser, projectname) {
  const sdk = window.keepwork;
  if (!sdk || !sdk.personalPageStore) throw new Error('SDK 不可用');
  const stem = sanitizeProjectName(projectname);
  if (!stem) throw new Error('无效的 projectname');
  const fileName = stem + VIDEOPARSER_FILE_SUFFIX;
  const absPath = `//${shareUser}/${VIDEOPARSER_REMOTE_STORE_PATH}/${VIDEOPARSER_WORKSPACE}/${fileName}`;
  const raw = await sdk.personalPageStore.readFile(absPath);
  if (!raw || !raw.trim()) throw new Error('共享项目不存在或不可访问');
  const env = extractJsonFromText(raw);
  return unwrapProjectEnvelope(env, { title: stem });
}

/** Load via browser file picker — accepts envelope or raw videoParser JSON. */
export async function loadFromLocalFile(file) {
  if (!file) throw new Error('未选择文件');
  const text = await file.text();
  const env = extractJsonFromText(text);
  return unwrapProjectEnvelope(env, { title: file.name.replace(/\.[^.]+$/, '') });
}

/** Parse user-pasted text — accepts envelope or raw videoParser JSON. */
export function loadFromPaste(text, opts = {}) {
  const env = extractJsonFromText(text);
  return unwrapProjectEnvelope(env, opts);
}

/**
 * High-level helper: produce a normalized MovieConfig from raw inner JSON.
 * @param {Object} rawInner - videoParser-format JSON (the unwrapped output)
 * @param {{title?:string, videoUrl?:string}} [opts]
 */
export function buildMovie(rawInner, opts = {}) {
  const movie = normalizeMovie(rawInner, opts);
  const errs = validateMovie(movie);
  if (errs.length) throw new Error(errs.join('; '));
  return movie;
}

/** Read URL params from both ?query and #hash. */
export function getUrlParams() {
  const a = new URLSearchParams(location.search);
  const b = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : '');
  const get = (k) => a.get(k) || b.get(k) || '';
  return {
    file: get('file') || get('projectname'),
    shareUser: get('shareuser'),
    token: get('token'),
    video: get('video'),
    title: get('title'),
  };
}
