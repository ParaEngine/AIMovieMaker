# AIMovieMaker Changelog

## 2026-04-22
- Add image generation module (`genImage.js`)
- Add hover preview for clips (`hoverPreview.js`)
- Add image clipboard support (`imageClipboard.js`)
- Add prompts editor UI (`promptsEditor.js`) with workspace-based prompt templates (EN/ZH defaults, ad, interactive, picturebook, shortdrama)
- Add `AGENTS.md` project agent configuration
- Update global settings, API, views, tree, state, config, and newproject modules

## 2026-04-21
- Add project export (`export.js`) and import (`import.js`) modules
- Add syncToGit skill (`.github/skills/syncToGit/SKILL.md`)
- Update API module, global settings, app initialization, storage, views, state, and plot settings

## 2026-04-20
- Add movie player module (`movieplayer.js`) for playback
- Add plot graph visualization (`plotgraph.js`)
- Add standalone player page (`player.html`)
- Update clip editor, API, config, generate, newproject, preview, prompts, state, storage, tree, plot settings, views, and design docs

## 2026-04-19
- feat: add subtitle generation options and integrate dialogue/narration fields
- Update clip editor, state, and views

## 2026-04-18
- Update views module

## 2026-04-17
- Add presets module (`presets.js`) for reusable configurations
- Add stats/analytics module (`stats.js`)
- Add dedicated view modules: `view_chars.js`, `view_props.js`, `view_scenes.js`, `view_shorts.js`
- Add plot settings view (`view_plot_settings.js`)
- Add prompts module (`prompts.js`) for AI prompt management
- Add getting started documentation (`docs/getting_started.md`)
- Major refactor across API, app, clip editor, generate, preview, global settings, newproject, config, state, storage, tree, utils, and views

## 2026-04-16
- Update API, config, newproject, state, and views modules

## 2026-04-15
- Add standalone `AIMovieMaker.html` entry point
- Add generation module (`generate.js`) for AI content generation
- Add global settings module (`global_settings.js`)
- Add MP4 to WebP converter (`mp4ToWebp.js`)
- Add preview module (`preview.js`)
- Add new project wizard (`newproject.js`)
- Update API, app, clip editor, config, state, storage, tree, views, and architecture/code-plan docs

## 2026-04-14
- Add voice type selector (`VoiceTypeSelector.js`)
- Update API, config, state, and views

## 2026-04-13 — Initial Release
- Project scaffolding with core modules: `api.js`, `app.js`, `config.js`, `state.js`, `storage.js`, `tree.js`, `utils.js`, `views.js`
- Main entry point (`index.html`)
- Add clip editor module (`clipeditor.js`)
- Add help/onboarding module (`help.js`)
- Add movie templates (`digitalhuman.aimovie.json`, `index.json`)
- Documentation: `architecture.md`, `code-plan.md`, `design.md`, `qa-report.md`, `readme.md`
