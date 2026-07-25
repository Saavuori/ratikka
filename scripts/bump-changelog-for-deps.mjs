// Inserts an automatic patch-release entry into CHANGELOG.md for a batch of
// dependency-update commits, and prints the new tag on stdout.
//
// Background: CHANGELOG.md is the single source of truth for the release tag
// (see docker-build.yml). Dependabot cannot write a changelog entry, so without
// this its merges would land on main and never ship -- the build is skipped
// whenever the top heading's tag already exists. This generates the entry so a
// dependency merge releases itself, and so the published changelog still
// records what actually shipped.
//
// Usage:
//   node scripts/bump-changelog-for-deps.mjs <date> <<< "$COMMIT_SUBJECTS"
// where COMMIT_SUBJECTS is one commit subject per line. Writes CHANGELOG.md in
// place. Prints the new tag (e.g. v0.46.1).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'CHANGELOG.md');

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
  console.error('usage: bump-changelog-for-deps.mjs <YYYY-MM-DD>  (subjects on stdin)');
  process.exit(2);
}

const subjects = fs.readFileSync(0, 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

if (subjects.length === 0) {
  console.error('no commit subjects on stdin; refusing to cut an empty release');
  process.exit(2);
}

const changelog = fs.readFileSync(FILE, 'utf8');

// Same pattern docker-build.yml greps with, so the two cannot disagree.
const headingRe = /^##\s*\[\s*v?(\d+)\.(\d+)\.(\d+)\s*\]/m;
const m = changelog.match(headingRe);
if (!m) {
  console.error('no "## [vX.Y.Z]" heading found at the top of CHANGELOG.md');
  process.exit(1);
}

const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
const nextVersion = `${major}.${minor}.${patch + 1}`;
const nextTag = `v${nextVersion}`;

// Strip the conventional-commit prefix; keep the human-readable remainder.
const bullets = subjects
  .map((s) => s.replace(/^(chore|ci|build|fix|feat)(\([^)]*\))?:\s*/i, ''))
  .map((s) => `- ${s}`)
  .join('\n');

const entry = `## [${nextTag}] - ${date}

### Changed
- **Dependency updates** (automated release — dependency merges carry no
  changelog entry of their own, and a merge whose CHANGELOG heading is
  unchanged never gets built):
${bullets.replace(/^/gm, '  ')}

---

`;

// Insert immediately above the current top entry.
const out = changelog.slice(0, m.index) + entry + changelog.slice(m.index);
fs.writeFileSync(FILE, out);

console.log(nextTag);
