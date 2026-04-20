// ============ Constants & Configuration ============

export { PROMPTS, PROMPT_PRESETS, getPrompt, getPromptTaskNames, getPromptPresetOptions } from './prompts.js';

export const CONFIG = {
    REMOTE_PAGE: 'aiMovieMaker',
    PROJECT_WORKSPACE: 'AIMovieMaker',
    PROJECT_FILE_SUFFIX: '.aimovie.md',
    STORAGE_BASE: 'https://api.keepwork.com/ts-storage',
    QINIU_TEMP_URL: 'https://qiniu-public-temporary.keepwork.com',
    QINIU_UPLOAD_URL: 'https://up-z2.qiniup.com',
    QINIU_TEMP_VIDEO_URL: 'https://tempvision.keepwork.com',
    QINIU_UPLOAD_VIDEO_URL: 'https://up-z0.qiniup.com',
    MODELS: {
        'seedance-2.0': 'ep-20260409105722-x6jsk',
        'seedance-2.0-fast': 'ep-20260409104905-4gvcs',
    },
    RESOLUTIONS: ['480p', '720p', '1080p'],
    RATIOS: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    CLIP_DURATIONS: [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    CLIP_DURATION_MIN: 4,
    CLIP_DURATION_MAX: 15,
    MAX_SHORTS: 50,
    MAX_CONCURRENT: 2,
    MIN_DURATION: 1,
    MAX_DURATION: 90,
    DEFAULT_TOTAL_DURATION: 3,
    LANGUAGES: [
        { value: 'zh', label: '中文' },
        { value: 'en', label: 'English' },
        { value: 'ja', label: '日本語' },
        { value: 'ko', label: '한국어' },
        { value: 'fr', label: 'Français' },
        { value: 'es', label: 'Español' },
        { value: 'de', label: 'Deutsch' },
    ],
    ENV_PRESETS: [
        { value: '', label: '不限' },
        { value: 'ancient', label: '古代', promptHint: 'ancient era, historical architecture, traditional clothing, pre-industrial', llmHint: 'Setting era: ancient / historical (before ~500 AD). Architecture, clothing, and technology should match.' },
        { value: 'medieval', label: '中世纪', promptHint: 'medieval era, castles, armor, cobblestone streets, torches', llmHint: 'Setting era: medieval (~500-1500 AD). Castles, knights, feudal towns.' },
        { value: 'early-modern', label: '近代', promptHint: 'early modern era, 18th-19th century, industrial revolution, Victorian style', llmHint: 'Setting era: early modern / Victorian (~1700-1900). Steam technology, formal attire, gas lamps.' },
        { value: 'modern', label: '现代', promptHint: 'modern day, contemporary setting, current technology, urban environment', llmHint: 'Setting era: modern / contemporary. Current-day technology, clothing, and urban/suburban environments.' },
        { value: 'near-future', label: '近未来', promptHint: 'near future, advanced technology, sleek architecture, holographic displays', llmHint: 'Setting era: near future (~2040-2100). Advanced but recognizable technology, smart cities.' },
        { value: 'far-future', label: '远未来', promptHint: 'far future sci-fi, space-age, cybernetic, alien worlds, neon megacity', llmHint: 'Setting era: far future / sci-fi. Space travel, cybernetics, alien worlds, megacities.' },
        { value: 'fantasy', label: '奇幻', promptHint: 'fantasy world, magic, mythical creatures, enchanted landscapes', llmHint: 'Setting: fantasy world with magic, mythical creatures, and enchanted environments. Not tied to real-world era.' },
        { value: 'post-apocalyptic', label: '末日废土', promptHint: 'post-apocalyptic, ruins, overgrown vegetation, survival gear, desolate', llmHint: 'Setting: post-apocalyptic wasteland. Ruined structures, survival gear, desolate atmosphere.' },
        { value: 'custom', label: '自定义', promptHint: '', llmHint: '' },
    ],
    RACE_PRESETS: [
        { value: '', label: '不限' },
        { value: 'east-asian', label: '东亚人', promptHint: 'East Asian ethnicity', llmHint: 'Default character ethnicity: East Asian. Characters should have East Asian facial features unless explicitly specified otherwise.' },
        { value: 'southeast-asian', label: '东南亚人', promptHint: 'Southeast Asian ethnicity', llmHint: 'Default character ethnicity: Southeast Asian.' },
        { value: 'south-asian', label: '南亚人', promptHint: 'South Asian ethnicity', llmHint: 'Default character ethnicity: South Asian (Indian subcontinent features).' },
        { value: 'black', label: '黑人', promptHint: 'Black / African ethnicity', llmHint: 'Default character ethnicity: Black / African descent.' },
        { value: 'white', label: '白人', promptHint: 'White / Caucasian ethnicity', llmHint: 'Default character ethnicity: White / Caucasian.' },
        { value: 'latino', label: '拉丁裔', promptHint: 'Latino / Hispanic ethnicity', llmHint: 'Default character ethnicity: Latino / Hispanic.' },
        { value: 'middle-eastern', label: '中东人', promptHint: 'Middle Eastern ethnicity', llmHint: 'Default character ethnicity: Middle Eastern.' },
        { value: 'mixed', label: '混血/多元', promptHint: 'diverse mixed ethnicities', llmHint: 'Characters should have diverse / mixed ethnicities unless explicitly specified.' },
        { value: 'custom', label: '自定义', promptHint: '', llmHint: '' },
    ],
    STYLE_PRESETS: [
        {
            value: '3d-semirealistic',
            label: '3D 半写实',
            promptSuffix: '3D semi-realistic UE5 style, avoid jitter, avoid bent limbs, avoid identity drift',
            llmStyleNote: 'Style: 3D semi-realistic (UE5/FF7R quality), skin pores visible, hair strands, fabric textures\nForbidden styles: cartoon, chibi, cel-shaded, anime flat coloring',
            llmStyleKeywords: '3D semi-realistic UE5 quality',
        },
        {
            value: 'hyper-realistic-cgi',
            label: '超写实 CGI',
            promptSuffix: 'hyper-realistic CGI, 3D character, skin texture with visible pores, subsurface scattering, studio lighting, photorealistic hair strands, fabric micro-detail, avoid jitter, avoid bent limbs, avoid identity drift',
            llmStyleNote: 'Style: hyper-realistic CGI / 3D character with photorealistic skin texture, visible pores, subsurface scattering, studio lighting, photorealistic hair strands, fabric micro-detail\nForbidden styles: cartoon, chibi, cel-shaded, anime flat coloring, painterly',
            llmStyleKeywords: 'hyper-realistic CGI, 3D character, skin pores, studio lighting',
        },
        {
            value: 'photorealistic',
            label: '超级写实',
            promptSuffix: 'photorealistic live-action, 3D character, cinematic film grain, skin pores and blemishes, natural studio lighting, shallow depth of field, anamorphic lens, avoid jitter, avoid bent limbs, avoid identity drift',
            llmStyleNote: 'Style: photorealistic live-action quality, 3D character with cinematic film grain, skin pores and blemishes visible, natural studio lighting, shallow depth of field, anamorphic lens bokeh\nForbidden styles: cartoon, chibi, cel-shaded, anime flat coloring, painterly, low-poly',
            llmStyleKeywords: 'photorealistic live-action, 3D character, skin pores, studio lighting, cinematic',
        },
        {
            value: '2d-anime',
            label: '2D 动画',
            promptSuffix: '2D anime style, cel-shaded, clean line art, vibrant flat colors, anime aesthetics, avoid 3D rendering, avoid photorealism',
            llmStyleNote: 'Style: 2D anime / cel-shaded with clean line art, vibrant flat colors, anime aesthetics\nForbidden styles: 3D, photorealistic, CGI, live-action',
            llmStyleKeywords: '2D anime cel-shaded clean line art',
        },
        {
            value: 'custom',
            label: '自定义',
            promptSuffix: '',
            llmStyleNote: '',
            llmStyleKeywords: '',
        },
    ],
};

export function getLanguageInstruction(langCode) {
    const lang = CONFIG.LANGUAGES.find(l => l.value === langCode);
    const langName = lang ? lang.label : '中文';
    if (langCode === 'en') return '';
    return `\n\nIMPORTANT: All text content (title, synopsis, character names, scene names, descriptions, prompts, narration, etc.) MUST be written in ${langName} (${langCode}). Only cinematography/style keywords may remain in English.`;
}

export function getStylePreset(presetValue) {
    return CONFIG.STYLE_PRESETS.find(p => p.value === presetValue) || CONFIG.STYLE_PRESETS[0];
}

export function getEnvPreset(presetValue) {
    return CONFIG.ENV_PRESETS.find(p => p.value === presetValue) || CONFIG.ENV_PRESETS[0];
}

export function getRacePreset(presetValue) {
    return CONFIG.RACE_PRESETS.find(p => p.value === presetValue) || CONFIG.RACE_PRESETS[0];
}
