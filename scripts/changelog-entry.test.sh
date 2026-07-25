#!/usr/bin/env bash
# Tests for scripts/changelog-entry.js.
#
# Each case builds a throwaway git repo with a real remote (a bare repo), edits
# the manifests the way Renovate would — in the working tree, uncommitted — then
# runs the script and asserts what landed in CHANGELOG.md. Run from the
# repository root: scripts/changelog-entry.test.sh
#
# The last case runs derive-release.sh over the result: the generated heading is
# only useful if the release path actually reads it as a version to ship.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

ok()   { echo "ok: $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# Builds a fresh repo at $SANDBOX whose CHANGELOG top heading is $1, seeded with
# one of every manifest the script knows how to read, pushed to an origin remote.
setup() {
  local heading="$1"
  SANDBOX="$WORK/case-$RANDOM"
  rm -rf "$WORK/origin.git"; git init -q --bare -b main "$WORK/origin.git"

  git init -q -b main "$SANDBOX"
  cd "$SANDBOX" || exit 1
  git config user.email t@t; git config user.name t
  # Keeps a Windows checkout from drowning the output in LF/CRLF warnings.
  git config core.autocrlf false

  mkdir -p scripts backend frontend .github/workflows
  cp "$REPO_ROOT/scripts/changelog-entry.js" scripts/
  cp "$REPO_ROOT/scripts/derive-release.sh" scripts/
  cp "$REPO_ROOT/scripts/bump-changelog-for-deps.mjs" scripts/

  printf '# HSL-LIVE Changelog\n\nAll notable changes to this project will be documented in this file.\n\n## [%s] - 2026-01-01\n\n### Fixed\n- thing\n\n---\n\n## [v0.1.0] - 2025-01-01\n\n### Added\n- start\n' "$heading" > CHANGELOG.md

  cat > backend/go.mod <<'EOF'
module ratikka

go 1.26

require (
	github.com/redis/go-redis/v9 v9.21.0
	github.com/prometheus/client_golang v1.24.1
)
EOF

  cat > frontend/package.json <<'EOF'
{
  "name": "ratikka-frontend",
  "version": "0.0.0",
  "dependencies": {
    "maplibre-gl": "^5.24.0",
    "react": "^19.0.0"
  }
}
EOF

  cat > Dockerfile <<'EOF'
FROM --platform=$BUILDPLATFORM node:26-alpine AS frontend-builder
FROM golang:1.26-alpine AS backend-builder
FROM alpine:3.24
EOF

  cat > docker-compose.yml <<'EOF'
services:
  redis:
    image: redis:8-alpine
  alloy:
    image: docker.io/grafana/alloy:v1.18.0
EOF

  cat > .github/workflows/ci.yml <<'EOF'
jobs:
  backend:
    steps:
      - uses: actions/checkout@v7
EOF

  echo "readme" > README.md

  git add -A; git commit -qm "init"
  git remote add origin "$WORK/origin.git"
  git push -q -u origin main
}

run() { node scripts/changelog-entry.js 2>&1; }

# Asserts CHANGELOG.md contains (or, with -v, does not contain) a fixed string.
has() {
  local name="$1" needle="$2"
  if grep -qF -- "$needle" CHANGELOG.md; then ok "$name"; else
    bad "$name — CHANGELOG.md has no '$needle'"
    sed -n '1,20p' CHANGELOG.md | sed 's/^/    /'
  fi
}
hasnt() {
  local name="$1" needle="$2"
  if grep -qF -- "$needle" CHANGELOG.md; then
    bad "$name — CHANGELOG.md unexpectedly has '$needle'"
  else ok "$name"; fi
}

echo "--- changelog-entry.js ---"

# 1. The common case: Go and npm bumps in one branch.
setup "v0.2.0"
sed -i 's|go-redis/v9 v9.21.0|go-redis/v9 v9.22.0|' backend/go.mod
sed -i 's|"maplibre-gl": "\^5.24.0"|"maplibre-gl": "^5.25.0"|' frontend/package.json
run > /dev/null
has "predicts the base heading's patch + 1"  "## [v0.2.1]"
has "reports the Go bump"                    '`github.com/redis/go-redis/v9` 9.21.0 → 9.22.0'
has "reports the npm bump"                   '`maplibre-gl` 5.24.0 → 5.25.0'
has "keeps the release separator"            "---"
hasnt "ignores untouched dependencies"       "client_golang"
hasnt "ignores the package name/version keys" "ratikka-frontend"

# The previous top entry has to survive underneath the new one.
if grep -q '^## \[v0.2.0\]' CHANGELOG.md && \
   [ "$(grep -n '^## \[' CHANGELOG.md | head -1 | grep -c 'v0.2.1')" = "1" ]; then
  ok "inserts above the previous release, not below it"
else
  bad "insertion point wrong"; grep -n '^## \[' CHANGELOG.md | sed 's/^/    /'
fi

# 2. Renovate reruns this on every rebase — the entry must be replaced, not stacked.
run > /dev/null
if [ "$(grep -c '^## \[v0.2.1\]' CHANGELOG.md)" = "1" ]; then
  ok "rerun replaces its own entry instead of stacking a second"
else
  bad "rerun stacked $(grep -c '^## \[v0.2.1\]' CHANGELOG.md) copies"
fi
hasnt "rerun does not climb to the next version" "## [v0.2.2]"

# 3. Every other manifest the script claims to cover.
setup "v0.2.0"
sed -i 's|alpine:3.24|alpine:3.25|' Dockerfile
sed -i 's|redis:8-alpine|redis:8.1-alpine|' docker-compose.yml
sed -i 's|actions/checkout@v7|actions/checkout@v8|' .github/workflows/ci.yml
run > /dev/null
has "reports the Dockerfile base image"  '`alpine` 3.24 → 3.25'
has "reports the compose image"          '`redis` 8-alpine → 8.1-alpine'
has "reports the action bump"            '`actions/checkout` v7 → v8'

# 4. A branch with no dependency change must not invent a release.
setup "v0.2.0"
echo "a docs tweak" >> README.md
out="$(run)"
if [ "$(grep -c '^## \[' CHANGELOG.md)" = "2" ] && [[ "$out" == *"No dependency version changes"* ]]; then
  ok "non-dependency edits leave CHANGELOG.md alone"
else
  bad "invented an entry for a non-dependency edit — $out"
fi

# 5. The point of the whole thing: the generated heading has to be the one
#    derive-release.sh ships. Commit the branch as Renovate would and release it.
setup "v0.2.0"
sed -i 's|go-redis/v9 v9.21.0|go-redis/v9 v9.22.0|' backend/go.mod
run > /dev/null
git add -A; git commit -qm "chore(deps): update all non-major dependencies"
git push -q origin main
rel="$(GITHUB_OUTPUT=/dev/stdout bash scripts/derive-release.sh 2>&1)"
if printf '%s\n' "$rel" | grep -qx "released=true" && printf '%s\n' "$rel" | grep -qx "tag=v0.2.1"; then
  ok "derive-release.sh ships the generated heading as v0.2.1"
else
  bad "release path did not pick up the generated heading"; printf '%s\n' "$rel" | sed 's/^/    /'
fi

echo "--- $PASS passed, $FAIL failed ---"
[ "$FAIL" -eq 0 ]
