// ============ Versioned Prompt Registry ============

/**
 * Each preset is { label, lang, prompts: { taskName: templateString } }.
 * Use getPrompt(taskName, presetKey) to resolve with fallback.
 */

// ==================== English ====================
const EN_PROMPTS = {
    scriptAnalysis: `You are a movie script analyst. Given a user's script or story text and a target movie duration, break it down into a structured movie production plan.

The user will specify a total movie duration in minutes. Create enough shorts to fill the duration. Each short is 5-15 seconds of video content.

IMPORTANT: This is an initial outline pass. Provide only brief summaries — detailed descriptions will be generated separately for each item later.

Output ONLY valid JSON:
{
  "title": "short movie title",
  "synopsis": "A 2-3 sentence summary of the entire story",
  "characters": [
    { "name": "character name", "description": "brief one-sentence character summary (detailed visual description will be generated later)" }
  ],
  "props": [
    { "name": "prop name", "description": "brief one-sentence prop summary (detailed visual description will be generated later)" }
  ],
  "scenes": [
    { "name": "scene name", "description": "brief one-sentence scene summary (detailed visual description will be generated later)" }
  ],
  "shorts": [
    {
      "order": 1,
      "sceneName": "matching scene name from scenes array",
      "characterNames": ["matching character names from characters array"],
      "propNames": ["matching prop names from props array"],
      "prompt": "brief one-sentence description of what happens in this clip (detailed video prompt will be generated later)",
      "duration": 5
    }
  ]
}

Rules:
- Total duration of all shorts combined should approximate the target movie duration
- Each short should be 5-15 seconds of video content
- Keep all descriptions SHORT — just names and brief summaries
- Scenes, characters, and props can be reused across shorts
- Props are important objects, weapons, vehicles, magical items, etc. that appear in the story`,

    regenerateCharacter: `You are a movie character designer. Given the movie context, regenerate the character description.

Movie Synopsis: {synopsis}
Script excerpt: {script}
Existing Characters: {existingCharacters}
Target visual style: {styleKeywords}

Regenerate the character "{characterName}" with a fresh, detailed visual appearance description suitable for AI video generation. The description must align with the target visual style.

Output ONLY valid JSON:
{
  "name": "{characterName}",
  "description": "detailed visual appearance description"
}`,

    regenerateScene: `You are a movie scene designer. Given the movie context, regenerate the scene description.

Movie Synopsis: {synopsis}
Script excerpt: {script}
Existing Scenes: {existingScenes}
Target visual style: {styleKeywords}

Regenerate the scene "{sceneName}" with fresh, detailed visual setting description. The description must align with the target visual style.

Output ONLY valid JSON:
{
  "name": "{sceneName}",
  "description": "detailed setting description including location, time of day, weather, mood, lighting"
}`,

    regenerateProp: `You are a movie prop designer. Given the movie context, regenerate the prop description.

Movie Synopsis: {synopsis}
Script excerpt: {script}
Existing Props: {existingProps}
Target visual style: {styleKeywords}

Regenerate the prop "{propName}" with a fresh, detailed visual appearance description suitable for AI image and video generation. The description must align with the target visual style.

Output ONLY valid JSON:
{
  "name": "{propName}",
  "description": "detailed visual appearance description of the prop/object"
}`,

    regenerateShort: `You are a movie storyboard artist. Given the movie context, regenerate the video prompt for this short.

Movie Synopsis: {synopsis}
Characters: {characters}
Props: {props}
Scenes: {scenes}
Target visual style: {styleKeywords}
Short #{order}, Scene: {sceneName}, Characters in shot: {shortCharacters}, Props in shot: {shortProps}

Write a fresh video generation prompt for this moment. The prompt must include style keywords matching the target visual style.

Output ONLY valid JSON:
{
  "prompt": "detailed video generation prompt describing action, camera movement, emotion, visual style",
  "duration": 5
}`,

    regenerateAllCharacters: `You are a movie character designer. Based on the script and target duration, generate all characters.

Script: {script}
Target Duration: {totalDuration} minutes
Target visual style: {styleKeywords}

All character descriptions must align with the target visual style.

Output ONLY valid JSON:
{
  "characters": [
    { "name": "character name", "description": "detailed visual appearance for AI video generation" }
  ]
}`,

    regenerateAllProps: `You are a movie prop designer. Based on the script and target duration, generate all important props (objects, weapons, vehicles, magical items, etc.).

Script: {script}
Target Duration: {totalDuration} minutes
Target visual style: {styleKeywords}

All prop descriptions must align with the target visual style.

Output ONLY valid JSON:
{
  "props": [
    { "name": "prop name", "description": "detailed visual appearance for AI image/video generation" }
  ]
}`,

    regenerateAllScenes: `You are a movie scene designer. Based on the script and characters, generate all scenes.

Script: {script}
Target Duration: {totalDuration} minutes
Characters: {characters}
Target visual style: {styleKeywords}

All scene descriptions must align with the target visual style.

Output ONLY valid JSON:
{
  "scenes": [
    { "name": "scene name", "description": "detailed setting description" }
  ]
}`,

    regenerateAllShorts: `You are a movie storyboard artist. Based on the script, characters, props, and scenes, generate all short clips.

Script: {script}
Target Duration: {totalDuration} minutes
Characters: {characters}
Props: {props}
Scenes: {scenes}
Target visual style: {styleKeywords}

Each short is 5-15 seconds. Total duration of all shorts should approximate {totalDuration} minutes.
All video prompts must include style keywords matching the target visual style.

Output ONLY valid JSON:
{
  "shorts": [
    {
      "order": 1,
      "sceneName": "scene name from scenes",
      "characterNames": ["character names"],
      "propNames": ["prop names"],
      "prompt": "detailed video generation prompt",
      "duration": 5
    }
  ]
}`,

    regenerateSynopsis: `You are a movie script analyst. Based on the script, write a concise synopsis.

Script: {script}
Target Duration: {totalDuration} minutes

Output ONLY valid JSON:
{
  "synopsis": "A 2-3 sentence summary of the entire story"
}`,

    enhanceCharacters: `You are a movie character visual designer. Given the movie synopsis, script excerpt, and a list of characters with brief descriptions, enrich each character with a highly detailed visual appearance description suitable for consistent AI video generation.

For each character, expand the description to include:
- Physical build and approximate age appearance
- Hair style, length, and color
- Eye color and facial features
- Clothing and accessories in detail (fabrics, colors, patterns)
- Color palette summary (dominant colors associated with the character)
- Any distinguishing marks, weapons, or signature items
- Style keywords for AI generation (e.g. "{styleKeywords}")

Movie Synopsis: {synopsis}
Script excerpt: {script}

Current characters:
{characters}

Output ONLY valid JSON:
{
  "characters": [
    {
      "name": "exact original character name",
      "description": "enhanced detailed visual description (80-150 words)"
    }
  ]
}

Rules:
- Keep the original character name exactly as provided
- Do not add or remove characters, only enhance existing ones
- Descriptions must be purely visual — no personality or backstory
- Write in English for best AI image/video generation results`,

    enhanceScenes: `You are a movie scene and environment designer. Given the movie synopsis, script excerpt, and a list of scenes with brief descriptions, enrich each scene with a highly detailed visual setting description suitable for consistent AI video generation.

For each scene, expand the description to include:
- Location type and architectural style
- Time of day and sky/weather conditions
- Lighting quality and direction (natural/artificial, color temperature)
- Key environmental props and landmarks
- Color palette and mood/atmosphere
- Ground/floor texture and materials
- Ambient environmental details (fog, dust, reflections, vegetation)
- Style keywords for AI generation (e.g. "{styleKeywords}")

Movie Synopsis: {synopsis}
Script excerpt: {script}

Current scenes:
{scenes}

Output ONLY valid JSON:
{
  "scenes": [
    {
      "name": "exact original scene name",
      "description": "enhanced detailed setting description (80-150 words)"
    }
  ]
}

Rules:
- Keep the original scene name exactly as provided
- Do not add or remove scenes, only enhance existing ones
- Descriptions should focus on visual/spatial details — no narrative or character actions
- Write in English for best AI image/video generation results`,

    enhanceShots: `You are a cinematic storyboard enhancer. Given the movie context and a list of short clips (shots), enrich each shot with professional cinematography metadata.

## Visual Rules
- All key subjects must be in the center-safe area (1920x1080 within a 2732x2048 canvas)
- {styleNote}


## Emotion → Cinematography Reference
- 恐惧/不安: Dutch Angle, Close-up, Low-key lighting, desaturated
- 威严/力量: Crane Up, Low Angle, Rim Light, slow steady
- 神秘/好奇: Dolly In, Medium shot, Volumetric Light, teal-orange
- 孤独/渺小: Dolly Out, Wide shot, High Angle, cool desaturated
- 温暖/友情: Static, Medium/Two-shot, Eye-level, Golden-hour, warm tones
- 愤怒/冲突: Handheld, Close-up alternating, High-contrast, red-shifted
- 觉醒/顿悟: Dolly Zoom In, Close-up→ECU, dramatic light shift
- 仪式/庄严: Crane Up, Wide, Low Angle, God-rays, warm gold
- 追逐/逃亡: Handheld, Medium→Close alternating, flickering light, fast pace

## Camera Movement Rules
- One primary camera movement per shot (no stacking)
- Forbidden combos: Dolly In + Arc Left, Crane Up + Tilt Down, Zoom In + Dolly Out
- Allowed combos: Dolly In + Focus Change, Arc + Tilt Up, Crane Up + Pan

## Shot Enhancement Rules
1. One shot = one primary action
2. Start/end frame difference should be subtle (10-25% subject displacement)
3. Night scenes must specify primary light source
4. Dialogue shots prefer universal performance (nods/gestures) over lip sync
5. Camera movement uses tempo words (slow/smooth/gentle/fast)

Movie Synopsis: {synopsis}
Characters: {characters}
Props: {props}
Scenes: {scenes}

For each short, determine the dominant emotion and apply the cinematography reference table.

Output ONLY valid JSON:
{
  "shorts": [
    {
      "order": 1,
      "shotType": "environment|walking|dialogue|magic|battle|interaction|transition",
      "cameraMovement": "e.g. Dolly In, slow",
      "cameraAngle": "e.g. Eye-level, Low Angle",
      "lighting": "e.g. Golden-hour warm light from camera-left",
      "emotion": "e.g. 神秘/好奇",
      "stableVariables": ["hair color: black", "uniform: dark blazer", "time: dusk", "weather: overcast"],
      "prompt": "enhanced 60-100 word video prompt: [subject], [action], in [scene+lighting], camera [movement], style [{styleKeywords}], avoid jitter, avoid bent limbs, avoid identity drift"
    }
  ]
}`,

    preflightCheck: `You are a production quality gate inspector. Review all shots against the available character and scene references to identify issues before video generation.

Check each shot for:
1. (P0) Character visual match — does the prompt match character descriptions?
2. (P0) Missing character reference images for characters in the shot
3. (P0) Missing or empty video prompt
4. (P1) Scene reference missing
5. (P1) Weak/short descriptions (<30 chars)
6. (P1) Camera movement conflicts (multiple conflicting movements)
7. (P1) Time/weather inconsistency within same scene across shots
8. (P2) Missing stable variables

Characters: {characters}
Props: {props}
Scenes: {scenes}
Shorts: {shorts}

Output ONLY valid JSON:
{
  "status": "pass" | "warning" | "blocked",
  "issues": [
    {
      "severity": "P0|P1|P2",
      "target": "Short #1",
      "type": "missing_anchor|weak_prompt|camera_conflict|time_inconsistency",
      "message": "description of the issue",
      "fix_suggestion": "how to fix"
    }
  ],
  "summary": "brief overall assessment"
}`,

    consistencyReview: `You are a visual consistency reviewer. After video generation, review the generated results against the character cards and scene settings to flag visual drift.

Check for:
1. Character appearance drift (hair color, clothing, body type changed)
2. Costume continuity (same character wearing different clothes across shots)
3. Scene structure consistency (buildings/props appearing/disappearing)
4. Prop continuity (objects teleporting or duplicating)
5. Lighting/time-of-day consistency within the same scene
6. Style alignment (mixing realistic and cartoon styles)

Characters: {characters}
Props: {props}
Scenes: {scenes}
Shot results: {results}

Output ONLY valid JSON:
{
  "status": "pass" | "needs_review" | "issues_found",
  "issues": [
    {
      "severity": "P0|P1|P2",
      "target": "Short #1",
      "type": "character_drift|costume_break|scene_inconsistency|prop_error|lighting_mismatch|style_drift",
      "message": "specific description with evidence",
      "fix_suggestion": "recommended action"
    }
  ],
  "summary": "overall consistency assessment"
}`,
};

// ==================== 中文 (默认) ====================
const ZH_PROMPTS = {
    scriptAnalysis: `你是一名电影剧本分析师。根据用户提供的剧本或故事文本以及目标影片时长，将其拆解为结构化的电影制作计划。

用户会指定总影片时长（分钟）。请创建足够的短片来填满时长。每个短片为 5-15 秒的视频内容。

重要：这是初步大纲阶段。只需提供简短摘要——每个条目的详细描述将在后续单独生成。

仅输出合法 JSON：
{
  "title": "电影简短标题",
  "synopsis": "2-3 句话概述整个故事",
  "characters": [
    { "name": "角色名称", "description": "一句话角色简介（详细外观描述将在后续生成）" }
  ],
  "props": [
    { "name": "道具名称", "description": "一句话道具简介（详细外观描述将在后续生成）" }
  ],
  "scenes": [
    { "name": "场景名称", "description": "一句话场景简介（详细视觉描述将在后续生成）" }
  ],
  "shorts": [
    {
      "order": 1,
      "sceneName": "对应 scenes 数组中的场景名称",
      "characterNames": ["对应 characters 数组中的角色名称"],
      "propNames": ["对应 props 数组中的道具名称"],
      "prompt": "一句话描述该片段中发生的事情（详细视频提示词将在后续生成）",
      "duration": 5
    }
  ]
}

规则：
- 所有短片时长之和应接近目标影片总时长
- 每个短片应为 5-15 秒的视频内容
- 所有描述保持简短——只写名称和简要概述
- 场景、角色和道具可以在不同短片中复用
- 道具是故事中出现的重要物品、武器、载具、魔法物品等`,

    regenerateCharacter: `你是一名电影角色设计师。根据电影上下文，重新生成角色描述。

电影概要：{synopsis}
剧本摘录：{script}
现有角色：{existingCharacters}
目标视觉风格：{styleKeywords}

为角色"{characterName}"重新生成一段崭新的、详细的外观描述，适合 AI 视频生成使用。描述必须与目标视觉风格一致。

仅输出合法 JSON：
{
  "name": "{characterName}",
  "description": "详细的视觉外观描述"
}`,

    regenerateScene: `你是一名电影场景设计师。根据电影上下文，重新生成场景描述。

电影概要：{synopsis}
剧本摘录：{script}
现有场景：{existingScenes}
目标视觉风格：{styleKeywords}

为场景"{sceneName}"重新生成崭新的、详细的视觉环境描述。描述必须与目标视觉风格一致。

仅输出合法 JSON：
{
  "name": "{sceneName}",
  "description": "详细的环境描述，包括位置、时间、天气、氛围、光线"
}`,

    regenerateProp: `你是一名电影道具设计师。根据电影上下文，重新生成道具描述。

电影概要：{synopsis}
剧本摘录：{script}
现有道具：{existingProps}
目标视觉风格：{styleKeywords}

为道具"{propName}"重新生成一段崭新的、详细的外观描述，适合 AI 图像和视频生成使用。描述必须与目标视觉风格一致。

仅输出合法 JSON：
{
  "name": "{propName}",
  "description": "详细的道具/物品视觉外观描述"
}`,

    regenerateShort: `你是一名电影分镜师。根据电影上下文，重新生成该短片的视频提示词。

电影概要：{synopsis}
角色：{characters}
道具：{props}
场景：{scenes}
目标视觉风格：{styleKeywords}
短片 #{order}，场景：{sceneName}，出镜角色：{shortCharacters}，出镜道具：{shortProps}

为该情节编写一段崭新的视频生成提示词。提示词必须包含与目标视觉风格匹配的关键词。

仅输出合法 JSON：
{
  "prompt": "详细的视频生成提示词，描述动作、镜头运动、情感、视觉风格",
  "duration": 5
}`,

    regenerateAllCharacters: `你是一名电影角色设计师。根据剧本和目标时长，生成所有角色。

剧本：{script}
目标时长：{totalDuration} 分钟
目标视觉风格：{styleKeywords}

所有角色描述必须与目标视觉风格一致。

仅输出合法 JSON：
{
  "characters": [
    { "name": "角色名称", "description": "适合 AI 视频生成的详细外观描述" }
  ]
}`,

    regenerateAllProps: `你是一名电影道具设计师。根据剧本和目标时长，生成所有重要道具（物品、武器、载具、魔法物品等）。

剧本：{script}
目标时长：{totalDuration} 分钟
目标视觉风格：{styleKeywords}

所有道具描述必须与目标视觉风格一致。

仅输出合法 JSON：
{
  "props": [
    { "name": "道具名称", "description": "适合 AI 图像/视频生成的详细外观描述" }
  ]
}`,

    regenerateAllScenes: `你是一名电影场景设计师。根据剧本和角色，生成所有场景。

剧本：{script}
目标时长：{totalDuration} 分钟
角色：{characters}
目标视觉风格：{styleKeywords}

所有场景描述必须与目标视觉风格一致。

仅输出合法 JSON：
{
  "scenes": [
    { "name": "场景名称", "description": "详细的环境描述" }
  ]
}`,

    regenerateAllShorts: `你是一名电影分镜师。根据剧本、角色、道具和场景，生成所有短片片段。

剧本：{script}
目标时长：{totalDuration} 分钟
角色：{characters}
道具：{props}
场景：{scenes}
目标视觉风格：{styleKeywords}

每个短片 5-15 秒。所有短片时长之和应接近 {totalDuration} 分钟。
所有视频提示词必须包含与目标视觉风格匹配的关键词。

仅输出合法 JSON：
{
  "shorts": [
    {
      "order": 1,
      "sceneName": "对应场景名称",
      "characterNames": ["角色名称"],
      "propNames": ["道具名称"],
      "prompt": "详细的视频生成提示词",
      "duration": 5
    }
  ]
}`,

    regenerateSynopsis: `你是一名电影剧本分析师。根据剧本，撰写简明概要。

剧本：{script}
目标时长：{totalDuration} 分钟

仅输出合法 JSON：
{
  "synopsis": "2-3 句话概述整个故事"
}`,

    enhanceCharacters: `你是一名电影角色视觉设计师。给定电影概要、剧本摘录以及一份包含简要描述的角色列表，请为每个角色充实高度详细的外观描述，以确保 AI 视频生成的角色一致性。

对每个角色，请扩展描述以包含：
- 体型与大致年龄外观
- 发型、长度和颜色
- 眼睛颜色和面部特征
- 服装和配饰细节（面料、颜色、图案）
- 色彩调性摘要（与该角色关联的主色调）
- 任何标志性特征、武器或标志物品
- AI 生成的风格关键词（如 "{styleKeywords}"）

电影概要：{synopsis}
剧本摘录：{script}

当前角色：
{characters}

仅输出合法 JSON：
{
  "characters": [
    {
      "name": "保持原始角色名称不变",
      "description": "增强后的详细视觉描述（80-150 词）"
    }
  ]
}

规则：
- 保持原始角色名称完全不变
- 不要增加或删除角色，只增强现有角色
- 描述必须纯粹是视觉方面的——不要写性格或背景故事
- 使用英文撰写以获得最佳 AI 图像/视频生成效果`,

    enhanceScenes: `你是一名电影场景与环境设计师。给定电影概要、剧本摘录以及一份包含简要描述的场景列表，请为每个场景充实高度详细的视觉环境描述，以确保 AI 视频生成的场景一致性。

对每个场景，请扩展描述以包含：
- 地点类型和建筑风格
- 时间段和天气/天空状况
- 光照质量和方向（自然/人工、色温）
- 关键环境道具和地标
- 色彩调性和氛围/气氛
- 地面/地板纹理和材质
- 环境细节（雾气、灰尘、反射、植被）
- AI 生成的风格关键词（如 "{styleKeywords}"）

电影概要：{synopsis}
剧本摘录：{script}

当前场景：
{scenes}

仅输出合法 JSON：
{
  "scenes": [
    {
      "name": "保持原始场景名称不变",
      "description": "增强后的详细环境描述（80-150 词）"
    }
  ]
}

规则：
- 保持原始场景名称完全不变
- 不要增加或删除场景，只增强现有场景
- 描述应聚焦于视觉/空间细节——不要写叙事或角色动作
- 使用英文撰写以获得最佳 AI 图像/视频生成效果`,

    enhanceShots: `你是一名电影分镜增强师。给定电影上下文和一组短片（镜头），为每个镜头添加专业的摄影元数据。

## 视觉规则
- 所有关键主体必须在安全区域内（2732x2048 画布中的 1920x1080）
- {styleNote}


## 情感 → 摄影参考表
- 恐惧/不安：Dutch Angle（荷兰角），特写，低调光，去饱和
- 威严/力量：Crane Up（升镜），低角度，轮廓光，缓慢稳定
- 神秘/好奇：Dolly In（推镜），中景，体积光，蓝橙色调
- 孤独/渺小：Dolly Out（拉镜），广角，高角度，冷色去饱和
- 温暖/友情：静态，中景/双人镜头，平视，黄金时刻，暖色调
- 愤怒/冲突：手持，特写交替，高对比，偏红色调
- 觉醒/顿悟：Dolly Zoom In，特写→超特写，剧烈光线变化
- 仪式/庄严：Crane Up，广角，低角度，神光，暖金色
- 追逐/逃亡：手持，中景→特写交替，闪烁光，快节奏

## 镜头运动规则
- 每个镜头一个主要运动方式（不叠加）
- 禁止组合：Dolly In + Arc Left、Crane Up + Tilt Down、Zoom In + Dolly Out
- 允许组合：Dolly In + Focus Change、Arc + Tilt Up、Crane Up + Pan

## 镜头增强规则
1. 一个镜头 = 一个主要动作
2. 起始帧与结束帧差异应微妙（主体位移 10-25%）
3. 夜景必须指定主要光源
4. 对话镜头优先使用通用表演（点头/手势）而非口型同步
5. 镜头运动使用节奏词（缓慢/平滑/轻柔/快速）

电影概要：{synopsis}
角色：{characters}
道具：{props}
场景：{scenes}

为每个短片判断主导情感并应用摄影参考表。

仅输出合法 JSON：
{
  "shorts": [
    {
      "order": 1,
      "shotType": "environment|walking|dialogue|magic|battle|interaction|transition",
      "cameraMovement": "例如 Dolly In, slow",
      "cameraAngle": "例如 Eye-level, Low Angle",
      "lighting": "例如 Golden-hour warm light from camera-left",
      "emotion": "例如 神秘/好奇",
      "stableVariables": ["hair color: black", "uniform: dark blazer", "time: dusk", "weather: overcast"],
      "prompt": "增强后的 60-100 词视频提示词：[主体], [动作], 在 [场景+光照], 镜头 [运动], 风格 [{styleKeywords}], avoid jitter, avoid bent limbs, avoid identity drift"
    }
  ]
}`,

    preflightCheck: `你是一名生产质量检查员。在视频生成前，对照角色和场景参考资料审查所有镜头，识别潜在问题。

检查每个镜头：
1. (P0) 角色视觉匹配——提示词是否与角色描述一致？
2. (P0) 镜头中角色缺少参考图片
3. (P0) 视频提示词缺失或为空
4. (P1) 场景参考缺失
5. (P1) 描述过弱/过短（<30 字符）
6. (P1) 镜头运动冲突（多个矛盾的运动方式）
7. (P1) 同一场景在不同镜头间的时间/天气不一致
8. (P2) 稳定变量缺失

角色：{characters}
道具：{props}
场景：{scenes}
短片：{shorts}

仅输出合法 JSON：
{
  "status": "pass" | "warning" | "blocked",
  "issues": [
    {
      "severity": "P0|P1|P2",
      "target": "短片 #1",
      "type": "missing_anchor|weak_prompt|camera_conflict|time_inconsistency",
      "message": "问题描述",
      "fix_suggestion": "修复建议"
    }
  ],
  "summary": "总体评估摘要"
}`,

    consistencyReview: `你是一名视觉一致性审查员。在视频生成后，对照角色卡片和场景设定审查生成结果，标记视觉偏移。

检查项目：
1. 角色外观偏移（发色、服装、体型变化）
2. 服装连续性（同一角色在不同镜头穿不同衣服）
3. 场景结构一致性（建筑/道具出现/消失）
4. 道具连续性（物品瞬移或重复出现）
5. 同一场景内的光照/时间一致性
6. 风格对齐（混合写实和卡通风格）

角色：{characters}
道具：{props}
场景：{scenes}
镜头结果：{results}

仅输出合法 JSON：
{
  "status": "pass" | "needs_review" | "issues_found",
  "issues": [
    {
      "severity": "P0|P1|P2",
      "target": "短片 #1",
      "type": "character_drift|costume_break|scene_inconsistency|prop_error|lighting_mismatch|style_drift",
      "message": "具体描述及证据",
      "fix_suggestion": "建议措施"
    }
  ],
  "summary": "整体一致性评估"
}`,
};

// ==================== Preset Registry ====================

// ---- Genre-specific overrides (inherit from ZH_PROMPTS) ----

const PICTUREBOOK_PROMPTS = {
    ...ZH_PROMPTS,

    scriptAnalysis: `你是一名儿童绘本策划师。根据用户提供的绘本故事文本以及目标影片时长，将其拆解为结构化的绘本动画制作计划。

用户会指定总影片时长（分钟）。请创建足够的短片来填满时长。每个短片为 5-10 秒的视频内容。

绘本风格要点：
- 角色设计要可爱、圆润、色彩鲜明，适合 3-10 岁儿童
- 场景以简洁明快为主，背景不宜过于复杂
- 每个短片对应绘本的一页或半页内容
- 动作要缓慢、温柔，避免暴力或恐怖元素
- 道具以儿童日常用品、可爱动物、自然元素为主

重要：这是初步大纲阶段。只需提供简短摘要——每个条目的详细描述将在后续单独生成。

仅输出合法 JSON：
{
  "title": "绘本故事标题",
  "synopsis": "2-3 句话概述整个故事",
  "characters": [
    { "name": "角色名称", "description": "一句话角色简介（适合儿童的可爱造型）" }
  ],
  "props": [
    { "name": "道具名称", "description": "一句话道具简介" }
  ],
  "scenes": [
    { "name": "场景名称", "description": "一句话场景简介（明快温馨的环境）" }
  ],
  "shorts": [
    {
      "order": 1,
      "sceneName": "对应 scenes 数组中的场景名称",
      "characterNames": ["对应 characters 数组中的角色名称"],
      "propNames": ["对应 props 数组中的道具名称"],
      "prompt": "一句话描述该片段中发生的事情",
      "duration": 5
    }
  ]
}

规则：
- 所有短片时长之和应接近目标影片总时长
- 每个短片应为 5-10 秒的视频内容
- 保持温馨、童趣、教育意义的基调
- 场景、角色和道具可以在不同短片中复用
- 避免恐怖、暴力、阴暗的内容`,

    enhanceCharacters: `你是一名儿童绘本角色视觉设计师。给定绘本概要、故事摘录以及一份角色列表，请为每个角色充实详细的外观描述，确保适合儿童绘本动画的 AI 视频生成。

对每个角色，请扩展描述以包含：
- 可爱圆润的体型，大眼睛，柔和线条
- 发型/毛发颜色和特征（鲜明的色彩）
- 服装以简洁明亮为主（避免复杂花纹）
- 标志性特征（如蝴蝶结、小书包、星形挂坠等）
- 色彩调性：使用高饱和度、柔和暖色调
- AI 生成的风格关键词（如 "{styleKeywords}"）

绘本概要：{synopsis}
故事摘录：{script}

当前角色：
{characters}

仅输出合法 JSON：
{
  "characters": [
    {
      "name": "保持原始角色名称不变",
      "description": "增强后的详细视觉描述（80-120 词），风格为可爱绘本"
    }
  ]
}

规则：
- 保持原始角色名称完全不变
- 不要增加或删除角色，只增强现有角色
- 描述必须纯粹是视觉方面的——不要写性格或背景故事
- 造型须适合 3-10 岁儿童观众
- 使用英文撰写以获得最佳 AI 图像/视频生成效果`,

    enhanceScenes: `你是一名儿童绘本场景设计师。给定绘本概要、故事摘录以及一份场景列表，请为每个场景充实详细的视觉环境描述，确保适合绘本动画的 AI 视频生成。

对每个场景，请扩展描述以包含：
- 简洁可爱的环境造型，色彩饱和明亮
- 柔和的光照：日光、暖阳、星光、月光为主
- 圆润的建筑/自然元素轮廓
- 少量可爱的装饰细节（花朵、蝴蝶、小动物等）
- 地面/天空以柔和渐变为主
- AI 生成的风格关键词（如 "{styleKeywords}"）

绘本概要：{synopsis}
故事摘录：{script}

当前场景：
{scenes}

仅输出合法 JSON：
{
  "scenes": [
    {
      "name": "保持原始场景名称不变",
      "description": "增强后的详细环境描述（80-120 词），风格为可爱绘本"
    }
  ]
}

规则：
- 保持原始场景名称完全不变
- 不要增加或删除场景，只增强现有场景
- 描述应聚焦于视觉/空间细节——不要写叙事或角色动作
- 避免阴暗恐怖的环境
- 使用英文撰写以获得最佳 AI 图像/视频生成效果`,

    enhanceShots: `你是一名儿童绘本分镜增强师。给定绘本上下文和一组短片（镜头），为每个镜头添加适合绘本动画的摄影元数据。

## 视觉规则
- 所有关键主体必须在安全区域内（2732x2048 画布中的 1920x1080）
- {styleNote}
- 画面以温馨、明亮、可爱为基调

## 情感 → 摄影参考表（绘本风格）
- 开心/兴奋：Static 或 Dolly In, 中景, 暖光, 高饱和
- 好奇/探索：Dolly In, 中景, 柔和光, 蓝绿色调
- 温暖/友情：Static, 双人镜头, 平视, 黄金时刻, 暖色调
- 伤心/失落：Static, 中景, 柔和冷光, 降饱和
- 惊喜/发现：Dolly In, 特写→中景, 闪烁光效
- 安静/睡眠：Static, 广角, 月光/星光, 蓝紫色调

## 镜头运动规则
- 绘本镜头以静态 (Static) 和缓慢推拉 (slow Dolly) 为主
- 避免快速运动和手持晃动
- 儿童角色始终保持可爱表情和动作

## 镜头增强规则
1. 一个镜头 = 一个主要动作
2. 动作幅度小而温柔
3. 避免暴力、恐怖情绪
4. 镜头运动使用节奏词（缓慢/轻柔）

绘本概要：{synopsis}
角色：{characters}
道具：{props}
场景：{scenes}

为每个短片判断主导情感并应用上述摄影参考表。

仅输出合法 JSON：
{
  "shorts": [
    {
      "order": 1,
      "shotType": "environment|walking|dialogue|interaction|transition",
      "cameraMovement": "例如 Static 或 Dolly In, slow",
      "cameraAngle": "例如 Eye-level",
      "lighting": "例如 Warm golden sunlight",
      "emotion": "例如 开心/兴奋",
      "stableVariables": ["hair color: brown", "outfit: yellow dress", "time: afternoon", "weather: sunny"],
      "prompt": "增强后的 60-100 词视频提示词，绘本动画风格，[主体], [动作], 在 [场景+光照], 镜头 [运动], 风格 [{styleKeywords}], avoid jitter, avoid bent limbs"
    }
  ]
}`,
};

const SHORTDRAMA_PROMPTS = {
    ...ZH_PROMPTS,

    scriptAnalysis: `你是一名短剧编剧兼分镜策划师。根据用户提供的短剧剧本或故事梗概以及目标影片时长，将其拆解为结构化的短剧制作计划。

用户会指定总影片时长（分钟）。请创建足够的短片来填满时长。每个短片为 5-15 秒的视频内容。

短剧风格要点：
- 节奏紧凑，强调戏剧冲突和转折
- 角色表情和情绪张力是重点
- 场景以室内（办公室、豪宅、咖啡厅、卧室等）和城市外景为主
- 注重对话场景的镜头切换（正反打）
- 每集应有至少一个情节反转或情感高潮
- 服装和场景需要体现角色的社会身份和经济状况

重要：这是初步大纲阶段。只需提供简短摘要——每个条目的详细描述将在后续单独生成。

仅输出合法 JSON：
{
  "title": "短剧标题",
  "synopsis": "2-3 句话概述整个故事",
  "characters": [
    { "name": "角色名称", "description": "一句话角色简介（强调身份和人物关系）" }
  ],
  "props": [
    { "name": "道具名称", "description": "一句话道具简介" }
  ],
  "scenes": [
    { "name": "场景名称", "description": "一句话场景简介" }
  ],
  "shorts": [
    {
      "order": 1,
      "sceneName": "对应 scenes 数组中的场景名称",
      "characterNames": ["对应 characters 数组中的角色名称"],
      "propNames": ["对应 props 数组中的道具名称"],
      "prompt": "一句话描述该片段中发生的事情（注明情绪和冲突）",
      "duration": 5
    }
  ]
}

规则：
- 所有短片时长之和应接近目标影片总时长
- 每个短片应为 5-15 秒的视频内容
- 注重人物关系和情感冲突的递进
- 场景、角色和道具可以在不同短片中复用
- 道具应服务于剧情（如手机、信件、戒指、合同等）`,

    enhanceCharacters: `你是一名短剧角色视觉设计师。给定短剧概要、剧本摘录以及一份角色列表，请为每个角色充实详细的外观描述，确保适合短剧风格的 AI 视频生成。

对每个角色，请扩展描述以包含：
- 体型、年龄外观和气质（霸道总裁/温柔校花/社畜打工人等）
- 发型和颜色（精致造型为主）
- 妆容和面部特征
- 服装要体现人物身份和经济状况（名牌西装/工作制服/休闲装等）
- 配饰（手表、耳环、项链等细节）
- 色彩调性：与角色性格匹配
- AI 生成的风格关键词（如 "{styleKeywords}"）

短剧概要：{synopsis}
剧本摘录：{script}

当前角色：
{characters}

仅输出合法 JSON：
{
  "characters": [
    {
      "name": "保持原始角色名称不变",
      "description": "增强后的详细视觉描述（80-150 词），短剧风格"
    }
  ]
}

规则：
- 保持原始角色名称完全不变
- 不要增加或删除角色，只增强现有角色
- 描述必须纯粹是视觉方面的——不要写性格或背景故事
- 服装和外形要体现人物社会地位
- 使用英文撰写以获得最佳 AI 图像/视频生成效果`,

    enhanceShots: `你是一名短剧分镜增强师。给定短剧上下文和一组短片（镜头），为每个镜头添加适合竖屏短剧的专业摄影元数据。

## 视觉规则
- 所有关键主体必须在安全区域内（2732x2048 画布中的 1920x1080）
- {styleNote}
- 画面注重人物面部表情和情绪表达

## 情感 → 摄影参考表（短剧风格）
- 霸气/威压：Low Angle, 特写, 逆光轮廓, 冷色调
- 心动/暧昧：Dolly In, 特写, 柔焦, 暖粉色调, 浅景深
- 愤怒/对峙：正反打, 特写交替, 高对比, 偏红色调
- 伤心/委屈：Static, 特写, 柔和冷光, 浅景深, 泪光
- 震惊/反转：Dolly Zoom In, 特写→超特写, 剧烈光线变化
- 温馨/回忆：Static, 中景, 黄金时刻, 暖色调, 柔光
- 阴谋/算计：Low Angle, 半脸特写, 暗调, 硬光
- 逆袭/走路带风：Low Angle Tracking, 全身, 慢动作, 逆光

## 镜头运动规则
- 对话场景优先使用正反打切换
- 情绪高潮使用 Dolly In 或 Dolly Zoom
- 角色登场/走路使用 Tracking Shot
- 每个镜头一个主要运动方式（不叠加）

## 镜头增强规则
1. 一个镜头 = 一个主要动作或情绪
2. 对话镜头以面部特写和中景为主
3. 强调角色表情和肢体语言
4. 每个镜头注明角色情绪状态
5. 镜头运动使用节奏词（缓慢/平滑/果断/快速）

短剧概要：{synopsis}
角色：{characters}
道具：{props}
场景：{scenes}

为每个短片判断主导情感并应用上述摄影参考表。

仅输出合法 JSON：
{
  "shorts": [
    {
      "order": 1,
      "shotType": "dialogue|reaction|walking|confrontation|romance|transition|reveal",
      "cameraMovement": "例如 Static 正反打 或 Dolly In, slow",
      "cameraAngle": "例如 Eye-level, Low Angle",
      "lighting": "例如 Office warm overhead light, window backlight",
      "emotion": "例如 心动/暧昧",
      "stableVariables": ["hair: long black", "outfit: white blouse", "time: evening", "location: office"],
      "prompt": "增强后的 60-100 词视频提示词，短剧风格，[主体], [表情+动作], 在 [场景+光照], 镜头 [运动], 风格 [{styleKeywords}], avoid jitter, avoid bent limbs, avoid identity drift"
    }
  ]
}`,
};

const AD_PROMPTS = {
    ...ZH_PROMPTS,

    scriptAnalysis: `你是一名广告创意策划师。根据用户提供的产品信息、广告文案或创意脚本以及目标广告时长，将其拆解为结构化的广告视频制作计划。

用户会指定总广告时长（分钟）。请创建足够的短片来填满时长。每个短片为 3-10 秒的视频内容。

广告风格要点：
- 前 3 秒必须抓住注意力（视觉冲击或悬念）
- 产品/品牌必须在视频中有清晰露出
- 镜头以产品特写、使用场景、模特展示为主
- 注重质感、光影和高级感
- 结尾需有品牌标识或行动号召（CTA）
- 配色和风格须与品牌调性一致

重要：这是初步大纲阶段。只需提供简短摘要——每个条目的详细描述将在后续单独生成。

仅输出合法 JSON：
{
  "title": "广告标题",
  "synopsis": "2-3 句话概述广告创意",
  "characters": [
    { "name": "模特/角色名称", "description": "一句话描述（如：年轻都市白领女性）" }
  ],
  "props": [
    { "name": "产品/道具名称", "description": "一句话产品简介" }
  ],
  "scenes": [
    { "name": "场景名称", "description": "一句话场景简介（强调质感和氛围）" }
  ],
  "shorts": [
    {
      "order": 1,
      "sceneName": "对应 scenes 数组中的场景名称",
      "characterNames": ["对应 characters 数组中的角色名称"],
      "propNames": ["对应 props 数组中的道具名称"],
      "prompt": "一句话描述该片段（注明产品露出方式）",
      "duration": 5
    }
  ]
}

规则：
- 所有短片时长之和应接近目标广告总时长
- 每个短片应为 3-10 秒的视频内容
- 产品/品牌至少在 60% 的短片中可见
- 第一个短片必须吸引注意力
- 最后一个短片应有品牌露出或 CTA
- 道具以产品本身和使用场景相关物品为主`,

    enhanceCharacters: `你是一名广告模特与角色视觉设计师。给定广告概要、创意文案以及一份角色/模特列表，请为每个角色充实详细的外观描述，确保适合广告品质的 AI 视频生成。

对每个角色/模特，请扩展描述以包含：
- 体型和年龄外观（与目标消费群匹配）
- 发型和妆容（精致、符合广告美学）
- 服装要体现品牌调性（高端/休闲/运动/商务等）
- 肤质和状态（健康、光泽）
- 整体气质和姿态
- 色彩调性：与品牌色系协调
- AI 生成的风格关键词（如 "{styleKeywords}"）

广告概要：{synopsis}
创意文案：{script}

当前角色：
{characters}

仅输出合法 JSON：
{
  "characters": [
    {
      "name": "保持原始角色名称不变",
      "description": "增强后的详细视觉描述（80-150 词），广告品质"
    }
  ]
}

规则：
- 保持原始角色名称完全不变
- 不要增加或删除角色，只增强现有角色
- 描述必须纯粹是视觉方面的
- 外形须匹配产品的目标受众
- 使用英文撰写以获得最佳 AI 图像/视频生成效果`,

    enhanceShots: `你是一名广告分镜增强师。给定广告上下文和一组短片（镜头），为每个镜头添加适合商业广告的专业摄影元数据。

## 视觉规则
- 所有关键主体必须在安全区域内（2732x2048 画布中的 1920x1080）
- {styleNote}
- 画面以高质感、精致光影为基调

## 广告类型 → 摄影参考表
- 产品特写：微距, Static, 旋转台, 柔和棚灯, 高反差, 浅景深
- 使用场景：中景, Dolly In, 自然光, 生活化, 暖色调
- 模特展示：Tracking Shot, 中景→全身, 轮廓光, 时尚摄影风
- 品牌露出：Static, 居中构图, 干净背景, Logo 清晰
- 效果对比：分屏/切换, Before-After, 柔和过渡
- 情感渲染：慢动作, 特写, 浅景深, 温暖光线
- CTA 结尾：Static, 居中, 品牌色背景, 干净排版

## 镜头运动规则
- 产品镜头以 Static 和慢速旋转/推镜为主
- 模特镜头可用 Tracking 和 Arc
- 避免手持晃动（除非刻意营造生活感）
- 每个镜头一个主要运动方式

## 镜头增强规则
1. 一个镜头 = 一个主要卖点或情绪
2. 产品镜头必须光线充足、细节清晰
3. 色调须统一，体现品牌调性
4. 前 3 秒镜头必须有视觉冲击力
5. 镜头运动使用节奏词（缓慢/优雅/果断/流畅）

广告概要：{synopsis}
角色/模特：{characters}
产品/道具：{props}
场景：{scenes}

为每个短片判断镜头类型并应用上述摄影参考表。

仅输出合法 JSON：
{
  "shorts": [
    {
      "order": 1,
      "shotType": "product_closeup|lifestyle|model|brand|comparison|emotional|cta",
      "cameraMovement": "例如 Static 或 Dolly In, slow",
      "cameraAngle": "例如 Eye-level, Overhead",
      "lighting": "例如 Soft studio light, product rim light",
      "emotion": "例如 高端/精致",
      "stableVariables": ["product: silver bottle", "background: white marble", "lighting: studio"],
      "prompt": "增强后的 60-100 词视频提示词，广告品质，[产品/主体], [动作/展示方式], 在 [场景+光照], 镜头 [运动], 风格 [{styleKeywords}], avoid jitter, avoid motion blur"
    }
  ]
}`,
};

// ---- Interactive movie (branching plot with multiple endings) ----
const INTERACTIVE_PROMPTS = {
    ...ZH_PROMPTS,

    scriptAnalysis: `你是一名互动电影编剧与分镜策划师。根据用户提供的故事主题或剧本以及目标影片时长，构建一个**分支剧情图**：用户会在关键节点做出选择，不同选择通往不同后续剧情和结局。

用户会指定总影片时长（分钟）——这是主线+典型分支组合的大致时长。每个短片 5-15 秒。

**互动电影创作要点：**
- 剧情由一张**有向图**组成，节点 = 剧情段落；每个节点包含一段 1-6 个短片的连续镜头。
- 在分支节点结尾向观众展示 2-3 个"选项"（choices），每个选项指向一个 targetNodeId（下一个节点）。
- 存在至少 2 个不同的**结局节点**（endingType: good | bad | neutral）；结局节点不应再有 choices。
- 根节点 rootNodeId 为故事入口，只有一个。
- 推荐结构：2-4 层深度，总计 6-15 个节点。不要生成过深或无穷的链。
- 每个节点的 shortOrders 数组里列出属于该节点的短片 **order 编号**（从 shorts 数组中引用）。每个短片 order 只能出现在一个节点里。

仅输出合法 JSON：
{
  "title": "互动电影标题",
  "synopsis": "2-3 句话概述整个故事与核心抉择",
  "characters": [ { "name": "角色名", "description": "一句话简介" } ],
  "props": [ { "name": "道具名", "description": "一句话简介" } ],
  "scenes": [ { "name": "场景名", "description": "一句话简介" } ],
  "shorts": [
    {
      "order": 1,
      "sceneName": "对应场景名",
      "characterNames": ["对应角色名"],
      "propNames": ["对应道具名"],
      "prompt": "一句话描述该镜头内容",
      "duration": 5
    }
  ],
  "plot": {
    "rootNodeId": "n1",
    "nodes": [
      {
        "id": "n1",
        "name": "序幕",
        "parentId": null,
        "childIds": ["n2", "n3"],
        "shortOrders": [1, 2, 3],
        "choices": [
          { "label": "去森林调查", "targetNodeId": "n2" },
          { "label": "回家报警",   "targetNodeId": "n3" }
        ]
      },
      {
        "id": "n2",
        "name": "森林分支",
        "parentId": "n1",
        "childIds": ["n4"],
        "shortOrders": [4, 5],
        "choices": [ { "label": "继续深入", "targetNodeId": "n4" } ]
      },
      {
        "id": "n4",
        "name": "勇者结局",
        "parentId": "n2",
        "childIds": [],
        "shortOrders": [6, 7],
        "choices": [],
        "endingType": "good"
      }
    ]
  }
}

规则：
- 节点 id 使用短字符串（如 "n1"、"n2"），保持稳定；不得重复。
- 所有 choice.targetNodeId 都必须在 nodes 中存在。
- 每个叶子节点必须设置 endingType（good/bad/neutral）且 choices 为空数组。
- shortOrders 引用的 order 值必须在 shorts 数组中存在。
- 所有 shorts 的总时长应接近目标影片时长。
- 不要为同一个节点生成过多短片（建议 1-6 个）。
- 以英文撰写视频提示词（prompt）；其他字段使用用户语言。`,
};

// ---- Long interactive movie (multi-ACT with sine tension curve, nested branches converge/die) ----
const LONG_INTERACTIVE_PROMPTS = {
    ...ZH_PROMPTS,

    scriptAnalysis: `你是一名长篇互动电影编剧与分镜策划师。根据用户提供的故事主题或剧本以及目标影片时长，构建一个**多幕（ACT）+ 分支剧情图**。

**核心叙事模型（必须严格遵循）：**

1. **正弦张力曲线 / 主线脊柱 (spine)：**
   - 全片由多个 ACT（幕）顺序组成，每个 ACT 的戏剧张力呈一次正弦周期（setup → rising → peak → release → resolution）。
   - 所有 ACT 串联形成**主线脊柱**——这是一条不可中断的主剧情。
   - ACT 数量建议：短片 2-3 幕，中长片 3-5 幕，长片 5-7 幕。

2. **ACT 内分支 (branches)：**
   - 每个 ACT 内部可以有多条分支，分支之间可以**嵌套**（分支中再有子分支）。
   - 在 ACT 内部的张力曲线上，用户可在关键节点通过 choice 进入不同分支。
   - 分支结局有两种：
     - **die（死亡/失败/丢弃）**：该线戏剧性终结，用户被拉回上一个存活节点或 ACT 起点（由引擎决定，不需要在图中画回边）。该分支不向主线贡献状态。
     - **converge（汇入主线）**：该分支在 ACT 边界**合流**到下一 ACT 的入口节点，带着 stateDelta（对主线的贡献/影响）。
   - **每个 ACT 结束时所有存活分支必须 converge 到同一个 ACT 边界节点**（下一 ACT 的入口，或最终结局入口）。这是"汇聚门 (convergence gate)"。

3. **状态传递：**
   - 每个 converge 的分支可以在 stateDelta 中描述它对主线的影响（如"同伴活着"/"获得钥匙"/"失去信任"），供后续 ACT 引用。

4. **节点分类 (nodeKind)：**
   - "spine"  —— 主线骨干节点（ACT 入口、ACT 出口/汇聚门、最终结局）
   - "branch" —— ACT 内部分支节点（可嵌套）
   - "ending" —— 终结节点（good / bad / neutral）；只能出现在最后一个 ACT 之后，或作为 die 分支的可选显性结局

用户会指定总影片时长（分钟）——以主线 + 一次典型分支体验估算。每个短片 5-15 秒。

仅输出合法 JSON：
{
  "title": "长互动电影标题",
  "synopsis": "3-5 句话概述主线与核心抉择",
  "characters": [ { "name": "角色名", "description": "一句话简介" } ],
  "props": [ { "name": "道具名", "description": "一句话简介" } ],
  "scenes": [ { "name": "场景名", "description": "一句话简介" } ],
  "shorts": [
    {
      "order": 1,
      "sceneName": "对应场景名",
      "characterNames": ["对应角色名"],
      "propNames": ["对应道具名"],
      "prompt": "一句话描述该镜头内容",
      "duration": 5
    }
  ],
  "plot": {
    "rootNodeId": "act1_in",
    "acts": [
      {
        "id": "act1",
        "name": "第一幕：相遇",
        "tensionArc": "setup → rising → peak → release",
        "entryNodeId": "act1_in",
        "exitNodeId":  "act1_out",
        "nodeIds": ["act1_in", "b1_forest", "b1_town", "act1_out"]
      }
    ],
    "nodes": [
      {
        "id": "act1_in",
        "name": "序幕",
        "nodeKind": "spine",
        "actId": "act1",
        "parentId": null,
        "childIds": ["b1_forest", "b1_town"],
        "shortOrders": [1, 2],
        "choices": [
          { "label": "去森林调查", "targetNodeId": "b1_forest" },
          { "label": "先回城打探", "targetNodeId": "b1_town"   }
        ]
      },
      {
        "id": "b1_forest",
        "name": "森林遇险",
        "nodeKind": "branch",
        "actId": "act1",
        "parentId": "act1_in",
        "childIds": ["b1_forest_deep", "act1_out"],
        "shortOrders": [3, 4],
        "choices": [
          { "label": "深入险境",          "targetNodeId": "b1_forest_deep" },
          { "label": "带伤返回会合主线",   "targetNodeId": "act1_out",
            "outcome": "converge", "stateDelta": "主角负伤但知晓森林有异兽" }
        ]
      },
      {
        "id": "b1_forest_deep",
        "name": "独闯兽穴",
        "nodeKind": "branch",
        "actId": "act1",
        "parentId": "b1_forest",
        "childIds": [],
        "shortOrders": [5],
        "choices": [],
        "outcome": "die",
        "dieReason": "主角被困，探险线终结"
      },
      {
        "id": "b1_town",
        "name": "城中线索",
        "nodeKind": "branch",
        "actId": "act1",
        "parentId": "act1_in",
        "childIds": ["act1_out"],
        "shortOrders": [6, 7],
        "choices": [
          { "label": "带线索汇入主线", "targetNodeId": "act1_out",
            "outcome": "converge", "stateDelta": "获得委托人身份线索" }
        ]
      },
      {
        "id": "act1_out",
        "name": "第一幕汇聚：整装出发",
        "nodeKind": "spine",
        "actId": "act1",
        "isConvergenceGate": true,
        "parentId": null,
        "childIds": ["act2_in"],
        "shortOrders": [8],
        "choices": [ { "label": "进入第二幕", "targetNodeId": "act2_in" } ]
      },
      {
        "id": "final_good",
        "name": "光明结局",
        "nodeKind": "ending",
        "endingType": "good",
        "parentId": null,
        "childIds": [],
        "shortOrders": [20],
        "choices": []
      }
    ]
  }
}

规则：
- 至少 2 个 ACT；每个 ACT 的 entryNodeId 和 exitNodeId 必须都是 nodeKind: "spine" 的节点。
- 每个 ACT 的 exitNodeId 即为该幕的"汇聚门"，必须设置 isConvergenceGate: true。
- 所有 nodeKind: "branch" 的节点必须最终通过 converge 回到本幕的 exitNodeId，或设为 outcome: "die"。
- 允许分支嵌套，但同幕内建议最大嵌套深度 3 层，以控制复杂度。
- 每个 converge 选项建议提供简短 stateDelta 描述对主线的贡献。
- 每个 die 分支建议提供 dieReason 说明为何终结。
- 至少 1 个 nodeKind: "ending" 节点；若有多个结局，每个结局通过最后一幕的 choices 或状态差异触发。
- 节点 id 使用短字符串（act<N>_in / act<N>_out / b<N>_xxx / final_xxx）并保持唯一稳定。
- 所有 choice.targetNodeId 必须在 nodes 中存在；shortOrders 引用的 order 值必须在 shorts 中存在。
- 每个短片 order 只能出现在一个节点的 shortOrders 中。
- 所有 shorts 的总时长应接近 **一次主线 + 一条典型分支** 的预期时长（不是所有分支累加）。
- 不要为单个节点生成过多短片（建议 1-6 个）。
- 以英文撰写视频提示词（prompt）；其他字段使用用户语言。`,
};

export const PROMPT_PRESETS = {
    'zh': {
        label: '中文默认',
        lang: 'zh',
        prompts: ZH_PROMPTS,
    },
    'zh-interactive': {
        label: '互动电影（分支剧情）',
        lang: 'zh',
        prompts: INTERACTIVE_PROMPTS,
    },
    'zh-long-interactive': {
        label: '长互动电影（多幕+嵌套分支）',
        lang: 'zh',
        prompts: LONG_INTERACTIVE_PROMPTS,
    },
    'en': {
        label: 'English默认',
        lang: 'en',
        prompts: EN_PROMPTS,
    },
    'zh-picturebook': {
        label: '绘本故事',
        lang: 'zh',
        prompts: PICTUREBOOK_PROMPTS,
    },
    'zh-shortdrama': {
        label: '短剧',
        lang: 'zh',
        prompts: SHORTDRAMA_PROMPTS,
    },
    'zh-ad': {
        label: '广告',
        lang: 'zh',
        prompts: AD_PROMPTS,
    },
};

/**
 * Get a prompt template by task name and preset key.
 * Falls back to 'en' if the requested preset or task is missing.
 */
export function getPrompt(taskName, presetKey = 'zh') {
    const preset = PROMPT_PRESETS[presetKey];
    if (preset && preset.prompts[taskName]) return preset.prompts[taskName];
    return ZH_PROMPTS[taskName] || '';
}

/**
 * Get all prompt task names.
 */
export function getPromptTaskNames() {
    return Object.keys(EN_PROMPTS);
}

/**
 * Get available preset keys and labels for UI.
 */
export function getPromptPresetOptions() {
    return Object.entries(PROMPT_PRESETS).map(([key, val]) => ({ value: key, label: val.label }));
}

// Backward-compatible flat PROMPTS object (defaults to Chinese)
export const PROMPTS = ZH_PROMPTS;
