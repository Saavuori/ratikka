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

Pushing to `main` triggers the full CI/CD pipeline (auto-tag → Docker build → release). See `/versioning` for details.

## Changelog Management

Whenever a new feature is introduced (`feat:`) or a bug is resolved (`fix:`), you **must** update the `CHANGELOG.md` at the root of the repository. This is not optional — every `feat:`/`fix:` change ships with a matching changelog entry in the **same** commit/PR:
1. Document the changes under the appropriate section (e.g. `### Added`, `### Fixed`, `### Changed`).
2. Add a new version heading like `## [vX.Y.Z] - YYYY-MM-DD`, bumping from the current top entry per the conventional-commit rule (`fix:` → patch, `feat:` → minor, `feat!:` → major). See `/versioning`.
3. The `CHANGELOG.md` file is automatically parsed and deployed to GitHub Pages on every push to `main`.

## Pull Requests

**Always open a pull request** for every change worked on a feature/fix branch — do not stop at pushing the branch. After pushing:
1. Open a PR targeting `main` with a clear title (reuse the conventional-commit subject) and a body summarizing what changed, why, and how it was verified (tests, build).
2. Ensure the branch already contains the required `CHANGELOG.md` update before opening the PR.
3. If a PR for the branch already exists, the push updates it — no need to open a second one.
