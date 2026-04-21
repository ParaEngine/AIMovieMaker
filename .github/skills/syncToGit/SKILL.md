---
name: syncToGit
description: Sync AIMovieMaker changes between the maisi monorepo subfolder and the standalone git repo. Use when: the user wants to push AIMovieMaker changes to GitHub, pull updates from the standalone repo into the monorepo copy, or keep the two directories in sync. Keywords: sync, git, push, pull, copy, deploy, AIMovieMaker.
---

# syncToGit — Sync AIMovieMaker Between Monorepo and Standalone Repo

## Context

AIMovieMaker exists in two locations backed by **separate git repos on different hosts**:

| Label | Path | Git Remote |
|-------|------|------------|
| **Monorepo copy** | `<workspace_parent>/maisi/maisi/webgames/tools/AIMovieMaker` | `https://git.keepwork.com/maisi/maisi` (part of maisi monorepo) |
| **Standalone repo** | `<workspace_parent>/AIMovieMaker` | `https://github.com/ParaEngine/AIMovieMaker.git` (GitHub) |

`<workspace_parent>` is the common parent of the workspace roots (typically `c:\lxzsrc`).

The monorepo copy is nested inside `maisi` (hosted on git.keepwork.com) and is where day-to-day edits happen alongside the rest of the maisi site. The standalone repo is a separate GitHub clone used for publishing to the public.

## Sync Workflow

### 0. Pre-flight: Commit and Pull Both Repos

Before any sync operation, ensure both repos have a clean working tree and are up to date:

```
# Monorepo (maisi) — commit any pending AIMovieMaker changes
cd <workspace_parent>\maisi
git add maisi/maisi/webgames/tools/AIMovieMaker
git status
# If there are staged changes, commit them:
git commit -m "save AIMovieMaker changes before sync"
git pull origin main

# Standalone repo — commit any pending changes and pull
cd <workspace_parent>\AIMovieMaker
git add -A
git status
# If there are staged changes, commit them:
git commit -m "save changes before sync"
git pull origin main
```

- Show `git status` output for both repos to the user before committing.
- If either working tree is already clean, skip the commit for that repo.
- If `git pull` produces merge conflicts, stop and resolve them before continuing.

### 1. Determine Sync Direction

Ask the user (or infer from context) which direction:

- **monorepo → standalone** (most common): push local edits out to GitHub.
- **standalone → monorepo**: pull upstream changes into the monorepo working copy.

### 2. Monorepo → Standalone (Push to GitHub)

```
# Step 1 — Copy changed files from monorepo copy to standalone repo
#   Exclude .git/, node_modules/, and any build artifacts
robocopy "<workspace_parent>\maisi\maisi\webgames\tools\AIMovieMaker" "<workspace_parent>\AIMovieMaker" /MIR /XD .git node_modules dist .github /XF .gitignore /NFL /NDL /NJH /NJS

# Step 2 — Review changes in the standalone repo
cd <workspace_parent>\AIMovieMaker
git status
git diff

# Step 3 — Commit and push (ask user for commit message)
git add -A
git commit -m "<message>"
git push origin main
```

**Important:** Always show `git status` / `git diff` output to the user and get confirmation before committing and pushing.

### 3. Standalone → Monorepo (Pull from GitHub)

```
# Step 1 — Pull latest in the standalone repo
cd <workspace_parent>\AIMovieMaker
git pull origin main

# Step 2 — Copy updated files into the monorepo copy
#   Exclude .git/, node_modules/, and build artifacts
robocopy "<workspace_parent>\AIMovieMaker" "<workspace_parent>\maisi\maisi\webgames\tools\AIMovieMaker" /MIR /XD .git node_modules dist .github /XF .gitignore /NFL /NDL /NJH /NJS

# Step 3 — Verify in monorepo
cd <workspace_parent>\maisi\maisi\webgames\tools\AIMovieMaker
git diff   # (this is the maisi repo's diff)
```

### 4. Conflict / Divergence Handling

If both locations have been edited independently:

1. Pull latest into the standalone repo first.
2. Use `robocopy` to copy monorepo → standalone (this overwrites standalone with monorepo edits).
3. In the standalone repo, use `git diff` to review the combined result.
4. Resolve any issues, then commit and push.
5. Copy back standalone → monorepo to ensure both are identical.

## Excluded Paths

Always exclude these from the copy:

- `.git/` — each location has its own git history
- `.github/` — monorepo-specific skills and config
- `node_modules/`, `dist/` — build artifacts
- `.gitignore` — may differ between the two locations

## Safety Rules

- **Never** push without showing the user the diff and getting confirmation.
- **Never** delete the `.git` directory in either location.
- **Never** run `git push --force` unless the user explicitly requests it.
- Default branch is `main`; confirm with user if unsure.