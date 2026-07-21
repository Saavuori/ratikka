---
description: how to commit and push code changes to GitHub
---

# Committing and Pushing Code

## Git Identity

Set git identity before committing if not already configured:

```powershell
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

## PowerShell Syntax

This machine runs PowerShell. The `&&` operator does NOT work on older versions of PowerShell. Chain commands with `;` instead:

```powershell
# Wrong
git add . && git commit -m "message"

# Right
git add .; git commit -m "message"
```

## Commit Message Convention

Use conventional commit prefixes (see `/versioning` workflow):

- `fix:` → patch bump
- `feat:` → minor bump
- `feat!:` → major bump

## Pushing to main

Pushing to `main` triggers the full CI/CD pipeline (derive version from CHANGELOG → tag → Docker build → release). See `/versioning` for details.

## Changelog Management

**`CHANGELOG.md` is the single source of truth for the release version** — CI tags each release from its top `## [vX.Y.Z]` heading, so the number you write there is exactly what gets deployed. Whenever a new feature is introduced (`feat:`) or a bug is resolved (`fix:`), you **must** update `CHANGELOG.md` in the **same** commit/PR:
1. Document the changes under the appropriate section (e.g. `### Added`, `### Fixed`, `### Changed`).
2. Add a new version heading `## [vX.Y.Z] - YYYY-MM-DD`, bumping from the current top entry per the conventional-commit rule (`fix:` → patch, `feat:` → minor, `feat!:` → major). This heading **is** the released version — the git tag will match it verbatim, so make sure the number is right before merging. See `/versioning`.
3. Bump the changelog version **once per release**. Follow-up commits that don't change the top heading (docs tweaks, review fixes on an unmerged branch) reuse it — CI only cuts a release when the heading is a version with no existing tag, so unchanged headings never mint spurious tags.
4. The `CHANGELOG.md` file is automatically parsed and deployed to GitHub Pages on every push to `main`.

If the running app's version (`GET /api/v1/version`) ever disagrees with the changelog's top heading, the heading is wrong: correct it to the tag that actually shipped rather than inventing a new number.

## Pull Requests

**Always open a pull request** for every change worked on a feature/fix branch — do not stop at pushing the branch. After pushing:
1. Open a PR targeting `main` with a clear title (reuse the conventional-commit subject) and a body summarizing what changed, why, and how it was verified (tests, build).
2. Ensure the branch already contains the required `CHANGELOG.md` update before opening the PR.
3. If a PR for the branch already exists, the push updates it — no need to open a second one.
