// ============ Movie JSON model helpers ============
// Normalized accessors over the parsed role-play movie JSON.

function getSubtitles(data) {
  if (!data || !Array.isArray(data.shortClips)) return [];
  const subtitles = [];
  for (const clip of data.shortClips) {
    if (Array.isArray(clip.subtitles)) {
      for (const subtitle of clip.subtitles) subtitles.push(subtitle);
    }
  }
  return subtitles;
}

function getEnabledSubtitles(data) {
  if (!data || !Array.isArray(data.shortClips)) return [];
  const subtitles = [];
  for (const clip of data.shortClips) {
    if (clip.disabled || !Array.isArray(clip.subtitles)) continue;
    for (const subtitle of clip.subtitles) {
      if (!subtitle.disabled) subtitles.push(subtitle);
    }
  }
  return subtitles;
}

function getScenes(data) {
  if (!data || !Array.isArray(data.shortClips)) return [];
  return data.shortClips.map(clip => ({
    start: clip.start,
    end: clip.end,
    description: clip.scene?.description || '',
    on_screen_text: clip.scene?.on_screen_text || '',
    characters: Array.isArray(clip.characters) ? clip.characters : [],
  }));
}

function createCharacterMap(data) {
  const charactersById = new Map();
  if (data && Array.isArray(data.characters)) {
    for (const character of data.characters) {
      if (character && character.id) charactersById.set(character.id, character);
    }
  }
  return charactersById;
}

function getCharacterLabel(charactersById, id) {
  if (!id) return '';
  const character = charactersById.get(id);
  return character ? (character.name || id) : id;
}

export const MovieData = Object.freeze({
  getSubtitles,
  getEnabledSubtitles,
  getScenes,
  createCharacterMap,
  getCharacterLabel,
});
