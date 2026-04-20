# AIMovieMaker — Design Document (v2)

## Overview

| Field | Value |
|-------|-------|
| **Name** | AIMovieMaker |
| **Purpose** | Turn user scripts into AI-generated movie shorts using Seedance video generation API |
| **Platform** | Browser (HTML + ES modules, no build step) |
| **Target Users** | Keepwork users who want to create short movie clips from text scripts |
| **Project Dir** | `maisi/maisi/webgames/tools/AIMovieMaker/` |

## Core Functionality

### Script-to-Movie Pipeline

1. **Login** — User logs in with Keepwork account (keepworkSDK `sdk.login()`).
2. **Script Input** — User pastes or types a movie script and specifies **total movie duration** (1–90 minutes).
3. **AI Script Analysis** — LLM breaks the script into structured data considering the target duration:
   - **Synopsis** — short summary of the story
   - **Characters** — name, description, visual appearance prompt
   - **Scenes** — setting description, mood, lighting
   - **Shorts** — ordered clips (5–15 s each), quantity scaled to approximate total duration
4. **Breakdown View with Tree** — Left panel shows a **tree view** of the story hierarchy. Right panel shows detail editor for the selected node. All text content supports:
   - **AI Regeneration** — click regenerate on any node to re-generate it (and optionally its children) via LLM
   - **Custom Prompt Editing** — user can modify the AI prompt before regenerating
   - **Direct Editing** — user can manually edit any field
5. **Batch Video Generation** — Submit each short to Seedance `genVideo` API.
6. **Preview** — Sequential playback of all generated clips.

### Tree-Based Story Editing

The breakdown view displays a hierarchical tree on the left:

```
▼ 📽️ [Movie Title]
  ├─ 📝 概要 (Synopsis)
  ├─ ▼ 👥 角色 (Characters)
  │   ├─ 角色1
  │   └─ 角色2
  ├─ ▼ 🎬 场景 (Scenes)
  │   ├─ 场景1
  │   └─ 场景2
  └─ ▼ 📋 分镜 (Shorts)
      ├─ #1 [prompt preview]
      └─ #2 [prompt preview]
```

**Regeneration rules:**
- Regenerating a group node (e.g., "角色") regenerates all its children
- Regenerating a leaf node (e.g., a specific character) regenerates only that item
- Before regenerating, user can view/edit the AI prompt in a modal
- After regeneration, results appear in the detail panel for further editing

### Data Persistence (personalPageStore)

All project data saved to keepworkSDK `personalPageStore` under page `aiMovieMaker`.

## State Machine / Lifecycle

```
[idle] → (paste script + set duration) → [script_ready]
       → (analyze) → [analyzing]
       → (AI returns breakdown) → [editing]
       → (user edits / regenerates nodes) → [editing]
       → (generate videos) → [generating]
       → (all videos done) → [completed]
```

## UI / UX Requirements

### Screens

1. **Project List** — Shows saved projects. "New Project" button.
2. **Script Editor** — Text area for script + **total duration slider/input** (1–90 min) + generation settings.
3. **Breakdown View** — Two-column layout:
   - Left: Tree view of story hierarchy with expand/collapse and regenerate actions
   - Right: Detail editor for selected node (name, description, prompt, image, duration)
4. **Generation Dashboard** — Grid of short cards with status + progress bar.
5. **Movie Preview** — Sequential playback.

### Responsive

- Desktop-first. Dark/light theme auto by time of day.

## Data Model

### Project
```json
{
  "id": "UUID",
  "title": "string",
  "script": "string",
  "synopsis": "string",
  "totalDuration": "number (1-90, minutes)",
  "status": "idle|analyzing|editing|generating|completed",
  "settings": {
    "ratio": "16:9",
    "model": "seedance-2.0",
    "generateAudio": true,
    "defaultDuration": 5
  },
  "characters": [Character],
  "scenes": [Scene],
  "shorts": [Short],
  "createdAt": "number",
  "updatedAt": "number"
}
```

### Character / Scene / Short — same as v1, unchanged.

## External Dependencies

| Dependency | Usage |
|------------|-------|
| keepworkSDK | Auth (login/logout), personalPageStore, token |
| Seedance API | Video generation + polling |
| keepwork GPT API | LLM script analysis + node regeneration |
| Qiniu temp upload | Reference image uploads |
| Tailwind CSS CDN | Styling |

## Acceptance Criteria

1. User can log in with Keepwork account.
2. User can specify total movie duration (1–90 minutes).
3. AI analysis produces breakdown scaled to the target duration.
4. Breakdown view shows a tree structure on the left with all story elements.
5. Any tree node can be selected to show/edit its detail on the right.
6. Any tree node supports AI regeneration with customizable prompts.
7. Regenerating a group node regenerates all its children.
8. User can manually edit any generated content.
9. Architecture is HTML + multiple ES module JS files (no build step needed).
10. All other existing features (video generation, preview, persistence) continue to work.

## Prompt Presets (Narrative Models)

Prompt presets are defined in `js/prompts.js` and selected via global/project setting `promptPreset`. Each preset overrides `scriptAnalysis` and optionally the enhance-stage prompts, producing different structures from the same user script.

| Key | Label | Output shape | Notes |
|-----|-------|--------------|-------|
| `zh` | 中文默认 | flat `shorts[]` | Default linear movie breakdown |
| `en` | English default | flat `shorts[]` | English variant of default |
| `zh-picturebook` | 绘本故事 | flat `shorts[]` | Cute, slow, child-safe cinematography |
| `zh-shortdrama` | 短剧 | flat `shorts[]` | Vertical short drama with dialogue/reaction beats |
| `zh-ad` | 广告 | flat `shorts[]` | Product/brand emphasis, hook + CTA |
| `zh-interactive` | 互动电影（分支剧情） | flat `shorts[]` + `plot` (single-layer branching graph) | Simple branching with multiple endings |
| `zh-long-interactive` | 长互动电影（多幕+嵌套分支） | flat `shorts[]` + `plot` (ACTs + nested branches) | Long-form narrative model, see below |

### Long Interactive Model

The long-interactive preset encodes a classic dramatic-structure intuition:

- **Tension = sine curve.** Each ACT is one period of a sine wave (`setup → rising → peak → release → resolution`).
- **Main plot = spine.** ACTs are linked linearly by spine nodes (entry and exit of each act). The spine is unbreakable.
- **Branches live inside an ACT.** They can nest, but by the end of the act every surviving branch must collapse back into the spine.
- **Two branch outcomes:**
  - `converge` — merges into the next ACT's entry via the current ACT's exit **convergence gate**, optionally carrying a `stateDelta` contribution to the main plot.
  - `die` — branch terminates dramatically with a `dieReason`; engine pulls the user back to the nearest live spine node. No contribution.
- **Endings** are `nodeKind: "ending"` nodes after the final ACT (`good | bad | neutral`).

#### Plot data model

```jsonc
{
  "plot": {
    "rootNodeId": "act1_in",
    "acts": [
      {
        "id": "act1",
        "name": "string",
        "tensionArc": "setup → rising → peak → release",
        "entryNodeId": "act1_in",
        "exitNodeId":  "act1_out",
        "nodeIds": ["act1_in", "...", "act1_out"]
      }
    ],
    "nodes": [
      {
        "id": "string",
        "name": "string",
        "nodeKind": "spine | branch | ending",
        "actId": "act1",                      // except endings may be null
        "isConvergenceGate": true,            // only on act exit spine nodes
        "parentId": "string | null",
        "childIds": ["string"],
        "shortOrders": [1, 2],                // references into shorts[]
        "choices": [
          {
            "label": "string",
            "targetNodeId": "string",
            "outcome": "converge",            // optional; on branch → spine transitions
            "stateDelta": "string"            // optional; carried into main plot
          }
        ],
        "outcome":   "die",                   // only on terminal branch nodes
        "dieReason": "string",                // paired with outcome: die
        "endingType": "good | bad | neutral"  // only on nodeKind: ending
      }
    ]
  }
}
```

#### Structural rules the LLM must follow

1. ≥ 2 ACTs; every ACT has `entryNodeId` and `exitNodeId`, both `nodeKind: "spine"`.
2. Each ACT's `exitNodeId` is the act's **convergence gate** (`isConvergenceGate: true`).
3. Every `nodeKind: "branch"` node eventually either `converge`s to its act's `exitNodeId` or sets `outcome: "die"`.
4. Nested branches are allowed; recommended max nesting depth 3 per act.
5. ≥ 1 `nodeKind: "ending"` node after the final ACT. Multiple endings are triggered by final-act `choices` and/or accumulated `stateDelta`.
6. Total `shorts` duration budgets **one main playthrough** (spine + one typical branch path), not the sum of every possible path.
7. Every `choice.targetNodeId` must exist in `nodes`; every `shortOrders` entry must exist in `shorts`; each short `order` appears in exactly one node's `shortOrders`.

Downstream players/editors may visualize this as a graph where horizontal axis = ACT progression and vertical excursions = nested branches that either snap back to the spine (converge) or terminate (die).

