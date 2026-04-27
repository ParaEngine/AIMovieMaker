// ============ API: LLM, Seedance, Upload ============

import { CONFIG, getLanguageInstruction, getStylePreset, getEnvPreset, getRacePreset } from './config.js';
import { getPrompt, ensurePresetLoaded } from './prompts.js';
import { state, sdk, syncShortReferenceVideoUrl, syncReferenceVideoDependents } from './state.js';
import { showToast } from './utils.js';
import { getProjectAssetFolder, getProjectWorkspace, getProjectWorkspaceStore, updateTaskLogEntry, saveAssetToLocal } from './storage.js';
import { recordLLMCall, recordImageCall, recordVideoCall } from './stats.js';
import { getGlobalPromptPreset } from './global_settings.js';

/** Resolve prompt preset: project-level > global setting */
function getProjectPromptPreset(project) {
    return project?.settings?.promptPreset || getGlobalPromptPreset();
}

// ---- Image Upload ----
function generateTempId() { return 'tmpImg_' + crypto.randomUUID().replace(/-/g, ''); }

function sanitizeAssetSegment(value, fallback = 'asset') {
    const cleaned = String(value || fallback).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return cleaned || fallback;
}

function detectExtension(fileName, mimeType, fallback = 'bin') {
    const nameMatch = String(fileName || '').match(/\.([a-zA-Z0-9]+)$/);
    if (nameMatch) return nameMatch[1].toLowerCase();
    const mimeMap = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
    };
    return mimeMap[mimeType] || fallback;
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(blob);
    });
}

function splitDataUrl(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('无法解析文件数据');
    return { mimeType: match[1], base64: match[2] };
}

function getRepoTargetFromRemotePath(remotePath) {
    const parts = String(remotePath || '').split('/').filter(Boolean);
    if (parts.length < 3) throw new Error('工作区路径无效');
    return {
        sitePath: `${parts[0]}/${parts[1]}`,
        pagePath: parts.slice(2).join('/'),
    };
}

async function saveBase64Asset(project, relativePath, base64Content, commitMessage) {
    if (!sdk?.token) throw new Error('请先登录');
    const workspaceStore = getProjectWorkspaceStore(project);
    if (!workspaceStore) throw new Error('PersonalPageStore 不可用');

    const remotePath = workspaceStore.getRemotePagePath(relativePath);
    const { sitePath, pagePath } = getRepoTargetFromRemotePath(remotePath);
    const repoPath = sdk.getRepoPath(sitePath);
    const encodedFilePath = sdk.safeEncodeURIComponent(`${sitePath}/${pagePath}`);
    const payload = {
        message: commitMessage || `Save ${pagePath}`,
        encoding: 'base64',
        content: base64Content,
    };

    try {
        await sdk.put(`/repos/${repoPath}/files/${encodedFilePath}`, payload);
    } catch (error) {
        if (!String(error?.message || error).includes('404')) throw error;
        await sdk.post(`/repos/${repoPath}/files/${encodedFilePath}`, payload);
    }

    return {
        workspace: getProjectWorkspace(project),
        path: relativePath,
        url: workspaceStore.getAbsUrl(relativePath),
    };
}

async function saveBlobAsset(project, relativePath, blob, commitMessage) {
    const dataUrl = await blobToDataUrl(blob);
    const { base64 } = splitDataUrl(dataUrl);
    return await saveBase64Asset(project, relativePath, base64, commitMessage);
}

export async function uploadTempImage(file) {
    const tempId = generateTempId();
    try {
        const tokenResp = await fetch(`${CONFIG.STORAGE_BASE}/files/${tempId}/tokenByPublicTemporary`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` }
        });
        if (!tokenResp.ok) throw new Error('获取上传令牌失败');
        const tokenData = await tokenResp.json();
        if (tokenData.message !== 'success' || !tokenData.data?.token) throw new Error('获取上传令牌失败');
        const formData = new FormData();
        formData.append('file', file);
        formData.append('key', tempId);
        formData.append('token', tokenData.data.token);
        const uploadResp = await fetch(CONFIG.QINIU_UPLOAD_URL, { method: 'POST', body: formData });
        if (!uploadResp.ok) throw new Error('上传失败');
        return `${CONFIG.QINIU_TEMP_URL}/${tempId}`;
    } catch (err) {
        showToast(`上传失败: ${err.message}`, 'error');
        return null;
    }
}

export async function uploadTempVideo(file) {
    const tempId = generateTempId();
    try {
        const tokenResp = await fetch(`${CONFIG.STORAGE_BASE}/files/${tempId}/tokenByPublicTemporary?bucketName=tempvision`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!tokenResp.ok) throw new Error('获取上传令牌失败');
        const tokenData = await tokenResp.json();
        if (tokenData.message !== 'success' || !tokenData.data?.token) throw new Error('获取上传令牌失败');
        const formData = new FormData();
        formData.append('file', file);
        formData.append('key', tempId);
        formData.append('token', tokenData.data.token);
        const uploadResp = await fetch(CONFIG.QINIU_UPLOAD_VIDEO_URL, { method: 'POST', body: formData });
        if (!uploadResp.ok) throw new Error('上传失败');
        return `${CONFIG.QINIU_TEMP_VIDEO_URL}/${tempId}`;
    } catch (err) {
        showToast(`视频上传失败: ${err.message}`, 'error');
        return null;
    }
}

// Audio uploads reuse the same temporary image bucket
export async function uploadTempAudio(file) {
    return await uploadTempImage(file);
}

export async function saveProjectImageAsset(project, file, folderName, assetId) {
    const url = await uploadTempImage(file);
    if (!url) return null;
    return {
        workspace: getProjectWorkspace(project),
        path: `uploads/${sanitizeAssetSegment(getProjectAssetFolder(project), 'project')}/${sanitizeAssetSegment(folderName, 'images')}/${sanitizeAssetSegment(assetId || crypto.randomUUID())}`,
        url,
    };
}

export async function saveGeneratedVideoAsset(project, short, sourceUrl) {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
        throw new Error(`下载生成视频失败: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const extension = detectExtension('', blob.type, 'mp4');
    const projectKey = sanitizeAssetSegment(project?.title, 'project');
    const shortKey = `${String(short.order || 0).padStart(3, '0')}-${sanitizeAssetSegment(short.id, 'short')}`;
    const relativePath = `videos/${projectKey}-${shortKey}.${extension}`;
    return await saveBlobAsset(project, relativePath, blob, `Save generated video ${shortKey}`);
}

// ---- LLM Chat (non-streaming, kept for compatibility) ----
export async function llmChat(systemPrompt, userMessage) {
    const { getGlobalLLMApiKey } = await import('./global_settings.js');
    const apiKey = getGlobalLLMApiKey();
    const headers = { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' };
    if (apiKey) headers['API_KEY'] = apiKey;
    const t0 = Date.now();
    const resp = await fetch(`${state.apiBase}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            response_format: { type: 'json_object' }
        })
    });
    if (!resp.ok) {
        recordLLMCall({ label: 'llmChat', promptText: systemPrompt + userMessage, responseText: '', success: false, error: `HTTP ${resp.status}`, durationMs: Date.now() - t0 });
        throw new Error(`LLM 请求失败: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM 未返回内容');
    recordLLMCall({
        label: 'llmChat',
        model: data.model || '',
        promptText: systemPrompt + userMessage,
        responseText: content,
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        success: true,
        durationMs: Date.now() - t0,
    });
    return JSON.parse(content);
}

// ---- LLM Chat (streaming via KeepworkSDK aiChat) ----
/**
 * Stream LLM response using KeepworkSDK aiChat session.
 * Calls onChunk(accumulatedText) on each partial update.
 * Returns the final parsed JSON object.
 */
export async function llmChatStream(systemPrompt, userMessage, onChunk, _callLabel) {
    if (!sdk || !sdk.aiChat) throw new Error('KeepworkSDK aiChat 不可用');

    const { getGlobalLLM } = await import('./global_settings.js');
    const { getGlobalLLMApiKey } = await import('./global_settings.js');
    const apiKey = getGlobalLLMApiKey();
    const modelName = getGlobalLLM();
    const extraHeaders = apiKey ? { 'API_KEY': apiKey } : undefined;
    const session = sdk.aiChat.createSession({
        stream: true,
        model: modelName,
        temperature: 0,
        extraHeaders,
    });

    const prompt = `${systemPrompt}\n\n${userMessage}`;
    let fullResponse = '';
    const t0 = Date.now();

    await new Promise((resolve, reject) => {
        session.send(prompt, {
            onMessage: (partialText) => {
                if (partialText !== undefined && partialText !== null) {
                    fullResponse = partialText;
                    if (onChunk) onChunk(fullResponse);
                }
            },
            onComplete: (finalText) => {
                fullResponse = finalText || fullResponse;
                if (onChunk) onChunk(fullResponse);
                resolve();
            },
            onError: (error) => {
                recordLLMCall({ label: _callLabel || 'llmChatStream', model: modelName, promptText: prompt, responseText: fullResponse, success: false, error: error.message || String(error), durationMs: Date.now() - t0 });
                reject(new Error(`LLM 请求失败: ${error.message || error}`));
            },
        });
    });

    if (!fullResponse.trim()) throw new Error('LLM 未返回内容');

    // Record successful LLM call
    recordLLMCall({ label: _callLabel || 'llmChatStream', model: modelName, promptText: prompt, responseText: fullResponse, success: true, durationMs: Date.now() - t0 });

    // Extract JSON from the response (may be wrapped in markdown code blocks)
    let jsonStr = fullResponse.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        // Attempt basic JSON repair: fix trailing commas, truncated responses
        try {
            let repaired = jsonStr
                .replace(/,\s*([\]}])/g, '$1')          // remove trailing commas
                .replace(/(["\d\w\]}\-])\s*\n\s*"/g, '$1,\n"'); // add missing commas between properties
            // If response was truncated, try to close open brackets
            const opens = (repaired.match(/[\[{]/g) || []).length;
            const closes = (repaired.match(/[\]}]/g) || []).length;
            for (let i = 0; i < opens - closes; i++) {
                const lastOpen = repaired.lastIndexOf('[') > repaired.lastIndexOf('{') ? ']' : '}';
                repaired += lastOpen;
            }
            return JSON.parse(repaired);
        } catch (_) {
            // repair failed — throw original error
        }
        throw new Error(`JSON 解析失败: ${e.message}\n\n--- LLM 原始返回 ---\n${fullResponse.slice(0, 3000)}`);
    }
}

// ---- Script Analysis ----
function getSubtitleInstruction(includeNarration, includeDialogue) {
    if (!includeNarration && !includeDialogue) return '';
    const parts = ['\n\nAdditionally, for EACH short clip in the "shorts" array, include the following extra field(s):'];
    if (includeNarration) {
        parts.push(
            `- "narration": a concise off-screen voice-over line (旁白) that fits within the clip's duration ` +
            `(roughly 3-4 Chinese characters or ~2 English words per second; never exceed 60 characters). ` +
            `Narration should add atmosphere, context, or insight WITHOUT repeating spoken dialogue. ` +
            `Use an empty string "" when no narration suits the clip. Use the same language as other text fields.`
        );
    }
    if (includeDialogue) {
        parts.push(
            `- "dialogue": the spoken line by the on-screen actor in this clip (角色台词), in the same language as other text. ` +
            `Keep it short (<=60 characters) and natural for the scene. ` +
            `Use an empty string "" when the clip has no spoken dialogue (e.g. silent action or pure scenery shots).`
        );
    }
    return parts.join('\n');
}

export function getAnalyzeScriptPrompt(script, totalDuration, langCode, episodeCount, promptPreset, options = {}) {
    const langInstr = getLanguageInstruction(langCode);
    let episodeInstr = '';
    if (episodeCount > 1) {
        episodeInstr = `\n\nThe movie has ${episodeCount} episodes. Each short MUST include an "episode" field (integer 1-${episodeCount}) indicating which episode it belongs to. Distribute the shorts across all episodes to tell the story progressively.`;
    }
    const subtitleInstr = getSubtitleInstruction(options.includeNarration, options.includeDialogue);
    const systemPrompt = getPrompt('scriptAnalysis', promptPreset || getGlobalPromptPreset()) + episodeInstr + subtitleInstr + langInstr;
    const userMsg = `Total movie duration: ${totalDuration} minutes.${episodeCount > 1 ? ` Total episodes: ${episodeCount}.` : ''}\n\nScript:\n${script}`;
    return { systemPrompt, userMsg };
}

export async function analyzeScript(script, totalDuration, onChunk, langCode, episodeCount, customPrompt, promptPreset, options = {}) {
    if (customPrompt) {
        return await llmChatStream(customPrompt, `Total movie duration: ${totalDuration} minutes.${episodeCount > 1 ? ` Total episodes: ${episodeCount}.` : ''}\n\nScript:\n${script}`, onChunk, '分析剧本');
    }
    await ensurePresetLoaded(promptPreset || getGlobalPromptPreset());
    const { systemPrompt, userMsg } = getAnalyzeScriptPrompt(script, totalDuration, langCode, episodeCount, promptPreset, options);
    return await llmChatStream(systemPrompt, userMsg, onChunk, '分析剧本');
}

// ---- Node Regeneration ----
function fillPromptTemplate(template, vars) {
    let result = template;
    for (const [key, val] of Object.entries(vars)) {
        result = result.replaceAll(`{${key}}`, val || '');
    }
    return result;
}

export function getRegeneratePrompt(nodeType, project, nodeId) {
    const p = project;
    const pp = getProjectPromptPreset(p);
    const langInstr = getLanguageInstruction(p.settings?.narrationLanguage);
    const charsStr = (p.characters || []).map(c => `${c.name}: ${c.description}`).join('\n');
    const propsStr = (p.props || []).map(pr => `${pr.name}: ${pr.description}`).join('\n');
    const scenesStr = (p.scenes || []).map(s => `${s.name}: ${s.description}`).join('\n');
    const scriptExcerpt = (p.script || '').slice(0, 2000);
    const sv = getStyleVars(p);

    const addLang = (prompt) => prompt + langInstr;

    switch (nodeType) {
        case 'synopsis':
            return addLang(fillPromptTemplate(getPrompt('regenerateSynopsis', pp), {
                script: scriptExcerpt, totalDuration: p.totalDuration
            }));
        case 'character': {
            const c = p.characters.find(x => x.id === nodeId);
            return addLang(fillPromptTemplate(getPrompt('regenerateCharacter', pp), {
                synopsis: p.synopsis, script: scriptExcerpt,
                existingCharacters: charsStr, characterName: c?.name || '',
                ...sv,
            }));
        }
        case 'prop': {
            const pr = p.props.find(x => x.id === nodeId);
            return addLang(fillPromptTemplate(getPrompt('regenerateProp', pp), {
                synopsis: p.synopsis, script: scriptExcerpt,
                existingProps: propsStr, propName: pr?.name || '',
                ...sv,
            }));
        }
        case 'scene': {
            const s = p.scenes.find(x => x.id === nodeId);
            return addLang(fillPromptTemplate(getPrompt('regenerateScene', pp), {
                synopsis: p.synopsis, script: scriptExcerpt,
                existingScenes: scenesStr, sceneName: s?.name || '',
                ...sv,
            }));
        }
        case 'short': {
            const sh = p.shorts.find(x => x.id === nodeId);
            const scene = p.scenes.find(sc => sc.id === sh?.sceneId);
            const shortChars = (sh?.characterIds || []).map(cid => {
                const c = p.characters.find(x => x.id === cid);
                return c?.name;
            }).filter(Boolean).join(', ');
            const shortProps = (sh?.propIds || []).map(pid => {
                const pr = p.props.find(x => x.id === pid);
                return pr?.name;
            }).filter(Boolean).join(', ');
            return addLang(fillPromptTemplate(getPrompt('regenerateShort', pp), {
                synopsis: p.synopsis, characters: charsStr, props: propsStr, scenes: scenesStr,
                order: sh?.order, sceneName: scene?.name || '(none)',
                shortCharacters: shortChars || '(none)',
                shortProps: shortProps || '(none)',
                ...sv,
            }));
        }
        case 'characters-group':
            return addLang(fillPromptTemplate(getPrompt('regenerateAllCharacters', pp), {
                script: scriptExcerpt, totalDuration: p.totalDuration, ...sv,
            }));
        case 'props-group':
            return addLang(fillPromptTemplate(getPrompt('regenerateAllProps', pp), {
                script: scriptExcerpt, totalDuration: p.totalDuration, ...sv,
            }));
        case 'scenes-group':
            return addLang(fillPromptTemplate(getPrompt('regenerateAllScenes', pp), {
                script: scriptExcerpt, totalDuration: p.totalDuration, characters: charsStr, ...sv,
            }));
        case 'shorts-group':
            return addLang(fillPromptTemplate(getPrompt('regenerateAllShorts', pp), {
                script: scriptExcerpt, totalDuration: p.totalDuration,
                characters: charsStr, props: propsStr, scenes: scenesStr, ...sv,
            }));
        default:
            return '';
    }
}

export async function regenerateNode(nodeType, project, nodeId, customPrompt, onChunk) {
    await ensurePresetLoaded(getProjectPromptPreset(project));
    const prompt = customPrompt || getRegeneratePrompt(nodeType, project, nodeId);
    const userMsg = nodeType === 'synopsis'
        ? project.script?.slice(0, 3000) || 'Generate synopsis'
        : `Please regenerate based on the above context.`;
    const result = await llmChatStream(prompt, userMsg, onChunk, `重新生成${nodeType}`);
    return result;
}

// ---- Pipeline: Enhance Shots ----
function formatCharsForPrompt(project) {
    return (project.characters || []).map(c => `${c.name}: ${c.description}`).join('\n');
}
function formatPropsForPrompt(project) {
    return (project.props || []).map(p => `${p.name}: ${p.description}`).join('\n');
}
function formatScenesForPrompt(project) {
    return (project.scenes || []).map(s => `${s.name}: ${s.description}`).join('\n');
}
function formatShortsForPrompt(project) {
    return (project.shorts || []).map(s => {
        const scene = project.scenes.find(sc => sc.id === s.sceneId);
        const chars = (s.characterIds || []).map(cid => project.characters.find(c => c.id === cid)?.name).filter(Boolean);
        const props = (s.propIds || []).map(pid => project.props.find(p => p.id === pid)?.name).filter(Boolean);
        return `#${s.order} [scene: ${scene?.name || 'none'}] [chars: ${chars.join(', ') || 'none'}] [props: ${props.join(', ') || 'none'}] prompt: ${s.prompt} (${s.duration}s)`;
    }).join('\n');
}

const ENHANCE_BATCH_SIZE = 10;

function splitBatches(items, size) {
    const batches = [];
    for (let i = 0; i < items.length; i += size) {
        batches.push(items.slice(i, i + size));
    }
    return batches;
}

function getStyleVars(project) {
    const preset = getStylePreset(project.settings?.stylePreset);
    const customSuffix = project.settings?.customStyleSuffix || '';
    const envPreset = getEnvPreset(project.settings?.envPreset);
    const customEnv = project.settings?.customEnvSuffix || '';
    const racePreset = getRacePreset(project.settings?.racePreset);
    const customRace = project.settings?.customRaceSuffix || '';

    const envHint = envPreset.value === 'custom' ? customEnv : (envPreset.llmHint || '');
    const envPromptHint = envPreset.value === 'custom' ? customEnv : (envPreset.promptHint || '');
    const raceHint = racePreset.value === 'custom' ? customRace : (racePreset.llmHint || '');
    const racePromptHint = racePreset.value === 'custom' ? customRace : (racePreset.promptHint || '');

    let styleNote = preset.value === 'custom' ? (customSuffix || '') : (preset.llmStyleNote || '');
    let styleKeywords = preset.value === 'custom' ? (customSuffix || '') : (preset.llmStyleKeywords || '');

    // Append env and race context to LLM notes
    if (envHint) styleNote += `\n${envHint}`;
    if (raceHint) styleNote += `\n${raceHint}`;

    // Append env and race hints to keywords used in prompts
    if (envPromptHint) styleKeywords += (styleKeywords ? ', ' : '') + envPromptHint;
    if (racePromptHint) styleKeywords += (styleKeywords ? ', ' : '') + racePromptHint;

    return { styleNote, styleKeywords };
}

// ---- Pipeline: Enhance Characters ----
export function getEnhanceCharactersPrompt(project) {
    const pp = getProjectPromptPreset(project);
    const langInstr = getLanguageInstruction(project.settings?.narrationLanguage);
    const charsStr = (project.characters || []).map(c => `${c.name}: ${c.description}`).join('\n');
    return fillPromptTemplate(getPrompt('enhanceCharacters', pp), {
        synopsis: project.synopsis || '',
        script: (project.script || '').slice(0, 2000),
        characters: charsStr,
        ...getStyleVars(project),
    }) + langInstr;
}

export async function enhanceCharacters(project, onChunk, customPrompt) {
    const pp = getProjectPromptPreset(project);
    await ensurePresetLoaded(pp);
    const chars = project.characters || [];
    const batches = splitBatches(chars, ENHANCE_BATCH_SIZE);
    const allResults = [];
    const langInstr = getLanguageInstruction(project.settings?.narrationLanguage);

    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const batchLabel = batches.length > 1 ? `[批次 ${bi + 1}/${batches.length}] ` : '';
        if (onChunk) onChunk(`${batchLabel}正在增强 ${batch.map(c => c.name).join(', ')}...`);

        const batchCharsStr = batch.map(c => `${c.name}: ${c.description}`).join('\n');
        const prompt = customPrompt || (fillPromptTemplate(getPrompt('enhanceCharacters', pp), {
            synopsis: project.synopsis || '',
            script: (project.script || '').slice(0, 2000),
            characters: batchCharsStr,
            ...getStyleVars(project),
        }) + langInstr);
        const userMsg = `Here are the current characters to enhance:\n\n${batchCharsStr}`;
        const result = await llmChatStream(prompt, userMsg, (text) => {
            if (onChunk) onChunk(`${batchLabel}${text}`);
        });
        if (result.characters) allResults.push(...result.characters);
    }
    return { characters: allResults };
}

// ---- Pipeline: Enhance Scenes ----
export function getEnhanceScenesPrompt(project) {
    const pp = getProjectPromptPreset(project);
    const langInstr = getLanguageInstruction(project.settings?.narrationLanguage);
    const scenesStr = (project.scenes || []).map(s => `${s.name}: ${s.description}`).join('\n');
    return fillPromptTemplate(getPrompt('enhanceScenes', pp), {
        synopsis: project.synopsis || '',
        script: (project.script || '').slice(0, 2000),
        scenes: scenesStr,
        ...getStyleVars(project),
    }) + langInstr;
}

export async function enhanceScenes(project, onChunk, customPrompt) {
    const pp = getProjectPromptPreset(project);
    await ensurePresetLoaded(pp);
    const scenes = project.scenes || [];
    const batches = splitBatches(scenes, ENHANCE_BATCH_SIZE);
    const allResults = [];
    const langInstr = getLanguageInstruction(project.settings?.narrationLanguage);

    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const batchLabel = batches.length > 1 ? `[批次 ${bi + 1}/${batches.length}] ` : '';
        if (onChunk) onChunk(`${batchLabel}正在增强 ${batch.map(s => s.name).join(', ')}...`);

        const batchScenesStr = batch.map(s => `${s.name}: ${s.description}`).join('\n');
        const prompt = customPrompt || (fillPromptTemplate(getPrompt('enhanceScenes', pp), {
            synopsis: project.synopsis || '',
            script: (project.script || '').slice(0, 2000),
            scenes: batchScenesStr,
            ...getStyleVars(project),
        }) + langInstr);
        const userMsg = `Here are the current scenes to enhance:\n\n${batchScenesStr}`;
        const result = await llmChatStream(prompt, userMsg, (text) => {
            if (onChunk) onChunk(`${batchLabel}${text}`);
        }, '增强场景');
        if (result.scenes) allResults.push(...result.scenes);
    }
    return { scenes: allResults };
}

// ---- Pipeline: Enhance Shots ----
export function getEnhanceShotsPrompt(project) {
    const pp = getProjectPromptPreset(project);
    const langInstr = getLanguageInstruction(project.settings?.narrationLanguage);
    return fillPromptTemplate(getPrompt('enhanceShots', pp), {
        synopsis: project.synopsis || '',
        characters: formatCharsForPrompt(project),
        props: formatPropsForPrompt(project),
        scenes: formatScenesForPrompt(project),
        ...getStyleVars(project),
    }) + langInstr;
}

export async function enhanceShots(project, onChunk, customPrompt) {
    const pp = getProjectPromptPreset(project);
    await ensurePresetLoaded(pp);
    const shorts = project.shorts || [];
    const batches = splitBatches(shorts, ENHANCE_BATCH_SIZE);
    const allResults = [];
    const langInstr = getLanguageInstruction(project.settings?.narrationLanguage);

    const formatShotForContext = (s) => {
        const scene = project.scenes.find(sc => sc.id === s.sceneId);
        const chars = (s.characterIds || []).map(cid => project.characters.find(c => c.id === cid)?.name).filter(Boolean);
        const props = (s.propIds || []).map(pid => project.props.find(p => p.id === pid)?.name).filter(Boolean);
        return `#${s.order} [scene: ${scene?.name || 'none'}] [chars: ${chars.join(', ') || 'none'}] [props: ${props.join(', ') || 'none'}] prompt: ${s.prompt} (${s.duration}s)`;
    };

    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const batchLabel = batches.length > 1 ? `[批次 ${bi + 1}/${batches.length}] ` : '';
        if (onChunk) onChunk(`${batchLabel}正在增强分镜 #${batch[0].order}-#${batch[batch.length - 1].order}...`);

        const batchShortsStr = batch.map(formatShotForContext).join('\n');

        let prompt = customPrompt || (fillPromptTemplate(getPrompt('enhanceShots', pp), {
            synopsis: project.synopsis || '',
            characters: formatCharsForPrompt(project),
            props: formatPropsForPrompt(project),
            scenes: formatScenesForPrompt(project),
            ...getStyleVars(project),
        }) + langInstr);

        // Include previously enhanced shots in the system prompt for continuity / consistency.
        // Do NOT re-output them — they are context only.
        if (allResults.length > 0) {
            const prevStr = allResults.map(s => {
                const order = s.order ?? '?';
                const scene = s.scene || s.sceneName || '';
                const chars = Array.isArray(s.characters) ? s.characters.join(', ')
                    : (Array.isArray(s.characterNames) ? s.characterNames.join(', ') : '');
                const props = Array.isArray(s.props) ? s.props.join(', ')
                    : (Array.isArray(s.propNames) ? s.propNames.join(', ') : '');
                const dur = s.duration != null ? ` (${s.duration}s)` : '';
                return `#${order} [scene: ${scene || 'none'}] [chars: ${chars || 'none'}] [props: ${props || 'none'}] prompt: ${s.prompt || ''}${dur}`;
            }).join('\n');
            prompt += `\n\n---\nPreviously enhanced shots (context only, DO NOT re-output them; use them to keep style, pacing, character actions, and visual continuity consistent):\n${prevStr}`;
        }

        const userMsg = `Here are the current shorts to enhance:\n\n${batchShortsStr}`;
        const result = await llmChatStream(prompt, userMsg, (text) => {
            if (onChunk) onChunk(`${batchLabel}${text}`);
        }, '增强分镜');
        if (result.shorts) allResults.push(...result.shorts);
    }
    return { shorts: allResults };
}

// ---- Pipeline: Preflight Check ----
export async function runPreflightAI(project, onChunk) {
    const pp = getProjectPromptPreset(project);
    await ensurePresetLoaded(pp);
    const langInstr = getLanguageInstruction(project.settings?.narrationLanguage);
    const prompt = fillPromptTemplate(getPrompt('preflightCheck', pp), {
        characters: formatCharsForPrompt(project),
        props: formatPropsForPrompt(project),
        scenes: formatScenesForPrompt(project),
        shorts: formatShortsForPrompt(project),
    }) + langInstr;
    return await llmChatStream(prompt, 'Please run the preflight check on all shots.', onChunk, '预检');
}

// ---- Pipeline: Consistency Review ----
export async function runConsistencyReview(project, onChunk) {
    const pp = getProjectPromptPreset(project);
    await ensurePresetLoaded(pp);
    const langInstr = getLanguageInstruction(project.settings?.narrationLanguage);
    const resultsStr = (project.shorts || []).map(s => {
        return `#${s.order} status:${s.status} prompt:"${(s.prompt || '').slice(0, 100)}" videoUrl:${s.videoUrl ? 'yes' : 'no'}`;
    }).join('\n');
    const prompt = fillPromptTemplate(getPrompt('consistencyReview', pp), {
        characters: formatCharsForPrompt(project),
        props: formatPropsForPrompt(project),
        scenes: formatScenesForPrompt(project),
        results: resultsStr,
    }) + langInstr;
    return await llmChatStream(prompt, 'Please review consistency of the generated results.', onChunk, '一致性审核');
}

// ---- Subtitle Generation ----
/**
 * Generate narration subtitles for a project's shorts.
 * Returns an array: [{ shortId, text }].
 * Mode 'narration': concise on-screen voice-over text per short.
 * Mode 'dialogue': extract spoken lines from the prompt (fallback when short.dialogue is empty).
 */
export async function generateSubtitles(project, mode = 'narration', onChunk) {
    const shorts = (project.shorts || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const shotList = shorts.map(s => ({
        id: s.id,
        order: s.order,
        duration: s.duration || 5,
        prompt: (s.prompt || '').slice(0, 400),
        dialogue: s.dialogue || '',
    }));
    const isNarration = mode !== 'dialogue';
    const systemPrompt = isNarration
        ? `You write concise on-screen narration subtitles for short film clips. ` +
          `For each clip, produce a single short narration line (旁白) that fits within the clip's duration ` +
          `(roughly 3-4 Chinese characters per second of duration; never exceed 60 characters). ` +
          `Narration should add atmosphere, context, or insight WITHOUT repeating spoken dialogue. ` +
          `If a clip already has dialogue baked in, write a complementary narration (or empty string to skip). ` +
          `Output ONLY a JSON array, no markdown, no commentary. Schema: ` +
          `[{"shortId": "<id>", "text": "<narration in same language as prompts>"}]`
        : `Extract concise spoken dialogue subtitles for each short film clip. ` +
          `If a clip already has a "dialogue" field, use it verbatim. Otherwise infer the most likely spoken line from the prompt, ` +
          `or return empty string if the clip has no spoken dialogue. ` +
          `Output ONLY a JSON array. Schema: [{"shortId": "<id>", "text": "<line>"}]`;
    const userMessage = `Project title: ${project.title || ''}\nSynopsis: ${(project.synopsis || '').slice(0, 600)}\n\nClips:\n${JSON.stringify(shotList, null, 2)}`;
    const result = await llmChatStream(systemPrompt, userMessage, onChunk, isNarration ? '生成旁白字幕' : '生成台词字幕');
    if (!Array.isArray(result)) throw new Error('LLM 未返回数组');
    return result.filter(r => r && r.shortId);
}

// ---- Seedance Video ----
export async function submitGenVideo(short, project) {
    const normalizeImageRefUrl = (rawUrl) => {
        const value = String(rawUrl || '').trim();
        if (!value) return '';
        if (value.startsWith('asset://')) return value;
        if (/^asset-[a-zA-Z0-9-]+$/.test(value)) return `asset://${value}`;
        return value;
    };

    const createImageRef = (url, role) => {
        const normalizedUrl = normalizeImageRefUrl(url);
        if (!normalizedUrl) return null;
        return {
            type: 'image_url',
            url: normalizedUrl,
            role,
        };
    };

    const images = [];

    // Seedance constraint: reference_image and keyframes (first_frame / last_frame) are
    // mutually exclusive. When any keyframe is set, skip all reference images.
    const useKeyframeMode = !!(short.firstFrameUrl || short.lastFrameUrl);

    // Track image-to-label mapping for prompt reference line
    const imageLabels = [];

    if (useKeyframeMode) {
        const firstFrame = createImageRef(short.firstFrameUrl, 'first_frame');
        const lastFrame = createImageRef(short.lastFrameUrl, 'last_frame');
        if (firstFrame) images.push(firstFrame);
        if (lastFrame) images.push(lastFrame);
    } else {
        const scene = project.scenes.find(s => s.id === short.sceneId);
        const sceneImage = createImageRef(scene?.imageUrl, 'reference_image');
        if (sceneImage) {
            images.push(sceneImage);
            imageLabels.push(scene?.name || '场景');
        }
        short.characterIds?.forEach(cid => {
            const ch = project.characters.find(c => c.id === cid);
            const imgUrl = (ch?.anchorVerified && ch?.anchorImageUrl) ? ch.anchorImageUrl : ch?.imageUrl;
            const imageRef = createImageRef(imgUrl, 'reference_image');
            if (imageRef) {
                images.push(imageRef);
                imageLabels.push(ch?.name || '角色');
            }
        });
        (short.propIds || []).forEach(pid => {
            const pr = project.props.find(p => p.id === pid);
            const imgUrl = (pr?.anchorVerified && pr?.anchorImageUrl) ? pr.anchorImageUrl : pr?.imageUrl;
            const imageRef = createImageRef(imgUrl, 'reference_image');
            if (imageRef) {
                images.push(imageRef);
                imageLabels.push(pr?.name || '道具');
            }
        });
        if (short.imageUrls) {
            short.imageUrls.forEach(u => {
                const imageRef = createImageRef(u, 'reference_image');
                if (imageRef) images.push(imageRef);
            });
        }
    }

    // Build enhanced prompt with cinematography metadata
    let prompt = short.prompt || '';

    // Append reference image mapping so the model knows which image is which
    if (imageLabels.length > 0) {
        const refLine = '参考图：' + imageLabels.map((label, i) => `${label}(图片${i + 1})`).join(', ');
        if (!prompt.includes('参考图：')) {
            prompt = prompt ? `${prompt}\n${refLine}` : refLine;
        }
    }
    if (short.enhanced && short.cameraMovement) {
        const metaParts = [];
        if (short.cameraMovement) metaParts.push(`camera ${short.cameraMovement}`);
        if (short.lighting) metaParts.push(`lighting: ${short.lighting}`);
        // Only append if not already present in prompt
        const metaStr = metaParts.join(', ');
        const preset = getStylePreset(project.settings?.stylePreset);
        const styleSuffix = preset.value === 'custom'
            ? (project.settings?.customStyleSuffix || '')
            : (preset.promptSuffix || '');
        if (metaStr && !prompt.includes(metaStr)) {
            prompt = styleSuffix
                ? `${prompt}, ${metaStr}, ${styleSuffix}`
                : `${prompt}, ${metaStr}`;
        }
    }

    // Append actor dialogue so the video model bakes spoken audio into the clip.
    // The same text is mirrored to the dialogue subtitle track in the clip editor.
    if (short.dialogue && short.dialogue.trim()) {
        const line = short.dialogue.trim();
        if (!prompt.includes(line)) {
            prompt = prompt
                ? `${prompt}\n角色台词 (Actor speaks aloud, lip-synced): "${line}"`
                : `角色台词 (Actor speaks aloud, lip-synced): "${line}"`;
        }
    }

    // Build videos array (video-to-video reference)
    syncShortReferenceVideoUrl(project, short);
    const videos = [];
    if (short.referenceVideoUrl) {
        videos.push({ url: short.referenceVideoUrl, role: 'reference_video' });
    }

    // Build audios array
    const audios = (short.audioUrls || []).filter(Boolean).map(u => ({ url: u, role: 'reference_audio' }));

    const body = {
        prompt,
        images: images.length > 0 ? images : undefined,
        videos: videos.length > 0 ? videos : undefined,
        audios: audios.length > 0 ? audios : undefined,
        resolution: project.settings.resolution || '720p',
        ratio: short.ratio || project.settings.ratio,
        duration: (() => {
            const d = parseInt(short.duration || project.settings.defaultDuration);
            if (d === -1) return -1;
            return Math.max(CONFIG.CLIP_DURATION_MIN, Math.min(CONFIG.CLIP_DURATION_MAX, d));
        })(),
        model: short.modelOverride || project.settings.model,
        generateAudio: short.generateAudioOverride ?? project.settings.generateAudio,
        watermark: short.watermark || false,
    };

    let taskId;
    try {
        taskId = await sdk.aiGenerators.genVideo(body.prompt, {
            model: body.model,
            duration: body.duration,
            resolution: body.resolution,
            ratio: body.ratio,
            generateAudio: body.generateAudio,
            watermark: body.watermark,
            images: body.images,
            videos: body.videos,
            audios: body.audios,
        });
        recordVideoCall({ label: '生成视频', model: body.model, duration: body.duration, success: true });
    } catch (err) {
        recordVideoCall({ label: '生成视频', model: body.model, duration: body.duration, success: false, error: err.message });
        throw err;
    }
    // Record video gen task submission
    const proj = state.currentProject;
    if (proj) {
        if (!proj.videoGenUsage) proj.videoGenUsage = { totalTasks: 0, succeededTasks: 0, failedTasks: 0, totalDuration: 0, details: [] };
        proj.videoGenUsage.totalTasks++;
        proj.videoGenUsage.details.push({
            taskId: taskId,
            shortId: short.id,
            model: body.model,
            duration: body.duration,
            ratio: body.ratio,
            submittedAt: new Date().toISOString(),
            status: 'running',
            usage: null,
        });
    }
    return taskId;
}

/**
 * Submit multiple parallel video generation tasks for the same shot with different settings.
 * Each variant overrides specific fields (model, duration, ratio, generateAudio, watermark).
 * Returns an array of { variantIndex, taskId, settings } for each successfully submitted variant.
 */
export async function submitParallelGenVideo(short, project, variants) {
    const results = [];
    for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        // Create a temporary shallow copy of the short with overridden settings
        const overriddenShort = {
            ...short,
            modelOverride: v.model || short.modelOverride,
            duration: v.duration || short.duration,
            ratio: v.ratio || short.ratio,
            generateAudioOverride: v.generateAudio ?? short.generateAudioOverride,
            watermark: v.watermark ?? short.watermark,
        };
        // Also temporarily override project settings used by submitGenVideo
        const overriddenProject = {
            ...project,
            settings: {
                ...project.settings,
                model: v.model || project.settings.model,
                defaultDuration: v.duration || project.settings.defaultDuration,
                ratio: v.ratio || project.settings.ratio,
                generateAudio: v.generateAudio ?? project.settings.generateAudio,
            },
        };
        try {
            const taskId = await submitGenVideo(overriddenShort, overriddenProject);
            results.push({
                variantIndex: i,
                taskId,
                settings: {
                    model: overriddenShort.modelOverride || overriddenProject.settings.model,
                    duration: overriddenShort.duration || overriddenProject.settings.defaultDuration,
                    ratio: overriddenShort.ratio || overriddenProject.settings.ratio,
                    generateAudio: overriddenShort.generateAudioOverride ?? overriddenProject.settings.generateAudio,
                    watermark: overriddenShort.watermark || false,
                },
                status: 'running',
                error: null,
                videoUrl: null,
                createdAt: new Date().toISOString(),
            });
        } catch (err) {
            results.push({
                variantIndex: i,
                taskId: null,
                settings: {
                    model: v.model || project.settings.model,
                    duration: v.duration || project.settings.defaultDuration,
                    ratio: v.ratio || project.settings.ratio,
                    generateAudio: v.generateAudio ?? project.settings.generateAudio,
                    watermark: v.watermark ?? false,
                },
                status: 'failed',
                error: err.message,
                videoUrl: null,
                createdAt: new Date().toISOString(),
            });
        }
    }
    return results;
}

// ---- Polling ----

/** Find a parallel task by taskId across all shorts */
function findParallelTask(proj, taskId) {
    for (const short of proj.shorts) {
        const task = (short.parallelTasks || []).find(t => t.taskId === taskId);
        if (task) return { short, task };
    }
    return null;
}

export function startPolling(taskId, projectId, onUpdate) {
    if (state.pollingIntervals[taskId]) return;
    const poll = async () => {
        try {
            const proj = state.currentProject?.id === projectId ? state.currentProject : null;
            if (!proj) { stopPolling(taskId); return; }
            const short = proj.shorts.find(s => s.taskId === taskId);
            // Resolve model from usage details or short/project settings for apiKey passthrough
            const usageDetail = proj.videoGenUsage?.details?.find(d => d.taskId === taskId);
            const pollModel = usageDetail?.model || short?.modelOverride || proj.settings?.model;
            const data = await sdk.aiGenerators.getVideoTaskStatus(taskId, { model: pollModel });
            // Check if this taskId belongs to a parallel task
            const parallelMatch = !short ? findParallelTask(proj, taskId) : null;
            if (!short && !parallelMatch) { stopPolling(taskId); return; }

            if (parallelMatch) {
                // Handle parallel task polling
                const { short: pShort, task: pTask } = parallelMatch;
                pTask.status = data.status;
                if (data.status === 'succeeded') {
                    pTask.videoUrl = data.videoUrl;
                    // Add to candidates with settings metadata
                    if (!pShort.videoCandidates) pShort.videoCandidates = [];
                    if (!pShort.videoCandidates.some(c => c.url === data.videoUrl)) {
                        pShort.videoCandidates.push({
                            url: data.videoUrl,
                            path: null,
                            sourceUrl: data.videoUrl,
                            createdAt: new Date().toISOString(),
                            settings: { ...pTask.settings },
                            parallelTaskId: taskId,
                        });
                    }
                    // If this is the first completed parallel result, set it as active
                    if (!pShort.videoUrl) {
                        pShort.videoUrl = data.videoUrl;
                        pShort.sourceVideoUrl = data.videoUrl;
                        pShort.status = 'succeeded';
                        syncReferenceVideoDependents(proj, pShort.id);
                    }
                    // Record usage
                    if (proj.videoGenUsage) {
                        proj.videoGenUsage.succeededTasks++;
                        const detail = proj.videoGenUsage.details.find(d => d.taskId === taskId);
                        if (detail) {
                            detail.status = 'succeeded';
                            detail.completedAt = new Date().toISOString();
                            detail.usage = data.usage || detail.usage;
                            detail.actualDuration = data.duration || detail.duration;
                        }
                        proj.videoGenUsage.totalDuration += (data.duration || pTask.settings?.duration || 0);
                    }
                    stopPolling(taskId);
                    updateTaskLogEntry(proj, taskId, { status: 'succeeded', videoUrl: data.videoUrl });
                    saveAssetToLocal(proj, data.videoUrl, 'videos', `shot_${pShort.order}_p${pTask.variantIndex}_video.mp4`).catch(() => {});
                    // Check if all parallel tasks done
                    const allDone = pShort.parallelTasks.every(t => t.status === 'succeeded' || t.status === 'failed');
                    const succeededCount = pShort.parallelTasks.filter(t => t.status === 'succeeded').length;
                    if (allDone) {
                        showToast(`短片 #${pShort.order} 并行生成完成 (${succeededCount}/${pShort.parallelTasks.length} 成功)`, succeededCount > 0 ? 'success' : 'error');
                        if (pShort.status !== 'succeeded') pShort.status = succeededCount > 0 ? 'succeeded' : 'failed';
                    } else {
                        showToast(`短片 #${pShort.order} 变体 ${pTask.variantIndex + 1} 生成完成`, 'success');
                    }
                    if (onUpdate) await onUpdate(proj, pShort);
                } else if (data.status === 'failed') {
                    pTask.error = data.error?.message || '生成失败';
                    if (proj.videoGenUsage) {
                        proj.videoGenUsage.failedTasks++;
                        const detail = proj.videoGenUsage.details.find(d => d.taskId === taskId);
                        if (detail) { detail.status = 'failed'; detail.completedAt = new Date().toISOString(); detail.error = pTask.error; }
                    }
                    stopPolling(taskId);
                    updateTaskLogEntry(proj, taskId, { status: 'failed', error: pTask.error });
                    const allDone = pShort.parallelTasks.every(t => t.status === 'succeeded' || t.status === 'failed');
                    const succeededCount = pShort.parallelTasks.filter(t => t.status === 'succeeded').length;
                    if (allDone) {
                        showToast(`短片 #${pShort.order} 并行生成完成 (${succeededCount}/${pShort.parallelTasks.length} 成功)`, succeededCount > 0 ? 'success' : 'error');
                        if (pShort.status !== 'succeeded') pShort.status = succeededCount > 0 ? 'succeeded' : 'failed';
                    } else {
                        showToast(`短片 #${pShort.order} 变体 ${pTask.variantIndex + 1} 生成失败`, 'error');
                    }
                    if (onUpdate) await onUpdate(proj, pShort);
                }
                return; // handled parallel task, skip normal flow
            }

            short.status = data.status;
            if (data.status === 'succeeded') {
                short.videoUrl = data.videoUrl;
                short.sourceVideoUrl = data.videoUrl;
                syncReferenceVideoDependents(proj, short.id);
                // Save as candidate
                if (!short.videoCandidates) short.videoCandidates = [];
                if (!short.videoCandidates.some(c => c.url === data.videoUrl)) {
                    short.videoCandidates.push({
                        url: data.videoUrl,
                        path: null,
                        sourceUrl: data.videoUrl,
                        createdAt: new Date().toISOString(),
                    });
                }
                // Record token usage on success
                if (proj.videoGenUsage) {
                    proj.videoGenUsage.succeededTasks++;
                    const detail = proj.videoGenUsage.details.find(d => d.taskId === taskId);
                    if (detail) {
                        detail.status = 'succeeded';
                        detail.completedAt = new Date().toISOString();
                        detail.usage = data.usage || detail.usage;
                        detail.actualDuration = data.duration || detail.duration;
                    }
                    proj.videoGenUsage.totalDuration += (data.duration || short.duration || 0);
                }
                stopPolling(taskId);
                updateTaskLogEntry(proj, taskId, { status: 'succeeded', videoUrl: data.videoUrl });
                // Save to local disk if in local mode
                saveAssetToLocal(proj, data.videoUrl, 'videos', `shot_${short.order}_video.mp4`).catch(() => {});
                showToast(`短片 #${short.order} 生成完成！`, 'success');
                if (onUpdate) await onUpdate(proj, short);
            } else if (data.status === 'failed') {
                short.error = data.error?.message || '生成失败';
                // Record failure in usage tracking
                if (proj.videoGenUsage) {
                    proj.videoGenUsage.failedTasks++;
                    const detail = proj.videoGenUsage.details.find(d => d.taskId === taskId);
                    if (detail) {
                        detail.status = 'failed';
                        detail.completedAt = new Date().toISOString();
                        detail.error = short.error;
                    }
                }
                stopPolling(taskId);
                updateTaskLogEntry(proj, taskId, { status: 'failed', error: short.error });
                showToast(`短片 #${short.order} 生成失败`, 'error');
                if (onUpdate) await onUpdate(proj, short);
            }
        } catch (e) { console.error('Polling error:', e); }
    };
    poll();
    state.pollingIntervals[taskId] = setInterval(poll, 10000);
}

export function stopPolling(taskId) {
    if (state.pollingIntervals[taskId]) {
        clearInterval(state.pollingIntervals[taskId]);
        delete state.pollingIntervals[taskId];
    }
}

// ---- AI Image Generation (via Keepwork genImage API) ----

/**
 * Generate an image using Keepwork genImage API.
 * Mirrors MapCopilot.generateImage pattern.
 * @param {string} prompt - Image description
 * @param {Object} [options] - { width, height, provider, model, compressionRatio, images }
 * @returns {Promise<string|null>} Generated image URL
 */
export async function genImage(prompt, options = {}) {
    const {
        width = 2048,
        height = 2048,
        provider,
        model,
        compressionRatio = 10,
        images,
    } = options;

    // Fall back to the globally-configured image model when caller does not specify one.
    let effectiveModel = model;
    if (!effectiveModel) {
        try {
            const { getGlobalImageModel } = await import('./global_settings.js');
            effectiveModel = getGlobalImageModel() || undefined;
        } catch (_) { /* ignore */ }
    }

    const t0 = Date.now();
    try {
        const url = await sdk.aiGenerators.genImage(prompt, {
            width, height, provider, model: effectiveModel, compressionRatio, images,
        });
        recordImageCall({ label: '生成图片', model: effectiveModel || '', success: true, durationMs: Date.now() - t0 });
        return url;
    } catch (err) {
        recordImageCall({ label: '生成图片', model: effectiveModel || '', success: false, error: err.message, durationMs: Date.now() - t0 });
        throw err;
    }
}

/**
 * Build a style instruction string from the project's style preset for image generation prompts.
 */
function getImageStyleInstruction(project) {
    const preset = getStylePreset(project?.settings?.stylePreset);
    let style = preset.value === 'custom'
        ? (project?.settings?.customStyleSuffix || '')
        : (preset.promptSuffix || '');

    // Append env and race hints for image generation
    const envPreset = getEnvPreset(project?.settings?.envPreset);
    const envHint = envPreset.value === 'custom'
        ? (project?.settings?.customEnvSuffix || '')
        : (envPreset.promptHint || '');
    const racePreset = getRacePreset(project?.settings?.racePreset);
    const raceHint = racePreset.value === 'custom'
        ? (project?.settings?.customRaceSuffix || '')
        : (racePreset.promptHint || '');

    if (envHint) style += (style ? ', ' : '') + envHint;
    if (raceHint) style += (style ? ', ' : '') + raceHint;
    return style;
}

/**
 * Generate a character reference image using the project's style preset.
 * @param {string} characterDescription - Character visual description
 * @param {object} [project] - Project object (used for style preset)
 * @returns {Promise<string|null>} Image URL
 */
export async function generateCharacterImage(characterDescription, project) {
    const style = getImageStyleInstruction(project);
    const prompt = style
        ? `生成精致的人物形象,${style},人物尽量占满,除了角色外背景为纯白色,生成完整的半身像(腰以上)。角色描述：${characterDescription}`
        : `生成写实的,精致的,2D动漫风格的人物形象,人物尽量占满,除了角色外背景为纯白色,生成完整的半身像(腰以上)。角色描述：${characterDescription}`;
    return genImage(prompt);
}

/**
 * Generate a prop reference image using the project's style preset.
 * @param {string} propDescription - Prop visual description
 * @param {object} [project] - Project object (used for style preset)
 * @returns {Promise<string|null>} Image URL
 */
export async function generatePropImage(propDescription, project) {
    const style = getImageStyleInstruction(project);
    const prompt = style
        ? `生成精致的道具物品图片,${style},物品尽量占满画面,背景为纯白色,展示完整的物品细节。道具描述：${propDescription}`
        : `生成精致的道具物品图片,物品尽量占满画面,背景为纯白色,展示完整的物品细节。道具描述：${propDescription}`;
    return genImage(prompt);
}

/**
 * Generate a scene reference image using the project's style preset.
 * @param {string} sceneDescription - Scene/setting description
 * @param {object} [project] - Project object (used for style preset)
 * @returns {Promise<string|null>} Image URL
 */
export async function generateSceneImage(sceneDescription, project) {
    const style = getImageStyleInstruction(project);
    const prompt = style
        ? `生成场景图片,${style},镜头尽量在适合拍照打卡的角度,不要有人物,Image should NOT include human, just scene。场景描述：${sceneDescription}`
        : `生成著名场景的图片：使用超级写实风格，镜头尽量在适合拍照打卡的角度，*不要*有人物， Image should NOT include human, just scene。场景描述：${sceneDescription}`;
    return genImage(prompt);
}

/**
 * Generate a picturebook (绘本) image for a shot.
 * Combines scene, character and prompt info into a single static illustration.
 * @param {Object} short - Shot object
 * @param {Object} project - Project object
 * @returns {Promise<string|null>} Image URL
 */
export async function generateShotPicturebookImage(short, project) {
    const style = getImageStyleInstruction(project);
    const ratio = short.ratio || project.settings.ratio || '16:9';

    const [w, h] = [2048, 2048];
    // Include ratio hint in the prompt for composition guidance
    const ratioHint = ratio === '9:16' ? '竖幅构图(9:16)' : ratio === '1:1' ? '方形构图(1:1)' : '宽幅构图(16:9)';

    // Collect reference images from scene, characters, props, and extra images
    const images = [];
    const scene = project.scenes.find(s => s.id === short.sceneId);
    if (scene?.imageUrl) images.push({ url: scene.imageUrl, role: 'reference_image' });
    (short.characterIds || []).forEach(cid => {
        const ch = project.characters.find(c => c.id === cid);
        const imgUrl = (ch?.anchorVerified && ch?.anchorImageUrl) ? ch.anchorImageUrl : ch?.imageUrl;
        if (imgUrl) images.push({ url: imgUrl, role: 'reference_image' });
    });
    (short.propIds || []).forEach(pid => {
        const pr = project.props.find(p => p.id === pid);
        const imgUrl = (pr?.anchorVerified && pr?.anchorImageUrl) ? pr.anchorImageUrl : pr?.imageUrl;
        if (imgUrl) images.push({ url: imgUrl, role: 'reference_image' });
    });
    if (short.imageUrls) short.imageUrls.forEach(u => images.push({ url: u, role: 'reference_image' }));

    // Build context from scene + characters
    const parts = [];
    if (scene?.description) parts.push(`场景：${scene.description}`);
    (short.characterIds || []).forEach(cid => {
        const ch = project.characters.find(c => c.id === cid);
        if (ch) parts.push(`角色 ${ch.name}：${ch.description || ''}`);
    });
    if (short.lighting) parts.push(`灯光：${short.lighting}`);
    if (short.emotion) parts.push(`情绪：${short.emotion}`);

    const context = parts.length > 0 ? parts.join('；') + '。' : '';
    const shotPrompt = short.prompt || '';

    const prompt = style
        ? `生成绘本风格的插画,${style},${ratioHint},画面精美细腻,适合作为故事绘本的一页。${context}画面描述：${shotPrompt}`
        : `生成精美的绘本风格插画,${ratioHint},画面精美细腻,适合作为故事绘本的一页。${context}画面描述：${shotPrompt}`;

    return genImage(prompt, { width: w, height: h, images: images.length > 0 ? images : undefined });
}
