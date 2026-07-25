#!/usr/bin/env node
//
// Writes the CHANGELOG.md entry for an automated dependency-update branch.
//
// Runs as a Renovate postUpgradeTask (see renovate.json5). Renovate writes the
// manifest updates into the working tree and runs this *before* committing, so
// the pending diff is exactly the list of what changed — which is what this reads.
//
// This exists because CHANGELOG.md is the release trigger (see CLAUDE.md,
// "Versioning & Release"): a merge whose top heading did not move ships nothing.
// Writing the entry in the branch means a dependency PR releases itself through
// the ordinary path, rather than through the after-the-fact fallback in
// scripts/derive-release.sh. That fallback stays as a safety net for a branch
// whose entry never got written.
//
// Deriving the entry from the diff rather than from Renovate's own template data
// is deliberate: it keeps the script runnable and testable outside Renovate, and
// it survives changing (or dropping) the bot that calls it. The cost is the
// per-manifest patterns below, which have to be extended when a new kind of
// pinned version enters the repo.
//
// The text it produces is factual — what moved, and between which versions.
// Nothing here can know *why* a bump matters, which is the part this changelog is
// actually written for, so expand the wording by hand when an update deserves it.
//
// Tests: scripts/changelog-entry.test.sh

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const mdPath = path.join(__dirname, '../CHANGELOG.md');
const baseBranch = process.env.BASE_BRANCH || 'main';

function git(args) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

// Each entry turns a changed line into [name, version]. Anything that doesn't
// match is skipped, so unrelated edits inside these files are ignored rather than
// mistaken for a dependency.
const SOURCES = [
  {
    label: 'Go modules',
    covers: (file) => file === 'backend/go.mod',
    read: (line) => line.match(/^\s*([\w.\-]+\.[\w.\-/]+)\s+v(\S+)/),
  },
  {
    label: 'Frontend packages',
    covers: (file) => file === 'frontend/package.json',
    // The version guard keeps `"name": "ratikka-frontend"` and the scripts block
    // out of the entry — only values that start like a version count.
    read: (line) => line.match(/^\s*"([^"]+)":\s*"[~^]?(\d\S*)"/),
  },
  {
    label: 'GitHub Actions',
    covers: (file) => file.startsWith('.github/workflows/'),
    read: (line) => line.match(/uses:\s*([\w.\-]+\/[\w.\-/]+)@(\S+)/),
  },
  {
    label: 'Container images',
    covers: (file) => file === 'Dockerfile',
    read: (line) => line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?([^\s:]+):(\S+?)(?:\s+AS\s+\S+)?$/i),
  },
  {
    label: 'Deploy stack images',
    // docker-compose.yml and docker-compose.override.yml, both at the root.
    covers: (file) => /^docker-compose[\w.-]*\.ya?ml$/.test(file),
    read: (line) => line.match(/^\s*-?\s*image:\s*([^\s:]+):(\S+)/),
  },
];

// Renovate runs this before it commits, so the updates are unstaged. Falling back
// to the last commit covers running it by hand on an already-committed branch.
let diff = git('diff --unified=0');
if (!diff.trim()) diff = git('diff --unified=0 HEAD~1 HEAD');
if (!diff.trim()) {
  console.log('No pending changes found — leaving CHANGELOG.md alone.');
  process.exit(0);
}

const groups = new Map();
let source = null;

for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) {
    const file = line.slice(4).replace(/^b\//, '');
    source = SOURCES.find((s) => s.covers(file)) || null;
    continue;
  }
  if (!source || line.startsWith('+++') || line.startsWith('---')) continue;

  const added = line.startsWith('+');
  const removed = line.startsWith('-');
  if (!added && !removed) continue;

  const found = source.read(line.slice(1));
  if (!found) continue;

  const [, name, version] = found;
  if (!groups.has(source.label)) groups.set(source.label, new Map());
  const deps = groups.get(source.label);
  if (!deps.has(name)) deps.set(name, {});
  deps.get(name)[added ? 'to' : 'from'] = version;
}

// A name has to appear on both sides at a different version to be an upgrade:
// that drops added-and-removed noise and dependencies merely reordered in a file.
const bullets = [];
for (const [label, deps] of groups) {
  const moved = [...deps.entries()].filter(([, v]) => v.from && v.to && v.from !== v.to);
  if (moved.length === 0) continue;
  // A long tail buries the bumps worth reading, so cap the list.
  const shown = moved.slice(0, 8).map(([name, v]) => `\`${name}\` ${v.from} → ${v.to}`).join(', ');
  const rest = moved.length - 8;
  bullets.push(`- **${label} updated**: ${shown}${rest > 0 ? `, and ${rest} more` : ''}.`);
}

if (bullets.length === 0) {
  console.log('No dependency version changes recognised — leaving CHANGELOG.md alone.');
  process.exit(0);
}

// Predict the version the same way derive-release.sh's dependency fallback does:
// the base branch's top heading, patch + 1. Renovate's commits are all
// `chore(deps)`, which is never a feature or a breaking change.
//
// Read the heading from the base branch rather than the working copy: on a rerun
// the working copy already carries the entry from the previous run, and bumping
// off that would climb a version every time.
//
// Same pattern derive-release.sh greps with, so the two cannot disagree.
const HEADING = /^##\s*\[\s*v?(\d+)\.(\d+)\.(\d+)\s*\]/m;
const current = fs.readFileSync(mdPath, 'utf8');
// origin/ first: a local branch of the same name can be stale, and reading a
// stale base predicts a version that has already been released.
const base =
  git(`show origin/${baseBranch}:CHANGELOG.md`) || git(`show ${baseBranch}:CHANGELOG.md`) || current;

const found = base.match(HEADING);
if (!found) {
  console.error('No `## [vX.Y.Z]` heading found in the base CHANGELOG.md.');
  process.exit(1);
}
const [, major, minor, patch] = found;
const version = `v${major}.${minor}.${Number(patch) + 1}`;

const date = new Date().toISOString().slice(0, 10);
// The trailing `---` is this changelog's separator between releases.
const section = `## [${version}] - ${date}\n\n### Changed\n${bullets.join('\n')}\n\n---\n`;

// Idempotent: a rerun has to replace the section it wrote last time rather than
// stack a second copy on top. Deleting through to the next release heading takes
// the separator with it.
const lines = current.split('\n');
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start !== -1) {
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## [')) end++;
  lines.splice(start, end - start);
}

// Insert above the newest existing release, below the file's intro paragraph.
const firstRelease = lines.findIndex((l) => l.startsWith('## ['));
lines.splice(firstRelease === -1 ? lines.length : firstRelease, 0, ...section.split('\n'));

fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${version} entry covering ${bullets.length} dependency group(s).`);
