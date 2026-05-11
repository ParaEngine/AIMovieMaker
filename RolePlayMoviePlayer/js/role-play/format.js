// =================== Role-Play Movie — videoParser JSON normalizer ===================

/**
 * Parse a "MM:SS,mmm" or "HH:MM:SS,mmm" timestamp string to milliseconds.
 * Tolerates "MM:SS.mmm" and pure numeric strings (already ms).
 * @param {string|number} ts
 * @returns {number} milliseconds
 */
export function parseTimestamp(ts) {
  if (ts == null) return 0;
  if (typeof ts === 'number') return Math.max(0, ts | 0);
  const s = String(ts).trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);

  // Split optional millisecond part by "," or "."
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?[,\.](\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = m[3] != null ? Number(m[3]) : null;
    const ms = Number((m[4] || '0').padEnd(3, '0').slice(0, 3));
    if (c != null) return ((a * 60 + b) * 60 + c) * 1000 + ms;
    return (a * 60 + b) * 1000 + ms;
  }
  // Without ms part
  const m2 = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m2) {
    const a = Number(m2[1]);
    const b = Number(m2[2]);
    const c = m2[3] != null ? Number(m2[3]) : null;
    if (c != null) return ((a * 60 + b) * 60 + c) * 1000;
    return (a * 60 + b) * 1000;
  }
  return 0;
}

/**
 * Format milliseconds back to "MM:SS" for UI display.
 * @param {number} ms
 */
export function formatTime(ms) {
  ms = Math.max(0, ms | 0);
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * @typedef {Object} RpCharacter
 * @property {string} id
 * @property {string} name
 * @property {string} [gender]
 * @property {string} [age]
 * @property {string} [description]
 */

/**
 * @typedef {Object} RpTrack
 * @property {string} id
 * @property {number} startMs
 * @property {number} endMs
 * @property {string} speakerId   // character id; '' if none
 * @property {string} targetText  // line to dub
 * @property {string} clipId
 */

/**
 * @typedef {Object} MovieConfig
 * @property {string} title
 * @property {string} videoUrl
 * @property {string} [posterUrl]
 * @property {string} [language]
 * @property {string} [summary]
 * @property {number} [videoLengthMs]
 * @property {RpCharacter[]} characters
 * @property {Map<string, RpCharacter>} characterById
 * @property {RpTrack[]} tracks
 * @property {Object} raw    // original JSON
 */

/**
 * Normalize a videoParser-format JSON into our internal MovieConfig.
 * Tolerant: missing fields default to empty.
 * @param {Object} raw
 * @param {Object} [opts] - { title?: string, videoUrl?: string }
 * @returns {MovieConfig}
 */
export function normalizeMovie(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid movie file: not an object');
  }
  const characters = Array.isArray(raw.characters) ? raw.characters.map(normalizeChar).filter(c => c.id) : [];
  const characterById = new Map(characters.map(c => [c.id, c]));

  const tracks = [];
  const clips = Array.isArray(raw.shortClips) ? raw.shortClips : [];
  let trackSeq = 0;
  let hasOtherSpeaker = false;
  const OTHER_ID = '__other__';
  for (let ci = 0; ci < clips.length; ci++) {
    const clip = clips[ci] || {};
    const clipId = `clip_${ci}`;
    const subs = Array.isArray(clip.subtitles) ? clip.subtitles : [];
    for (const sub of subs) {
      if (!sub) continue;
      const startMs = parseTimestamp(sub.start);
      const endMs = parseTimestamp(sub.end);
      const text = String(sub.text || '').trim();
      if (!text || endMs <= startMs) continue;
      const rawSpeaker = String(sub.speaker || '').trim();
      let speakerId;
      if (rawSpeaker && characterById.has(rawSpeaker)) {
        speakerId = rawSpeaker;
      } else if (rawSpeaker) {
        // Unknown speaker id — keep as-is so it groups with itself
        speakerId = rawSpeaker;
      } else {
        // Empty speaker → "其它"
        speakerId = OTHER_ID;
        hasOtherSpeaker = true;
      }
      tracks.push({
        id: `t_${trackSeq++}`,
        startMs,
        endMs,
        speakerId,
        targetText: text,
        clipId,
      });
    }
  }
  // Sort by start time as a safety net.
  tracks.sort((a, b) => a.startMs - b.startMs);

  // Synthesize the "其它" character if any track had an empty speaker.
  if (hasOtherSpeaker && !characterById.has(OTHER_ID)) {
    const other = {
      id: OTHER_ID,
      name: '其它',
      gender: '',
      age: '',
      description: '未指定说话人的台词（旁白等）',
    };
    characters.push(other);
    characterById.set(OTHER_ID, other);
  }

  return {
    title: opts.title || raw.title || 'Role-Play Movie',
    videoUrl: opts.videoUrl || raw.videoUrl || raw.videoSrc || '',
    posterUrl: raw.posterUrl || raw.posterSrc || '',
    language: raw.language || '',
    summary: raw.summary || '',
    videoLengthMs: parseTimestamp(raw.videoLength) || 0,
    characters,
    characterById,
    tracks,
    raw,
  };
}

function normalizeChar(c) {
  if (!c || typeof c !== 'object') return { id: '', name: '' };
  return {
    id: String(c.id || '').trim(),
    name: String(c.name || c.id || '').trim(),
    gender: c.gender || '',
    age: c.age || '',
    description: c.description || '',
  };
}

/**
 * Validate a normalized movie before play. Returns array of human-readable errors (empty = ok).
 * @param {MovieConfig} movie
 * @returns {string[]}
 */
export function validateMovie(movie) {
  const errs = [];
  if (!movie.videoUrl) errs.push('缺少 videoUrl');
  if (!movie.tracks || movie.tracks.length === 0) errs.push('没有任何字幕轨（shortClips[].subtitles 为空）');
  return errs;
}
