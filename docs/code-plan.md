# AIMovieMaker — Code Plan

## Scope

Single HTML file (`AIMovieMaker.html`) implementing the full AI Movie Maker pipeline:

1. **Auth & Storage** — keepworkSDK login, personalPageStore CRUD for projects
2. **Script Analysis** — LLM GPT API call with structured JSON output
3. **Breakdown UI** — 3-column layout: characters, shorts timeline, scenes
4. **Image Upload** — Qiniu temp upload for character/scene reference images
5. **Video Generation** — Batch Seedance genVideo with concurrency limit of 2
6. **Movie Preview** — Sequential playback of all generated shorts

## Key Implementation Details

### Views (SPA routing via `navigateTo()`)
- `projectList` — Grid of saved projects from personalPageStore
- `scriptEditor` — Text area + settings + "AI Analyze" button
- `breakdown` — 3-column: characters | shorts timeline | scenes, with edit modals
- `generation` — Grid of short cards with status badges + progress bar
- `preview` — Main video player with thumbnail strip, continuous playback

### API Integration
- **LLM**: `POST /gpt/chat` with system prompt for structured JSON breakdown
- **Seedance**: `POST /genVideo` for submission, `GET /genVideo/task` for polling
- **Upload**: Qiniu temp image upload via `ts-storage` token endpoint

### State Management
- Global `state` object with reactive `token` getter from SDK
- Project data stored entirely in personalPageStore (no localStorage for project data)
- Polling intervals tracked in `state.pollingIntervals`

### Concurrency
- Max 2 simultaneous video generation tasks
- `tryGenerateNext()` called after each completion to queue next pending short

## Files Created
- `AIMovieMaker/AIMovieMaker.html` — Main app (single file, ~700 lines)
- `AIMovieMaker/docs/design.md` — Design document
- `AIMovieMaker/docs/architecture.md` — Architecture document
- `AIMovieMaker/docs/code-plan.md` — This file

## Open Issues
- AI image generation for characters/scenes not yet integrated (user must upload manually)
- No drag-and-drop reordering of shorts (can be added later)
- No export/download of final movie as single file (browser limitation)
