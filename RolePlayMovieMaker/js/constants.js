// ============ Constants ============
// localStorage keys, default model lists, response schema, project metadata.

export const LS_KEY = 'videoParser.settings.v1';
export const LS_UPLOADS = 'videoParser.uploads.v1';
export const LS_KW_UPLOADS = 'videoParser.kwUploads.v1';
export const LS_LAST_PROJECT = 'videoParser.lastProject.v1';

/* Known model lists. Custom values can override via the "custom" input field. */
export const DEFAULT_GOOGLE_MODELS = [
  'gemini-3-pro-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];
export const DEFAULT_OPENROUTER_MODELS = [
  'google/gemini-3.1-pro-preview',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.0-flash-001',
];

/* Project storage */
export const PROJECT_WORKSPACE = 'videoParser';
export const PROJECT_FILE_SUFFIX = '.md';
export const PROJECT_FORMAT = 'videoParser';
export const PROJECT_VERSION = 1;
export const REMOTE_STORE_PATH = 'edunotes/store';

/* Keepwork SDK CDN */
export const KEEPWORK_SDK_CDN_URL = 'https://cdn.keepwork.com/sdk/keepworkSDK.iife.js?v=20260501';

/* Gemini structured-output schema. */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    videoLength: { type: 'string', description: 'Total video length as "MM:SS,mmm" (or "HH:MM:SS,mmm").' },
    language: { type: 'string', description: 'Primary spoken language (e.g. "en", "zh").' },
    summary: { type: 'string', description: 'One concise paragraph summarizing the whole video.' },
    characters: {
      type: 'array',
      description: 'Cast of main / recurring characters that appear in the video.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short stable lowercase identifier referenced from clips/subtitles.' },
          name: { type: 'string', description: 'Display name or descriptive role label.' },
          gender: { type: 'string', description: '"male", "female", "non-binary", or "unknown".' },
          age: { type: 'string', description: 'Short age description (e.g. "child", "20s", "60+", "unknown").' },
          description: { type: 'string', description: 'One short sentence covering appearance, role, and defining traits.' },
        },
        required: ['id', 'name', 'gender', 'age', 'description'],
        propertyOrdering: ['id', 'name', 'gender', 'age', 'description'],
      },
    },
    shortClips: {
      type: 'array',
      description: 'Video segmented into consecutive shot/scene clips covering the full duration.',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'Clip start time as "MM:SS,mmm" (or "HH:MM:SS,mmm").' },
          end: { type: 'string', description: 'Clip end time as "MM:SS,mmm" (or "HH:MM:SS,mmm").' },
          characters: {
            type: 'array',
            description: 'Character ids present on-screen or speaking in this clip.',
            items: { type: 'string' },
          },
          scene: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'What is visually happening on screen during this clip.' },
              on_screen_text: { type: 'string', description: 'Visible on-screen text/captions/titles. Empty string if none.' },
            },
            required: ['description', 'on_screen_text'],
            propertyOrdering: ['description', 'on_screen_text'],
          },
          subtitles: {
            type: 'array',
            description: 'Spoken utterances during this clip.',
            items: {
              type: 'object',
              properties: {
                start: { type: 'string', description: 'Subtitle start time within the clip.' },
                end: { type: 'string', description: 'Subtitle end time within the clip.' },
                speaker: { type: 'string', description: 'Speaking character id, or "" if unknown.' },
                text: { type: 'string', description: 'Transcribed speech for this segment.' },
              },
              required: ['start', 'end', 'speaker', 'text'],
              propertyOrdering: ['start', 'end', 'speaker', 'text'],
            },
          },
        },
        required: ['start', 'end', 'characters', 'scene', 'subtitles'],
        propertyOrdering: ['start', 'end', 'characters', 'scene', 'subtitles'],
      },
    },
  },
  required: ['videoLength', 'language', 'summary', 'characters', 'shortClips'],
  propertyOrdering: ['videoLength', 'language', 'summary', 'characters', 'shortClips'],
};
