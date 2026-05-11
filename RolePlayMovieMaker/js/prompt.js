// ============ Default prompt + prompt editor wiring ============
import { ui } from './ui.js';
import { log } from './utils.js';
import { loadSettings, saveSettings } from './settings.js';

export function defaultPrompt() {
  return `You are a precise video analyst working like a film editor decomposing footage into shots. Watch the provided video carefully and produce a single JSON object describing it as a sequence of short clips (shots), preceded by a cast list of main characters that appear in the movie.

Return ONLY a JSON object with EXACTLY this shape (field names, types, and order):

{
  "videoLength": "18:38,000",
  "language": "en",
  "summary": "A short educational drama about wartime aid decisions, told through stage performance and narration.",
  "characters": [
    {
      "id": "narrator",
      "name": "Narrator",
      "gender": "male",
      "age": "40s",
      "description": "Off-screen male narrator with a calm British accent, providing historical context."
    },
    {
      "id": "officer",
      "name": "British Officer",
      "gender": "male",
      "age": "30s",
      "description": "Stage actor in early-1900s British military uniform, debating policy with peers."
    }
  ],
  "shortClips": [
    {
      "start": "00:00,000",
      "end": "00:05,000",
      "characters": [],
      "scene": {
        "description": "Introductory title card on a dark background.",
        "on_screen_text": "0201-0250 IELTS 7600 Vocabulary"
      },
      "subtitles": []
    },
    {
      "start": "00:05,000",
      "end": "00:16,400",
      "characters": ["narrator", "officer"],
      "scene": {
        "description": "Title card for the word 'aid', then a stage musical clip where actors in period costume debate sending aid, ending on a definition slide.",
        "on_screen_text": "aid /eɪd/ n. 帮助，援助；补助金 v. 帮助，援助；促进，有助于"
      },
      "subtitles": [
        { "start": "00:05,000", "end": "00:07,200", "speaker": "narrator", "text": "Aid. Aid." },
        { "start": "00:08,000", "end": "00:11,500", "speaker": "officer", "text": "Now, do we commit money and aid to our French allies, or do we stay out of it?" }
      ]
    }
  ]
}

Requirements:
- "videoLength": total video length as a STRING in the same "MM:SS,mmm" / "HH:MM:SS,mmm" format as the timestamps.
- "language": primary spoken language as a short code or name (e.g. "en", "zh").
- "summary": one concise paragraph summarizing the whole video.
- "characters": the cast of MAIN, recurring or named characters that appear or speak in the video. Ignore brief unnamed extras. Each item MUST contain:
    - "id": a short stable lowercase identifier used to reference the character from clips/subtitles (e.g. "narrator", "officer", "alice"). Unique within the array.
    - "name": display name (e.g. "Narrator", "British Officer", "Alice"). Use a descriptive role label if no proper name is given.
    - "gender": "male" | "female" | "non-binary" | "unknown".
    - "age": a short string (e.g. "child", "teen", "20s", "30s", "40s", "60+", "unknown"). Optional precision is fine.
    - "description": one short sentence covering appearance, role, and any defining trait.
  If no characters are clearly identifiable (e.g. pure b-roll with narration), still list at least the narrator if there is one; otherwise return "characters": [].
- "shortClips": the entire video segmented into consecutive shot/scene clips, in chronological order, covering the full duration with no gaps and no overlaps. Each clip is one continuous shot or one logical mini-scene. Each item MUST contain:
    - "start", "end": clip boundaries as timestamp strings.
    - "characters": array of character "id"s present on-screen or speaking in this clip (empty array if none from the cast list appear).
    - "scene": object with:
        - "description": what is visually happening on screen during this clip (camera, action, setting).
        - "on_screen_text": any visible on-screen text/captions/titles during this clip ("" if none).
    - "subtitles": array of every spoken utterance during this clip, transcribed verbatim and segmented into natural caption-sized chunks (max ~8 seconds each). Each subtitle item MUST contain:
        - "start", "end": timestamp strings, must lie within the clip's [start, end].
        - "speaker": the "id" of the speaking character from the cast list, or "" if the speaker is not a listed character.
        - "text": the transcribed speech.
      Use "subtitles": [] for clips with no speech.

Timestamp format (CRITICAL):
- All "start" and "end" values are STRINGS in the format "MM:SS,mmm" — minutes, seconds, comma, milliseconds (3 digits).
  Examples: "00:05,000", "01:12,500", "18:38,000". Use "MM:SS,mmm" even when minutes < 10 (zero-pad to 2 digits).
  For videos longer than 99 minutes, use "HH:MM:SS,mmm" (e.g. "01:23:45,000").
- The video is sampled at 5 frames per second, so you can and SHOULD give millisecond-precise boundaries (multiples of 200 ms are most accurate).
- Timestamps must be monotonically non-decreasing, "end" must be > "start" within every item, and consecutive shortClips must be back-to-back (next.start === prev.end).

Rules:
- Do NOT add any other top-level fields beyond the six listed. Do NOT add any extra fields inside items beyond those specified.
- Output ONLY the JSON object, no commentary, no markdown fences.`;
}

export function initPrompt() {
  const saved = loadSettings().prompt;
  ui.promptText.value = saved && saved.trim() ? saved : defaultPrompt();

  ui.promptText.addEventListener('input', () => {
    const s = loadSettings();
    s.prompt = ui.promptText.value;
    saveSettings(s);
  });

  ui.resetPrompt.addEventListener('click', () => {
    ui.promptText.value = defaultPrompt();
    const s = loadSettings();
    s.prompt = ui.promptText.value;
    saveSettings(s);
    log('提示词已重置为默认。', 'ok');
  });
}
