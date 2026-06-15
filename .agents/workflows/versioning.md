---
description: how the automatic version tagging and deployment pipeline works
---

# Automatic Version Tagging

Every push to `main` triggers a GitHub Actions workflow that:
1. Bumps the semantic version tag based on conventional commit prefixes
2. Builds a unified Docker image (linux/amd64 and linux/arm64) with the version injected via build-args
3. Pushes to `ghcr.io` as a single container (Go backend serving embedded React frontend)

## Commit Message Rules

Use conventional commit prefixes — they control the version bump:

- `fix:` → patch bump (v0.0.1 → v0.0.2)
- `feat:` → minor bump (v0.0.2 → v0.1.0)
- `feat!:` or `BREAKING CHANGE:` → major bump (v0.1.0 → v1.0.0)
- anything else → patch bump

## Do NOT

- Manually create git tags — GitHub Actions does this
- Hardcode version strings anywhere — they are injected via build-args during Go build

## Key Files

- `.github/workflows/docker-build.yml` — CI/CD pipeline (tag → build → push)
- `Dockerfile` — accepts `VERSION`, `BUILD_DATE`, `GIT_SHA` build-args and compiles them into Go binary
- `backend/internal/api/handlers.go` — `GET /api/v1/version` returns the injected version info
- `frontend/src/components/VersionBadge.tsx` — footer displays version fetched from `/api/v1/version`

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
git describe --tags --abbrev=0
```
