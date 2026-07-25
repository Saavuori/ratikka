# Tech Stack Analysis & Upgrade Plan

Snapshot taken 2026-07-25 against `main` (`8dbe67e`).

This document inventories every moving part of the stack, states what is
current vs. behind, and — for each proposed change — what the *effect* is:
what breaks, what improves, and how much work it is.

---

## 1. Summary

The stack is in good shape. Go 1.26, React 19, Vite 8, TypeScript 6 and
ESLint 10 are all current majors — there is no "legacy debt" pile here.
What is behind falls into four buckets:

| Bucket | Items | Risk if ignored |
| --- | --- | --- |
| **Security-relevant** | `golang.org/x/net`, `postcss`, `brace-expansion`, Alpine 3.21 | Low today (see reachability notes), rising over time |
| **Routine minor/patch drift** | go-redis, prometheus, coder/websocket, paho, React patch | None — pure upkeep |
| **One real major** | MapLibre GL 5 → 6 | Deferred cost; v5 stops getting fixes eventually |
| **Process gaps** (highest value) | CI runs **no tests**, `go test ./...` fails on a clean checkout, no `npm test` script, no Dependabot, unpinned `alloy:latest` | Regressions ship straight to production |

**Recommendation:** do the process gaps first (§6). They are cheap, and they
are what makes every dependency bump after them safe to merge.

---

## 2. Backend — Go

`backend/go.mod`, module `ratikka`, `go 1.26`.

### Direct dependencies

| Module | Current | Latest | Gap | Effect of upgrading |
| --- | --- | --- | --- | --- |
| `github.com/coder/websocket` | v1.8.12 | v1.8.15 | 3 patches | Bug fixes only, no API change. Drop-in. |
| `github.com/eclipse/paho.mqtt.golang` | v1.5.0 | v1.5.1 | 1 patch | Bug fixes only. Drop-in. |
| `github.com/prometheus/client_golang` | v1.23.2 | v1.24.1 | 1 minor | Additive. Metric names/registration API unchanged. Drop-in. |
| `github.com/redis/go-redis/v9` | v9.7.1 | v9.21.0 | 14 minors | Biggest single hop. See below. |

### Notable indirect dependencies

| Module | Current | Latest | Why it matters |
| --- | --- | --- | --- |
| `golang.org/x/net` | v0.43.0 | v0.57.0 | Carries the 2026 CVE set (`x/net/html` parser DoS, `x/net/idna` Punycode acceptance), fixed in **v0.55.0**. |
| `golang.org/x/sync` | v0.13.0 | v0.22.0 | Provides `singleflight`, which the API layer imports **directly**. |
| `golang.org/x/sys` | v0.35.0 | current | Transitive only. |
| `prometheus/common`, `prometheus/procfs` | v0.66.1 / v0.16.1 | v0.70.1 / v0.21.1 | Pulled up automatically by client_golang. |
| `github.com/golang/protobuf` | v1.5.0 | **deprecated** | Legacy shim, reached only via prometheus. Disappears as prometheus updates. |

#### go-redis v9.7.1 → v9.21.0 — what actually changes

This looks alarming (14 minor versions) but the blast radius here is tiny.
`internal/cache/redis.go` uses only `redis.ParseURL`, `redis.NewClient`, and
basic string/hash commands. None of the changes across that range touch those:

- **Minimum Go bumped to 1.21** (v9.18) — already satisfied, we're on 1.26.
- `UnstableResp3` deprecated to a no-op — not used here.
- `SlaveOf` → `ReplicaOf`, `SETNX` now issued as `SET … NX` — not used here.
- Additive: RESP3 search parsing, maintenance push notifications,
  OpenTelemetry metrics, zero-copy `GetToBuffer`/`SetFromBuffer`.

**Effect:** expected to be a pure drop-in. The one thing worth a look
afterwards is `GetToBuffer`/`SetFromBuffer` — the live-coordinate cache is a
hot read path, and zero-copy reads would cut per-message allocations. That is
an *optional follow-up*, not part of the upgrade.

#### `golang.org/x/net` — reachability matters

`go mod why` resolves it as:

```
ratikka/internal/mqtt → github.com/eclipse/paho.mqtt.golang → golang.org/x/net/proxy
```

Only `x/net/proxy` is on the import path. The 2026 CVEs are in `x/net/html`
and `x/net/idna`, **neither of which this binary links**. So the practical
exposure today is nil — but scanners (Trivy, Grype, GHCR/Dependabot alerts)
flag by module version, not by reachability, so the report will stay red until
it moves.

**Effect of bumping to ≥ v0.55.0:** clears the scanner noise, zero code change.
It is an indirect dep, so it needs an explicit `go get golang.org/x/net@latest`
— a plain `go mod tidy` will not raise it on its own.

#### `golang.org/x/sync` is mislabelled

`internal/api/handlers.go:15` imports `golang.org/x/sync/singleflight`
directly, but `go.mod` lists the module in the `// indirect` require block.
`go mod tidy` will move it into the direct block. Cosmetic, but it means the
file currently misrepresents the dependency surface.

### Go toolchain

`go 1.26` in `go.mod`, `golang:1.26-alpine` in the Dockerfile — aligned and
current. No `toolchain` directive, which is fine; it just means contributors
need a ≥1.26 local toolchain.

⚠️ **`govulncheck` cannot currently scan this module.** The released
`golang.org/x/vuln` builds against Go 1.25, and refuses to load packages that
declare `go 1.26`:

```
package requires newer Go version go1.26 (application built with go1.25)
```

So the automated Go vulnerability signal is *silently unavailable* right now.
That is worth knowing before wiring govulncheck into CI — it will need either a
newer x/vuln release or a pinned build toolchain.

---

## 3. Frontend — Node / React

`frontend/package.json`. Locked versions from `package-lock.json` (v3).

| Package | Locked | Latest | Gap | Effect of upgrading |
| --- | --- | --- | --- | --- |
| `react` / `react-dom` | 19.2.7 | 19.2.8 | patch | In-range; a `npm install` refresh picks it up. No effect beyond fixes. |
| `maplibre-gl` | 5.24.0 | **6.0.0** | **major** | See §4 — the only migration with real work. |
| `lucide-react` | 1.18.0 | 1.26.0 | minor | Icon additions/fixes. Drop-in. |
| `vite` | 8.0.16 | current | — | Already current major. |
| `typescript` | 6.0.3 | current | — | Already current major. |
| `eslint` | 10.5.0 | current | — | Already current major. |
| `vitest` | 4.1.9 | current | — | Already current major. |
| `@types/node` | ^24.12.3 | — | — | Matches Node 24, see §5. |

Everything except MapLibre is current. `npm outdated` reports only four
packages, and three of them are patch/minor.

### npm audit — 2 high, both dev/build-time

```
brace-expansion  <=5.0.7   high   DoS via exponential {} expansion / OOM
postcss          <=8.5.17  high   Path traversal via sourceMappingURL
```

- `brace-expansion` 5.0.6 — transitive via ESLint's glob handling. Lint-time only.
- `postcss` 8.5.15 — transitive via Vite. Build-time only; the advisory requires
  feeding attacker-controlled CSS with a malicious `sourceMappingURL` through
  the build, which does not describe this project's build.

Neither ships to the browser. **Effect of `npm audit fix`:** clears both, no
runtime change, no lockfile-breaking major moves — both fixes are in-range.

### Oddity: `@emnapi/runtime` pinned as a direct devDependency

`@emnapi/runtime` is normally a transitive dep of Rollup/sharp native bindings,
not something a project declares. It is almost certainly an old workaround for a
resolution failure. **Effect of removing it:** likely none — worth testing a
build without it, so the dependency list reflects reality. If the build breaks,
add a comment explaining why it is pinned.

---

## 4. MapLibre GL JS 5 → 6 — the one real migration

This is the only upgrade in the whole stack that requires code changes.
`Map.tsx` is the sole consumer (`src/components/Map.tsx:2`) but it is a large
file with ~30 `addLayer` / `addSource` / `getSource` call sites.

### Breaking changes and how they land here

| v6 change | Impact on this repo |
| --- | --- |
| **ESM-only** — UMD bundles no longer published | No impact; Vite already bundles ESM. |
| **Default export removed** — `import maplibregl from 'maplibre-gl'` no longer works | **Direct hit.** `Map.tsx:2` uses exactly this. Must become `import * as maplibregl from 'maplibre-gl'` or named imports. One-line fix, but it is a hard compile break. |
| **WebGL2 required** (WebGL 1 dropped) | Drops support for very old devices. Since this is a public transit map used on phones, worth a conscious decision. Mitigate by handling `.on("error")` and showing a graceful message. |
| **`Map` composes `Camera`, `map.transform` removed** | Needs an audit of `Map.tsx` for any `map.transform` access. |
| **`styleimagemissing` is now notify-only** | Replaced by `Map.setMissingStyleImageResolver()`. Needs a check for whether the vehicle/stop icon loading path uses it. |
| **`GeoJSONSource.setData()` second parameter removed** | The live vehicle layer calls `setData` on every frame — verify no second argument is passed. |
| **style-spec v25 now *throws* on legacy expressions** (previously silent) | **Highest-risk item.** This repo has already been bitten twice by invalid MapLibre expressions silently killing a layer (see CHANGELOG v0.44.7 / v0.44.8 — an invalid `circle-radius` on `trams-circles` took out the entire stop layer because other layers anchor to it via `beforeId`). v6 turning those into thrown errors is *good* — it converts a silent-blank-map failure into a loud one — but it means any remaining legacy expression will surface immediately on upgrade. |
| `zoomLevelsToOverscale` default 4 (was undefined) | Minor rendering/perf difference; verify tile behaviour visually. |
| Icon scaling with offset disabled | Vehicle markers use offsets — verify sizing visually. |
| TS target now ES2022 | No impact; TS 6 already targets modern output. |

### Effect, net

- **Cost:** roughly half a day. One mandatory import fix, then a careful visual
  pass over every layer in `Map.tsx` because expression validation got strict.
- **Benefit:** the strict expression validation directly targets this repo's
  most painful recurring bug class. Two of the last several releases were
  fixes for exactly this failure mode.
- **Risk:** medium-high, and it is *user-visible* if wrong — a broken layer
  means a blank or partial map. This should be the one change that is verified
  by actually running the app, not just by a green build.

**Do this on its own branch, on its own release.** Do not bundle it with
routine bumps.

---

## 5. Containers, deploy, and CI

### Base images

| Image | Pinned as | Status | Effect of moving |
| --- | --- | --- | --- |
| `node:22-alpine` (Dockerfile build stage) | Node 22 | **Maintenance LTS**, EOL 2027-04-30 | → `node:24-alpine` (Active LTS, EOL 2028-04-30). Build-stage only, never runs in production. `@types/node` is already on ^24, so the type surface already assumes 24 — this actually *removes* a mismatch. Low risk. |
| `golang:1.26-alpine` | Go 1.26 | Current | No change needed. |
| `alpine:3.21` (runtime stage) | 3.21 | Two majors behind (3.24.1 current, Jun 2026); 3.21 nears EOL | → `alpine:3.23` or `3.24`. Runtime contains only `ca-certificates` + `tzdata` + a static CGO-disabled binary, so the surface is tiny. Effect: fresher CA bundle and tzdata, fewer scanner findings. Very low risk. |
| `caddy:2-alpine` | floating major | Fine | Tracks 2.x automatically. |
| `redis:7-alpine` | floating major | Redis 8 is GA | Optional. Cache holds ephemeral coordinates with `maxmemory 64mb` / `allkeys-lru` and `appendonly no` — nothing to migrate, it can be thrown away. Redis 8 brings perf gains and a licence change (AGPL). Not urgent. |
| `grafana/alloy:latest` | **`latest`** | ⚠️ unpinned | Every restart can silently pull a new Alloy major. Pin to a real tag. Effect: monitoring stops being able to break itself unattended. |

### GitHub Actions

`actions/checkout@v4` and `actions/setup-node@v4` are both a major behind
(`v6` is current for each). `configure-pages@v4`, `upload-pages-artifact@v3`,
`deploy-pages@v4`, and the `docker/*` actions should be re-checked at the same
time. **Effect:** newer Node runtime for the actions themselves, and staying
ahead of GitHub deprecating v4 runners. Low risk, mechanical.

`deploy-pages.yml` also pins `node-version: 20` — Node 20 is EOL. It only runs
`scripts/build-changelog.js`, so nothing breaks today, but it should move to 24
to match the rest of the stack.

---

## 6. Process gaps — highest value, lowest cost

These are not version numbers, but they are the most consequential findings.

### 6.1 CI never runs the tests

`docker-build.yml` goes straight from tag → docker build → push → Watchtower →
production. There is **no `go test`, no `npm run lint`, no `npm run build`
gate**. `CLAUDE.md` says "Run them before pushing to `main`, since a merge ships
to production" — that instruction is currently enforced by nothing but
discipline.

The repo *has* tests: six Go test packages plus `frontend/src/lib/lerp.test.ts`.

**Effect of adding a test job:** a broken merge stops at CI instead of at
production. This is the single highest-value change in this document, and it is
a ~20-line workflow addition.

### 6.2 `go test ./...` fails on a clean checkout

Verified locally:

```
internal/api/static.go:10:12: pattern all:dist: no matching files found
FAIL  ratikka/cmd/ratikka       [setup failed]
FAIL  ratikka/internal/api      [setup failed]
ok    ratikka/internal/cache
ok    ratikka/internal/config
ok    ratikka/internal/mqtt
ok    ratikka/internal/ws
```

The `//go:embed all:dist` in `internal/api/static.go` requires
`internal/api/dist/` to exist, which only happens after a frontend build. So
two of six packages — including the entire API layer, which holds
`handlers_test.go` and `journey_test.go` — **cannot be tested without building
the frontend first.**

Fixes, cheapest first:

1. Commit an `internal/api/dist/.gitkeep` so the embed pattern always matches.
   One file, unblocks everything.
2. Or put the embed behind a build tag, with a stub for test builds.
3. Or have CI/`make test` run `npm run build` first (slowest feedback loop).

**Effect:** `go test ./...` works on a fresh clone, which is also a
precondition for 6.1 being meaningful — a CI test job added today would only
cover four of six packages.

### 6.3 No `npm test` script

`vitest` is a devDependency and `lerp.test.ts` exists, but `package.json`
declares only `dev`, `build`, `lint`, `preview`. There is no way to run the
frontend tests through the documented interface.

**Effect of adding `"test": "vitest run"`:** the existing test becomes
runnable and CI-wireable. One line.

### 6.4 No Dependabot / Renovate

`.github/` contains only `workflows/`. Every bump in this document was found by
hand, and the next batch will need the same manual sweep.

**Effect of adding `.github/dependabot.yml`** (gomod + npm + github-actions +
docker, weekly, grouped): drift becomes a stream of small reviewable PRs
instead of a periodic audit. Pairs with 6.1 — Dependabot PRs are only safe to
merge if CI actually tests them.

### 6.5 `CLAUDE.md` describes a versioning scheme that no longer exists

`CLAUDE.md` documents releases as driven by `mathieudutour/github-tag-action`
computing the next tag from Conventional Commits (`feat` → minor, `fix` →
patch). The actual `docker-build.yml` does something different: it greps the
top `## [vX.Y.Z]` heading out of `CHANGELOG.md` and uses **that** as the tag,
skipping the build entirely if the tag already exists.

The workflow's own comment says it best — "CHANGELOG.md is the single source of
truth for the version". The docs never caught up.

**Effect of fixing the docs:** the release process stops having two
contradictory descriptions. This matters more than it sounds: the changelog
already records a release (v0.44.9 → v0.44.10) that had to be re-cut because
a merge did not trigger a build, which is exactly the kind of mistake that
ambiguous release docs cause.

---

## 7. Proposed sequencing

Four independent batches. Each is separately releasable and separately
revertable.

### Batch 1 — Foundations (do first, no dependency changes at all)

1. `internal/api/dist/.gitkeep` so `go test ./...` passes on a clean checkout.
2. `"test": "vitest run"` in `frontend/package.json`.
3. CI job: `go test ./...` + `npm ci && npm run lint && npm run build && npm test`,
   running on PRs and on `main`.
4. `.github/dependabot.yml` for gomod, npm, github-actions, docker.
5. Correct the Versioning & Release section of `CLAUDE.md`.

**Effect:** everything after this is verified by CI rather than by hand.
**Risk:** none — no shipped code changes.

### Batch 2 — Routine dependency drift

```bash
# backend/
go get github.com/coder/websocket@latest \
       github.com/eclipse/paho.mqtt.golang@latest \
       github.com/prometheus/client_golang@latest \
       github.com/redis/go-redis/v9@latest
go get golang.org/x/net@latest        # indirect; tidy alone won't raise it
go mod tidy                            # also relabels x/sync as direct
go test ./...
```

```bash
# frontend/
npm audit fix
npm update react react-dom lucide-react
npm run lint && npm run build && npm test
```

**Effect:** clears both npm advisories and the x/net CVE flags; picks up
patch fixes across the board. No API changes expected anywhere.
**Risk:** low. Batch 1's CI covers it.

### Batch 3 — Images and CI actions

- `node:22-alpine` → `node:24-alpine` (build stage)
- `alpine:3.21` → `alpine:3.24` (runtime stage)
- Pin `grafana/alloy:latest` to a concrete tag
- `actions/checkout@v4` → `@v6`, `actions/setup-node@v4` → `@v6`,
  re-check `configure-pages` / `upload-pages-artifact` / `deploy-pages` / `docker/*`
- `deploy-pages.yml`: `node-version: 20` → `24`
- Optional: `redis:7-alpine` → `redis:8-alpine`

**Effect:** supported base images, no more silently-floating Alloy.
**Risk:** low, but it changes the *build* environment — verify the multi-arch
image actually builds before it reaches Watchtower.

### Batch 4 — MapLibre GL 6 (alone, on its own branch)

Per §4. Mandatory import change, then a layer-by-layer visual verification of
`Map.tsx` because expression validation now throws instead of failing silently.

**Effect:** removes this project's most persistent bug class.
**Risk:** medium-high and user-visible. Verify by running the app, not just by
a green build.

---

## 8. What deliberately stays as-is

- **Go 1.26** — current.
- **React 19, Vite 8, TypeScript 6, ESLint 10, Vitest 4** — all current majors.
- **`caddy:2-alpine`** — floating minor within a stable major is correct here.
- **The dependency count itself** — four direct Go deps and four runtime npm
  deps for an app of this scope is genuinely lean, and matches the "prefer the
  stdlib, avoid adding dependencies casually" convention. Nothing here should
  be replaced with something larger.
