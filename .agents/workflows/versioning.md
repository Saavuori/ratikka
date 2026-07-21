---
description: how the version tagging and deployment pipeline works
---

# Version Tagging & Deployment

**`CHANGELOG.md` is the single source of truth for the version.** Every push to
`main` triggers a GitHub Actions workflow that:
1. Reads the release version from the top `## [vX.Y.Z]` heading in `CHANGELOG.md`
2. Tags the commit with that exact version — or skips the release if the tag
   already exists (i.e. the changelog version was not bumped)
3. Builds a unified Docker image (linux/amd64 and linux/arm64) with the version
   injected via build-args
4. Pushes to `ghcr.io` as a single container (Go backend serving embedded React
   frontend)

Because the tag is derived from the changelog heading, the deployed version and
the changelog can never drift: the running app always equals the changelog's
latest entry.

## Cutting a Release

To ship a new version, bump the top heading in `CHANGELOG.md` to the new version
and describe the change beneath it (see `/committing`). That's it — CI tags and
deploys that exact version on the next push to `main`.

- If the top heading is **new** (no matching tag yet) → CI creates the tag and
  releases.
- If the top heading is **unchanged** (tag already exists) → CI skips the build.
  So docs-only changes and follow-up commits do **not** mint spurious tags.

## Choosing the Version Number

Bump the heading from the current top entry using semantic versioning, guided by
the conventional-commit prefix of the change:

- `fix:` → patch bump (v0.0.1 → v0.0.2)
- `feat:` → minor bump (v0.0.2 → v0.1.0)
- `feat!:` / `BREAKING CHANGE:` → major bump (v0.1.0 → v1.0.0)

The prefix guides the number you write, but the **heading is authoritative** —
the tag matches whatever you put in `CHANGELOG.md`, so make sure the number is
right before merging.

## Do NOT

- Manually create git tags — CI creates them from the changelog heading
- Hardcode version strings anywhere — they are injected via build-args
- Write a heading whose number doesn't match the intended bump — the tag will
  match it verbatim

## Key Files

- `.github/workflows/docker-build.yml` — CI/CD pipeline (derive version from
  CHANGELOG → tag → build → push)
- `CHANGELOG.md` — the release version lives in the top `## [vX.Y.Z]` heading
- `Dockerfile` — accepts `VERSION`, `BUILD_DATE`, `GIT_SHA` build-args and
  compiles them into the Go binary
- `backend/internal/api/handlers.go` — `GET /api/v1/version` returns the injected
  version info
- `frontend/src/components/VersionBadge.tsx` — footer displays version fetched
  from `/api/v1/version`

## How Version is Surfaced

At Docker build time CI passes:
```
VERSION=v1.2.3
BUILD_DATE=2026-06-15T13:00:00Z
GIT_SHA=abc1234...
```

These become variables inside `api.Version`, `api.BuildDate`, `api.GitCommit`.
`GET /api/v1/version` returns them as JSON; the React UI footer displays them.

## Checking the Current Version

```bash
# What is released (git tag):
git describe --tags --abbrev=0

# What the changelog declares (must match the latest tag after a release):
grep -m1 -oP '^##\s*\[\s*v?\K[0-9]+\.[0-9]+\.[0-9]+' CHANGELOG.md
```
