#!/usr/bin/env bash
# Tests for scripts/derive-release.sh.
#
# Each case builds a throwaway git repo with a real remote (a bare repo) so the
# script's tag/commit pushes are exercised for real, then asserts the tag= and
# released= it reports. Run from the repository root: scripts/derive-release.test.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

# Builds a fresh repo at $SANDBOX whose CHANGELOG top heading is $1, with an
# origin remote, and an initial release tag already pushed for $2 (if given).
setup() {
  local heading="$1" existing_tag="${2:-}"
  SANDBOX="$WORK/case-$RANDOM"
  mkdir -p "$SANDBOX"
  git init -q --initial-branch=main "$WORK/origin.git" --bare 2>/dev/null || {
    rm -rf "$WORK/origin.git"; git init -q --bare "$WORK/origin.git"
  }
  rm -rf "$WORK/origin.git"; git init -q --bare -b main "$WORK/origin.git"

  git init -q -b main "$SANDBOX"
  cd "$SANDBOX"
  git config user.email t@t; git config user.name t
  mkdir -p scripts
  cp "$REPO_ROOT/scripts/derive-release.sh" scripts/
  cp "$REPO_ROOT/scripts/bump-changelog-for-deps.mjs" scripts/
  printf '# Changelog\n\n## [%s] - 2026-01-01\n\n### Fixed\n- thing\n\n---\n\n## [v0.1.0] - 2025-01-01\n\n### Added\n- start\n' "$heading" > CHANGELOG.md
  git add -A; git commit -qm "init"
  git remote add origin "$WORK/origin.git"
  git push -q -u origin main
  if [ -n "$existing_tag" ]; then
    git tag -a "$existing_tag" -m "Release $existing_tag"
    git push -q origin "$existing_tag"
  fi
}

commit() { git commit -q --allow-empty -m "$1"; }

# Runs the script and asserts released= and (optionally) tag=.
expect() {
  local name="$1" want_released="$2" want_tag="${3:-}"
  local out rc
  out="$(GITHUB_OUTPUT=/dev/stdout bash scripts/derive-release.sh 2>&1)"; rc=$?
  local got_released got_tag
  got_released="$(printf '%s\n' "$out" | grep -oP '^released=\K.*' | tail -1)"
  got_tag="$(printf '%s\n' "$out" | grep -oP '^tag=\K.*' | tail -1)"

  if [ "$rc" -ne 0 ]; then
    echo "FAIL: $name — script exited $rc"; printf '%s\n' "$out" | sed 's/^/    /'
    FAIL=$((FAIL+1)); return
  fi
  if [ "$got_released" != "$want_released" ]; then
    echo "FAIL: $name — released: want '$want_released', got '$got_released'"
    printf '%s\n' "$out" | sed 's/^/    /'
    FAIL=$((FAIL+1)); return
  fi
  if [ -n "$want_tag" ] && [ "$got_tag" != "$want_tag" ]; then
    echo "FAIL: $name — tag: want '$want_tag', got '$got_tag'"
    FAIL=$((FAIL+1)); return
  fi
  echo "ok: $name (released=$got_released tag=$got_tag)"
  PASS=$((PASS+1))
}

echo "--- derive-release.sh ---"

# 1. Human bumped the heading to a tag that does not exist yet -> release it.
setup "v0.2.0"
expect "heading bumped -> releases that version" true v0.2.0

# 2. Heading unchanged, nothing new since the tag -> nothing to do.
setup "v0.2.0" "v0.2.0"
expect "no new commits -> no release" false v0.2.0

# 3. Heading unchanged, only dependency commits -> automatic patch release.
setup "v0.2.0" "v0.2.0"
commit "chore(deps): bump go-redis from 9.21.0 to 9.22.0"
commit "chore(deps-dev): bump vite from 8.0.16 to 8.1.0"
expect "dependency-only -> auto patch release" true v0.2.1

# 4. Heading unchanged, a human commit in the batch -> stay out of the way.
setup "v0.2.0" "v0.2.0"
commit "chore(deps): bump go-redis from 9.21.0 to 9.22.0"
commit "fix(map): something a human wrote"
expect "mixed batch -> no release" false v0.2.0

# 5. The auto-release commit must not itself trigger another release.
setup "v0.2.0" "v0.2.0"
commit "chore(deps): bump something"
GITHUB_OUTPUT=/dev/null bash scripts/derive-release.sh >/dev/null 2>&1
expect "re-run after auto-release -> no second release" false

# 6. The generated entry must be readable by the same grep the workflow uses.
if grep -m1 -oP '^##\s*\[\s*v?\K[0-9]+\.[0-9]+\.[0-9]+' CHANGELOG.md | grep -qx "0.2.1"; then
  echo "ok: generated heading is parseable as 0.2.1"; PASS=$((PASS+1))
else
  echo "FAIL: generated heading not parseable"; FAIL=$((FAIL+1))
fi

# 7. The commit and tag must have landed on the remote together.
if git -C "$WORK/origin.git" rev-parse v0.2.1 >/dev/null 2>&1 &&
   [ "$(git -C "$WORK/origin.git" rev-parse v0.2.1^{commit})" = "$(git -C "$WORK/origin.git" rev-parse main)" ]; then
  echo "ok: tag and main pushed atomically to the same commit"; PASS=$((PASS+1))
else
  echo "FAIL: tag/main mismatch on remote"; FAIL=$((FAIL+1))
fi

echo "--- $PASS passed, $FAIL failed ---"
[ "$FAIL" -eq 0 ]
