#!/usr/bin/env bash
# Decides whether the current commit should cut a release, and does it.
#
# CHANGELOG.md is the single source of truth for the version: the tag is
# whatever the top `## [vX.Y.Z]` heading says. Bump the heading to release; if
# the heading is unchanged the tag already exists and we skip the build.
#
# The exception is dependency updates. Dependabot cannot write a changelog
# entry, so without the fallback here its merges would land on main and never
# ship -- skipped precisely because the heading did not move. When every new
# commit since the current tag is a dependency update, this generates the
# entry, bumps the patch and releases.
#
# Writes `tag=` and `released=` to $GITHUB_OUTPUT (or stdout when unset, which
# is how the tests read it). Run from the repository root.
#
# Tests: scripts/derive-release.test.sh
set -euo pipefail

OUT="${GITHUB_OUTPUT:-/dev/stdout}"
emit() { echo "$1" >> "$OUT"; }

VERSION="$(grep -m1 -oP '^##\s*\[\s*v?\K[0-9]+\.[0-9]+\.[0-9]+' CHANGELOG.md || true)"
if [ -z "$VERSION" ]; then
  echo "::error::No version heading (## [vX.Y.Z]) found at the top of CHANGELOG.md"
  exit 1
fi
TAG="v${VERSION}"

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

# Normal path: the heading names a tag that does not exist yet.
if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Creating release tag ${TAG} from CHANGELOG.md"
  git tag -a "$TAG" -m "Release ${TAG}"
  git push origin "$TAG"
  emit "tag=${TAG}"
  emit "released=true"
  exit 0
fi

SUBJECTS="$(git log --no-merges --format=%s "${TAG}..HEAD")"
if [ -z "$SUBJECTS" ]; then
  echo "No new commits since ${TAG} — nothing to release."
  emit "tag=${TAG}"
  emit "released=false"
  exit 0
fi

# A single human commit in the batch means a human should write the entry, so
# fall back to the old skip-and-say-nothing behaviour.
NON_DEP="$(printf '%s\n' "$SUBJECTS" | grep -vP '^chore\(deps(-dev)?\):' || true)"
if [ -n "$NON_DEP" ]; then
  echo "Tag ${TAG} exists and the commits since it are not dependency-only:"
  printf '  %s\n' "$NON_DEP"
  echo "Skipping release — bump the CHANGELOG heading to ship these."
  emit "tag=${TAG}"
  emit "released=false"
  exit 0
fi

echo "Dependency-only commits since ${TAG}; cutting an automatic patch release."
NEW_TAG="$(printf '%s\n' "$SUBJECTS" \
  | node scripts/bump-changelog-for-deps.mjs "$(date -u +'%Y-%m-%d')")"

git add CHANGELOG.md
git commit -m "chore(release): ${NEW_TAG} (automated dependency release)"
git tag -a "$NEW_TAG" -m "Release ${NEW_TAG}"

# Atomic: the commit and its tag land together, so the workflow run triggered
# by this push always sees the tag already present and skips, instead of racing
# this run to build the same thing twice.
git push --atomic origin HEAD:main "refs/tags/${NEW_TAG}"

emit "tag=${NEW_TAG}"
emit "released=true"
