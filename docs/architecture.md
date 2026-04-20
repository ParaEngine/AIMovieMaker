# AIMovieMaker — Architecture Document (v2)

## File / Directory Structure

```
AIMovieMaker/
├── AIMovieMaker.html              # Entry point: HTML structure + CSS + script imports
├── js/
│   ├── config.js           # Constants, API endpoints, AI prompts
│   ├── utils.js            # Helpers: escapeHtml, showToast, DOM utils
│   ├── state.js            # Global state object + helpers
│   ├── storage.js          # personalPageStore CRUD
│   ├── api.js              # LLM chat, Seedance genVideo, image upload
│   ├── tree.js             # Tree view component for breakdown
│   ├── views.js            # View renderers (projectList, scriptEditor, breakdown, generation, preview)
│   └── app.js              # Main entry: init, auth, navigation, event wiring
├── readme.md
└── docs/
    ├── design.md
    ├── architecture.md
    ├── code-plan.md
    └── qa-report.md
```

All JS files use **ES module** syntax (`import`/`export`). Loaded via `<script type="module" src="js/app.js">` in AIMovieMaker.html. No build step required — works when served over HTTP.

## Module Dependency Graph

```
app.js
 ├── config.js
 ├── utils.js
 ├── state.js
 ├── storage.js  (imports config, state, utils)
 ├── api.js      (imports config, state, utils)
 ├── tree.js     (imports config, state, utils, api)
 └── views.js    (imports config, state, utils, storage, api, tree)
```

## Data Flow

```
User Script + Total Duration (1-90 min)
    │
    ▼
LLM Analysis → { synopsis, characters[], scenes[], shorts[] }
    │
    ▼
Tree View (left) ←→ Detail Editor (right)
    │                     │
    │   ← select node ──  │
    │   ── show detail →   │
    │
    ▼  (per node "regenerate")
Regeneration Modal → user edits prompt → LLM call → update node
    │
    ▼  (per short, batch)
Seedance genVideo API → taskId → poll → videoUrl
    │
    ▼
Movie Preview
```

## Tree Component Architecture

The tree renders the story structure in the left panel of the breakdown view.

### Tree Node Types

| Type | Label | Editable Fields | Regeneration Scope |
|------|-------|----------------|-------------------|
| `root` | Movie Title | title | Regenerate all children |
| `synopsis` | 概要 | synopsis text | Regenerate synopsis only |
| `characters-group` | 角色 | — | Regenerate all characters |
| `character` | [name] | name, description, imageUrl | Regenerate this character |
| `scenes-group` | 场景 | — | Regenerate all scenes |
| `scene` | [name] | name, description, imageUrl | Regenerate this scene |
| `shorts-group` | 分镜 | — | Regenerate all shorts |
| `short` | #[order] | prompt, sceneId, characterIds, duration, ratio, imageUrls | Regenerate this short |

### Regeneration Flow

1. User clicks 🔄 icon on a tree node
2. Modal opens with pre-filled AI prompt (editable textarea)
3. User optionally modifies the prompt
4. Click "生成" → LLM API call with project context
5. Parse JSON response → update node data
6. Re-render tree + detail panel
7. Auto-save to personalPageStore

## State Object

```javascript
{
    currentView: 'projectList',
    projects: [],
    currentProject: null,
    selectedNodeId: null,     // currently selected tree node
    selectedNodeType: null,   // type of selected node
    treeExpanded: {},         // { nodeId: boolean } collapse/expand state
    apiBase: '...',
    pollingIntervals: {},
}
```

## Technology Choices

| Choice | Rationale |
|--------|-----------|
| ES modules (no bundler) | Clean separation, works over HTTP, standard JS |
| Tailwind CSS CDN | Consistent with repo |
| keepworkSDK global | Auth + persistence |
| CSS custom properties | Dark/light theming |
| No framework | Plain DOM — repo convention |

## Integration Points

Same as v1: keepworkSDK personalPageStore, GPT API, Seedance API, Qiniu upload.

## Key Changes from v1

1. **Multi-file architecture** — Single HTML split into HTML + 8 JS modules
2. **Total duration input** — 1–90 min slider in script editor, passed to LLM analysis
3. **Tree-based breakdown view** — Replaces 3-column layout with tree + detail editor
4. **Node-level AI regeneration** — Any node can be regenerated with customizable prompts
5. **Synopsis field** — New project field for story summary

## Milestones

1. **M1: File structure + config + utils** — Create JS modules, refactor AIMovieMaker.html
2. **M2: State + Storage + API** — Extract and verify core logic
3. **M3: Views + Tree component** — New breakdown view with tree
4. **M4: Regeneration system** — Per-node AI regeneration with prompt editing
5. **M5: Duration input** — Total duration slider in script editor
6. **M6: Integration test** — End-to-end flow verification
