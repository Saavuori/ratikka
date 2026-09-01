# HSL-LIVE Changelog

All notable changes to this project will be documented in this file.

## [v0.52.1] - 2026-09-01

### Fixed
- **The stop timetable is visible again at stops with service alerts**: alerts are published once per affected route, so an interchange served by a dozen lines stacked a dozen warning cards — often the same disruption repeated — above the departures and pushed them out of the panel entirely. Identical alerts are now collapsed into one, and the whole set is folded into a single summary row ("3 service alerts", worst-first, with the first headline as a preview) that expands into its own scrollable list. The departures list keeps its share of the panel either way.

---

## [v0.52.0] - 2026-09-01

### Added
- **Metro and commuter trains on the map, alongside trams and buses**: HSL publishes both on the same HFP feed, in the same `VP` payload, on the same topic layout — `/hfp/v2/journey/ongoing/vp/metro/#` and `.../train/#` — so they are ingested by the same handler and get the same treatment as the modes already there. Two new Settings toggles ("Metro", "Trains") switch them on; like buses they default off and are ingested on demand, so the backend only subscribes to a feed while somebody is looking at it. Each mode brings its own directional carriage icon (orange metro, purple train, doors-open variants and brake lights included), its own per-line colours (M1/M2, and the letter lines A…Z) shared by vehicle, line chip, route ribbon and popup accents, its stations drawn and clickable with their own signs, and its route network drawn underneath — metro and train lines are few enough to fetch a pattern each, so they get the same fanned per-line ribbons trams do rather than the flat tile network buses fall back to.

### Changed
- **The WebSocket control message now carries a set of modes** — `{"modes": {"bus": true, "metro": false, "train": true}}` — instead of just `{"buses": true}`, which is still accepted. The hub counts demand per mode, so a feed is subscribed at the first client that wants it and unsubscribed when the last one goes away, independently per mode.
- **`GET /api/v1/route/{shortName}` also resolves metro and commuter-train lines** (`transportModes: [TRAM, SUBWAY, RAIL]`). The three modes' short names never collide, so one lookup serves all of them; buses stay out of it, being far too many to fetch a pattern each.

### Fixed
- **Only one marker per metro journey**: the two coupled units of a metro train each publish their own position under their own vehicle number, roughly a train-length apart, which would have drawn two "M1" markers swapping places every second. Ingestion keeps the first unit seen for a journey until it goes quiet.
- **Stop layers read the mode from either stop tileset**: the light basemap's JORE tiles call it `mode`, the Digitransit v3 tiles the dark theme falls back to call it `type`. The station layers, the stop signs and the click handler now accept both, so stop signs work in the dark theme too.

---

## [v0.51.1] - 2026-08-31

### Fixed
- **Highlighted routes sit closer to the street they actually follow when zoomed out**: tapering the parallel-ribbon fan to zero below zoom 12 fixed the whole-city view, but between there and street level the spacing was still a *constant* pixel offset, and a pixel covers more ground the further out you are — at zoom 13 the outermost ribbon was about 140 m from its route, i.e. a couple of streets over. The offset's zoom stops now roughly halve per level on the way out (1.5 px per slot at z13, 3 at z14, 6.5 at z16), which is how a metre shrinks in pixels, holding the outermost ribbon inside about 45 m of ground everywhere the fan is drawn at all. A unit test asserts that bound in metres rather than pixels, which is the property that kept breaking.

### Changed
- **Route ribbons are slightly slimmer and fan out more tightly**, at both the line and its casing. Zoomed in, the narrower spacing still clears the casing and leaves a sliver of map between neighbouring routes; further out the ribbons close up and eventually merge, on the basis that being on the right street matters more there than being told apart — the colours still distinguish them.

---

## [v0.51.0] - 2026-08-22

### Changed
- **The version now comes from the commit messages, not from this file**: on a push to `main`, `paulhatch/semantic-version` reads every commit since the last `v*` tag and picks the bump — `feat:` minor, `!:`/`BREAKING CHANGE:` major, anything else patch — then tags and builds. Previously the release tag was whatever the top `## [vX.Y.Z]` heading here said, which made the version a shared counter that every open pull request had to predict: two branches in flight wrote the same heading and conflicted in `CHANGELOG.md` by construction, and a merge that forgot to move the heading shipped nothing at all, silently. Both had happened. The changelog is documentation again — it no longer gates the build and can no longer collide.
- **Dependency updates moved from self-hosted Renovate to Dependabot** (`.github/dependabot.yml`): one grouped minor/patch pull request per ecosystem every Monday, majors separately, MapLibre majors ignored. Renovate was self-hosted only so it could run a post-upgrade command that wrote this file's entry — the thing that made a dependency merge ship. With the version derived from commit messages that requirement is gone, and so are the GitHub App, its two secrets and its scheduled workflow. Two things got worse and are worth knowing: there is no `minimumReleaseAge` holding a fresh release back for three days, and dependency PRs arrive with no changelog entry.

### Removed
- **The CHANGELOG-driven release machinery**: `scripts/derive-release.sh` and its tests, `scripts/changelog-entry.js` and its tests, `scripts/bump-changelog-for-deps.mjs`, `renovate.json5`, and `.github/workflows/renovate.yml`. The `release-logic` CI job that tested them is replaced by a `changelog` job that only checks the file renders and carries no `[Unreleased]` placeholder — the changelog still publishes to GitHub Pages, it just no longer decides anything.

---

## [v0.50.4] - 2026-08-22

### Changed
- **GitHub Actions updated**: `renovatebot/github-action` v46.2.1 → v46.2.2.
- **Frontend packages updated**: `lucide-react` 1.29.0 → 1.31.0, `maplibre-gl` 6.2.0 → 6.3.0, `@types/node` 26.1.2 → 26.2.0, `eslint` 10.8.0 → 10.8.1, `eslint-plugin-react-refresh` 0.5.3 → 0.5.4, `globals` 17.9.0 → 17.11.0, `typescript-eslint` 8.66.0 → 8.67.0. MapLibre 6.3.0 repacks line vertex data as integer attributes and makes map events typed; the key-free map checks — layer specs and route-offset placement — were run by hand against it and pass.

---

## [v0.50.3] - 2026-08-21

### Fixed
- **Highlighted routes no longer drift off their streets when zoomed out**: the parallel-ribbon fan uses MapLibre's `line-offset`, which is measured in *pixels*, so a route sitting several slots out covered more and more ground as the map zoomed out — with the whole network shown, lines ended up a block away from the street they follow, or out in the sea. The offset now tapers to zero below zoom 12, where the streets a fan separates are not distinguishable anyway, and the fan itself is capped at three slots either side of the true geometry. Beyond that the corridor is too crowded to fan out legibly, so lines share a slot (told apart by colour) instead. The cap also removes the blobs of solid colour that appeared at terminal loops, where an offset wider than the turn folded the offset geometry in on itself.

### Added
- **The map's placement is now checked, not just its validity**: `scripts/verify-route-offsets.mjs` draws synthetic route geometry with the app's own paint expressions and measures how far the painted ribbon lands from the coordinates it was given — the failure above passed both existing map checks, because every layer spec was valid and every tile rendered. The offset's zoom stops are additionally unit tested through MapLibre's style spec, so that half runs in CI on every PR.

---

## [v0.50.2] - 2026-08-10

### Changed
- **GitHub Actions updated**: `renovatebot/github-action` v46.2.0 → v46.2.1.
- **Go modules updated**: `github.com/redis/go-redis/v9` 9.21.0 → 9.22.0. This release changes the client's default read/write timeouts, retry backoff and TCP keep-alive. `NewRedisCache` builds its client from `redis.ParseURL` and sets none of those explicitly, so it takes the new defaults — harmless for a co-located cache doing `HSET`/`HGETALL`, but worth knowing if the Redis ever moves off the host.
- **Deploy stack images updated**: `docker.io/grafana/alloy` v1.18.0 → v1.18.1.
- **Frontend packages updated**: `lucide-react` 1.28.0 → 1.29.0, `maplibre-gl` 6.1.0 → 6.2.0, `globals` 17.8.0 → 17.9.0, `typescript-eslint` 8.65.0 → 8.66.0, `vite` 8.2.0 → 8.2.1.

---

## [v0.50.1] - 2026-08-03

### Changed
- **GitHub Actions updated**: `renovatebot/github-action` v46.1.20 → v46.2.0.
- **Frontend packages updated**: `lucide-react` 1.18.0 → 1.28.0, `maplibre-gl` 6.0.0 → 6.1.0, `@types/node` 26.1.1 → 26.1.2, `@types/react` 19.2.14 → 19.2.18, `@types/react-dom` 19.2.3 → 19.2.4, `@vitejs/plugin-react` 6.0.4 → 6.0.5, `globals` 17.7.0 → 17.8.0, `vite` 8.1.5 → 8.2.0.

---

## [v0.50.0] - 2026-08-01

### Added
- **Stopped trams can now tell you they're likely waiting at a traffic light.** A tram sitting still with its doors closed and no scheduled stop under it used to just read "Secured (Doors Closed)" with no further explanation. The map now loads Helsinki's open dataset of signalized-junction locations (`/api/v1/traffic-lights`, sourced from the city's `Liikennevalot_piste`/`Varoitusvalot_piste` WFS layers, CC BY 4.0) and shows small traffic-light markers on the map from street level up. When a stopped tram is within ~35m of one of those junctions, its detail panel now shows "Likely waiting at traffic lights — *cross street names*"; if it's stopped somewhere with no nearby junction, it reads "Stopped — possibly held in traffic" instead. This is a location dataset, not a live signal-state feed, so the label is offered as the likely explanation rather than a confirmed one — doors-open state still wins as the authoritative "at a stop" signal.

---

## [v0.49.1] - 2026-07-25

### Changed
- **The version badge shows the version and nothing else, and follows the theme.** It used to carry the commit SHA and the build date alongside the tag — three fields in 9px monospace over a moving map, none of which mean anything without the changelog the badge already links to. The SHA and date are gone; the tag is the whole badge. Its panel, border and shadow now come from the theme tokens instead of being hardcoded dark, so in light mode it reads as a light chip on the light basemap rather than a dark smudge, and the version itself darkens from emerald to a deeper green so it stays legible on white.

---

## [v0.49.0] - 2026-07-25

### Changed
- **The mobile bottom bar is now "Settings" and "Lines", and every button toggles.** The old bar led with a "Map" tab whose only job was to close whatever sheet was open — a button that did nothing whenever the map was already visible, and a name for a destination you never left. Both remaining buttons now open and close their own sheet, so tapping the one that is already open takes you back to the map. The filter panel is split to match: "Lines" holds the service alerts, "Show All" and the line chips, "Settings" holds the legend and the theme / 3D / trams / buses toggles. Tapping across swaps the contents without closing the sheet. Desktop is untouched — the side drawer still shows lines and settings together.

---

## [v0.48.0] - 2026-07-25

### Changed
- **"Show All" now draws the tram network the same way selecting every line does.** Route separation only ever applied to the fetched pattern geometry, so with no line filter the map fell back to the JORE vector tiles underneath: every tram line in the same mode green, stacked pixel-on-pixel wherever they share track. The default view now highlights every tram line that is running — the same set the filter panel offers as chips — so the ribbons are fanned, cased and coloured by our per-line palette whether you picked nothing or picked everything. The tram tiles step aside whenever a ribbon covers them. Buses are untouched and keep their tile network: `/api/v1/route/{n}` only serves trams, and there are far too many bus lines to fetch a pattern each.
- **Offset slots are assigned per corridor instead of across the whole highlighted set.** A path now takes the slot nearest 0 that no other line is already using on the ground it covers, so a route nobody shares a street with stays on its true geometry and the fan over Aleksanterinkatu is only as wide as the number of lines actually running down it. The old global fan was fine for the three or four lines a filter usually selects, but with the whole network shown it would have pushed every line tens of pixels off the street it follows. A line's own branches may still share a slot — they are drawn in one colour, so where they retrace the same trunk they belong on top of each other rather than beside. Coverage is now sampled along each segment rather than at its vertices, so two lines down the same long straight street can't miss each other on the grid.

---

## [v0.47.4] - 2026-07-25

### Fixed
- **A line no longer draws a third ribbon on the far side of the street.** v0.47.3 collapsed a route's two directions by matching reversed *pairs*, which was too narrow: a route ships more than two patterns — each direction, plus short turns and branch variants — and a short turn is not the reverse of anything, it is a subset, so it survived the match. Every pattern of a line takes that line's offset slot, so any that disagreed about which way they ran ended up on opposite sides. Two changes. Direction is now canonicalised on the path's *dominant* axis rather than on longitude alone, which for a north/south route with a little sideways drift was close to a coin flip, so two patterns of one line could genuinely disagree. Then a line's paths are reduced to the ground they actually cover: quantised to a ~45m grid, longest first, keeping a path only if enough of its cells are ones nothing kept so far has visited. Comparing coverage rather than direction is what makes this robust — a reversed duplicate contributes nothing new whichever way it runs, a short turn is a subset, and a genuine branch survives. Coverage is tolerant of a neighbouring cell, so the two directions of a bus route — twenty-odd metres apart on opposite sides of the street — collapse into one ribbon instead of half-scoring as new ground and reappearing on the far side of the fan.

---

## [v0.47.3] - 2026-07-25

### Fixed
- **A route no longer appears twice, once either side of its own street.** The fan-out shipped in v0.47.2 offset each highlighted line into its own slot — but `line-offset` is signed relative to a path's *direction of travel*, and `/api/v1/route/{n}` returns one polyline per pattern. A route's outbound and inbound patterns are near-reverses of each other, so they were pushed to opposite sides and the single route read as two ribbons. Path direction is now canonicalised before the offset is applied, so both patterns take the same side and overlay as they always did. Exact reverse pairs are then deduped, which also stops two translucent copies compositing into a darker line than the rest.
- **The background route network no longer redraws lines that already have a highlighted path.** The two come from different sources — JORE vector tiles vs. the fetched pattern geometry — and only the highlighted path is offset, so any line drawn by both appeared twice in the same palette colour: once on the street, once beside it. With a line filter active this was guaranteed, because the network was narrowed to exactly the filtered lines. The network is now the "nothing chosen" state only: hidden outright while line filters are active (the ribbons *are* those routes, drawn better), and kept as faded context minus that vehicle's own line when only a vehicle is selected.
- **Neighbouring ribbons are separated by map rather than touching at their casings** — slot spacing widened to 3 / 6.5 / 10px at zoom 10 / 13 / 16, which at every zoom is wider than the casing it has to clear.

---

## [v0.47.2] - 2026-07-25

### Fixed
- **Overlapping route paths no longer blend into one another.** Most of the tram network shares track — a dozen lines run down the same few streets — so highlighting several lines stacked their polylines pixel-on-pixel at 75% opacity: the colours mixed into a muddy third colour and only the last-drawn line was actually visible. Each highlighted line now gets a stable offset slot and is drawn with a perpendicular `line-offset`, so overlapping routes fan out into parallel ribbons instead of covering each other, with a themed casing under each one to keep neighbouring colours from reading as a single wide band. Slots are numerically ordered and depend only on the set of highlighted lines, so routes never shuffle on a redraw.
- **Clicking a tram now actually picks its route out of the network.** The selected vehicle's line was drawn exactly like every other highlighted route, on a map that was simultaneously drawing the whole colour-tinted background network underneath it. It now keeps slot 0 — staying on the true geometry while the others are pushed aside — and is drawn wider, opaque and sorted on top, while the other highlighted routes drop to 40% and the background network fades to 30% for as long as something is selected.

### Added
- **`lib/routeSlots.ts` + tests** — the slot assignment is a small pure function, so the centring, the shift that puts the selected line on the true geometry, numeric ordering ("2" before "10") and stability across redraws are covered by unit tests rather than only being visible on the map.

---

## [v0.47.1] - 2026-07-25

### Changed
- **Dependency updates move from Dependabot to self-hosted Renovate, and now write their changelog entry in the PR instead of on `main` afterwards.** The release tag comes from the top `CHANGELOG.md` heading, and Dependabot cannot write one — so v0.46.1 added a fallback that generated the entry *after* the merge, committing it straight to `main` and tagging from there. That worked, but it put the only description of what shipped behind the merge, where nobody reviews it, and it required CI to push to `main`. Renovate runs `scripts/changelog-entry.js` as a post-upgrade task, before it commits: the entry lands inside Renovate's own commit, so the heading has already moved by the time the PR is opened and a dependency merge releases itself through the ordinary path. The predicted version corrects itself on rebase if another PR merges first and claims that number. `scripts/derive-release.sh` keeps its fallback as a safety net for a branch whose entry never got written — which is why every manager keeps the `chore(deps)` prefix, GitHub Actions included.
- **One PR a week instead of up to four.** Dependabot grouped per ecosystem, so Go, npm, Actions and Docker arrived separately; Renovate groups every non-major update across all managers into a single PR, which also means a single predicted version heading that siblings cannot collide over. Majors still come on their own. Coverage picks up the `docker-compose.yml` images (Caddy, Redis, Alloy), which the Dependabot config never watched.

### Added
- **Updates wait three days before being proposed** (`minimumReleaseAge`). A version that gets yanked shortly after publishing never reaches a PR — Dependabot had no equivalent, so the only defence was noticing by hand.
- **`scripts/changelog-entry.test.sh`** — 14 assertions over the generated entry: the predicted version, each of the five manifest kinds it parses, that a rerun replaces its own entry rather than stacking a copy, that a non-dependency edit leaves the file alone, and finally that `derive-release.sh` ships the heading it produced. This script runs inside Renovate, where a silent no-op is indistinguishable from "nothing to report", so the no-op paths are asserted rather than assumed. Runs in CI alongside the existing release-decision tests.

---

## [v0.47.0] - 2026-07-25

### Changed
- **MapLibre GL upgraded to v6, this time with the blank map fixed.** The root cause of the v0.46.0 blackout was never the layer specs: v6 splits tile parsing into a separate worker chunk and locates it with ``new URL(`./${name}`, import.meta.url)``. That is a template literal, so no bundler can resolve it statically and Vite emitted no worker chunk at all. The request for `/assets/maplibre-gl-worker.mjs` then fell through the SPA's index.html fallback, the worker was handed HTML instead of JavaScript, and it died while constructing — silently. Nothing threw, because the main thread still fetched every TileJSON and the sprite successfully; only tile *parsing* was gone, so zero vector tiles and zero glyphs were ever requested and `isStyleLoaded()` stayed `false` forever. `Map.tsx` now calls `maplibregl.setWorkerUrl()` with a URL Vite actually emits (`?worker&url`), and v6 renders pixel-for-pixel identically to v5 — 63 tiles, 157 layers, same screenshot.

### Added
- **`scripts/verify-map-renders.mjs` — a render check, not a spec check.** Boots the built app against the real Digitransit basemap with a real subscription key and asserts that vector tiles came back and the style finished loading. The existing `verify-map-layers.mjs` stubs every external asset, which is why it passed on v0.46.0 while production was blank — with the worker dead it never parsed a tile, so it could not have caught anything downstream of one. It also surfaces `isStyleLoaded()`, the signal that was observed to differ between v5 and v6 before the v0.46.0 release and shipped unexplained; on the broken build it is the single clearest indicator, and it is now an assertion rather than a note.

---

## [v0.46.1] - 2026-07-25

### Fixed
- **Map was not visible at all in production**: reverts the MapLibre GL 5 → 6 upgrade shipped in v0.46.0. v6 was verified against the layer specs — every layer and source is accepted, and `public/style.json` validates clean against style-spec 26.2.1 — but that check ran with the basemap tiles, sprites and glyphs stubbed, so it only ever proved the specs were *valid*, never that the map *renders* against the real Digitransit basemap. It does not. Pinned back to `maplibre-gl ^5.24.0` with the default import restored, so the map works while v6 is re-attempted properly.

### Changed
- **Dependency merges now release themselves**: the release tag comes from the top `CHANGELOG.md` heading and Dependabot cannot write an entry, so its merges landed on `main` and shipped nothing — visible right now as five dependency merges sitting on `main` with no tag past v0.46.0. When every new non-merge commit since the current tag is `chore(deps)`/`chore(deps-dev)`, `scripts/derive-release.sh` now generates the entry, bumps the patch and releases; a single human commit in the batch disables it. Logic lives in a script so it can be tested (`scripts/derive-release.test.sh`, 7 assertions, runs in CI).
- **Embed placeholder is `.gitkeep`, not `index.html`**: the v0.46.0 placeholder sat at the exact path a frontend build writes its entry point to. Since that path was previously gitignored, git treated a real local build as expendable and silently overwrote it on checkout, leaving a stub page. Docker was unaffected (the image build copies the real `dist/` over it), but local checkouts were not.

---

## [v0.46.0] - 2026-07-25

### Added
- **CI actually runs the tests now**: `.github/workflows/ci.yml` gates every PR and push to `main` on `go vet`, `go test ./...`, a `go mod tidy` check, the frontend `lint`/`build`/`test`, and an amd64 Docker build. Previously a merge went straight to build → push → production with nothing verifying it.
- **Map layer verification**: `scripts/verify-map-layers.mjs` boots the built frontend in headless Chromium and fails on any layer or source MapLibre rejects. MapLibre expressions are only validated at runtime in a browser, so neither `tsc` nor the unit tests can catch a bad one — and because most layers anchor to `trams-circles` via `beforeId`, a single invalid expression silently removes the stops, route path and journey overlay along with it (v0.44.7).
- **Weekly grouped Dependabot updates** for Go modules, npm, GitHub Actions and Docker base images.
- **Dependency merges now release themselves**: the release tag comes from the top `CHANGELOG.md` heading, and Dependabot cannot write an entry — so its merges would land on `main` and never ship, skipped precisely because the heading did not move. When every new non-merge commit since the current tag is `chore(deps)`/`chore(deps-dev)`, `scripts/derive-release.sh` now generates the entry, bumps the patch and releases. A single human commit in the batch disables it, so nothing ships that a human meant to hold back. The logic lives in a script rather than inline YAML so it can be tested — `scripts/derive-release.test.sh` covers all four paths and runs in CI.

### Changed
- **MapLibre GL 5 → 6**: v6 is ESM-only and dropped the default export. It also requires WebGL2, and its stricter style-spec now *throws* on legacy expressions that v5 accepted silently — which is precisely the failure mode behind v0.44.7/v0.44.8. The production bundle shrinks from 1,346 kB to 1,270 kB (gzip 362 → 336 kB).
- **Backend dependencies**: go-redis v9.7.1 → v9.21.0, prometheus/client_golang v1.23.2 → v1.24.1, coder/websocket v1.8.12 → v1.8.15, paho.mqtt.golang v1.5.0 → v1.5.1, and `golang.org/x/net` v0.43.0 → v0.57.0 (which clears the 2026 CVE set; only `x/net/proxy` was ever linked here, so actual exposure was nil).
- **Base images**: Node 22 → 24 (active LTS) for the frontend build stage, Alpine 3.21 → 3.24 for the runtime, Redis 7 → 8, and Grafana Alloy pinned to v1.18.0 instead of floating on `:latest`.
- **CI actions**: checkout v4 → v6, setup-node v4 → v6, configure-pages v4 → v5, upload-pages-artifact v3 → v4, and the Pages workflow off EOL Node 20.

### Fixed
- **`go test ./...` failed on a clean checkout**: `//go:embed all:dist` needs at least one file in `backend/internal/api/dist/`, which only existed after a frontend build — so `internal/api` and `cmd/ratikka` both failed to build, taking `handlers_test.go` and `journey_test.go` with them. A tracked `.gitkeep` fixes it (the `all:` embed prefix picks up dotfiles). `.gitignore` had intended a fix like this, but the rule was dead: a blanket `dist/` pattern stops git descending into the directory, so the `!.../index.html` negation could never fire. The placeholder is deliberately **not** an `index.html`: that is the exact path a frontend build writes to, and because the path was previously ignored, git silently overwrites the built file on checkout — leaving `assets/` intact but replacing the entry point with a stub, so the whole app (map included) disappears.
- **Blank map instead of an explanation on devices without WebGL2**: MapLibre reports a failed context as an `error` event rather than by throwing, and `Map.tsx` had no error listener at all. Now surfaces a message.
- **Two high npm advisories** (`postcss` path traversal, `brace-expansion` DoS), both build/lint-time transitives. `npm audit` is clean.

---

## [v0.45.1] - 2026-07-24

### Fixed
- **Left filter panel no longer mostly empty on tall screens**: the desktop panel used a fixed `height: calc(100dvh - 160px)`, so on large displays it stretched to fill the viewport with the line list floating in a sea of empty space. It now sizes to its content (`height: auto`) and only caps at that same height via `max-height`, and the line list (`.filter-scroll-area`) no longer grows to fill the panel — it takes just the room it needs and scrolls internally once the panel hits the cap, keeping the Legend and Settings pinned below.

---

## [v0.45.0] - 2026-07-23

### Changed
- **On-Demand Bus Ingestion**: The backend now only subscribes to the HSL bus MQTT feed (`.../vp/bus/#`) while at least one connected client has opted in to buses; trams always stream. The WebSocket hub reference-counts client bus preferences (sent as `{"buses": bool}` over the stream socket) and toggles the ingestion worker's bus subscription on the 0→1 / 1→0 boundaries, re-armed on MQTT reconnect. Buses are ~84% of the vehicle feed (≈655 msg/s total), so with no bus viewers the backend's steady-state CPU drops from ~15% toward ~3%. Stale buses drain from the cache via the existing 60s cleanup once the topic is dropped.
- **Buses Default Off**: `showBuses` now defaults to off (opt-in) so the bus feed isn't ingested for every casual visitor. A user's prior explicit choice in `localStorage` is still respected.

---

## [v0.44.10] - 2026-07-22

### Changed
- **Motion aura under vehicles disabled**: the v0.44.8 stop fix restored the `trams-circles` layer to a valid state, which also brought back the coloured motion glow drawn beneath each vehicle. That glow is now switched off — `trams-circles` is fully transparent (`circle-opacity: 0`) and only serves as the `beforeId` anchor for the other custom layers and the vehicle tap/click hit-target. Vehicle heading and state are read from the carriage body and the rear brake lights; tram/bus stops stay visible at every zoom, exactly as after v0.44.8. (The change first landed under a v0.44.9 heading, but that merge did not trigger a release build; this heading cuts the release so the image is actually built and shipped.)

## [v0.44.8] - 2026-07-22

### Fixed
- **Tram (and bus) stops disappeared when zoomed in**: the v0.44.7 motion-aura change gave the `trams-circles` layer a `circle-radius`/`circle-opacity` of the form `['max', ['interpolate', … ['zoom'] …], ['interpolate', … ['get','speedNorm'] …]]`. MapLibre only allows a `zoom` expression as the *top-level* input to a `step`/`interpolate`, so nesting it inside `max` made the whole layer invalid and `addLayer('trams-circles')` was rejected. Because the stop-sign layer (and several others) are inserted with `beforeId: 'trams-circles'`, that anchor going missing meant `stops_signs` was never added at all — so once zoomed in past 15.5 (where the circle stops fade out and the sign-on-a-pole symbols are meant to take over) there was nothing left to draw and stops vanished. The aura expressions are restructured so `zoom` stays the top-level interpolate input and the speed-driven size/fade is folded into each zoom stop via `max`, preserving the exact locator-vs-speed behaviour while keeping the layer valid; `trams-circles` (and with it `stops_signs`, the highlighted route path, and the selected/next-stop markers) are added again.

## [v0.44.7] - 2026-07-22

### Fixed
- **Line filter only showed all routes or none**: selecting specific lines was meant to narrow the background route network "to just those routes", but `updateRouteVisibility` toggled the *entire* network on or off based only on whether *any* line filter was active — so the map showed every route (no filter) or, once you picked a line, hid the whole network and relied on a separate per-line highlight overlay that never covered non-tram routes (the route-details lookup is tram-only). The result read as all-or-nothing. The network is now narrowed by matching each route's `routeIdParsed` (the JORE tiles' friendly line number, the same key as a vehicle's `desi`) against the selected lines, combined with each layer's existing mode/trunk filter. With no filter the whole network shows; selecting one or more lines draws just those lines' routes — and, because it filters the network itself rather than a fetched overlay, it works for trams, light rail, buses, and trunk routes alike.

### Changed
- **Stopped cue is now rear brake lights**: replaced the soft coral "stopped" glow (`trams-stopped`) with two red tail lamps (`trams-brake`) drawn on top of the carriage and rotated with heading, so they always sit on the vehicle's rear. They light while a vehicle is stopped (waiting at a light, in traffic, at a terminus, or with doors open) **and** while it is braking hard (`acc < -0.35`), so they glow on the way into a stop and stay lit through it — like real brake lights. This reads as "braking/stopped" with no legend and, unlike the halo, isn't easy to miss on a busy map. The filter-panel "Stopped" legend swatch is recoloured to match (`#e17055` → `#ff2d2d`).
- **Motion aura reads as a locator dot when zoomed out**: the coloured aura under each vehicle was tuned only for the zoomed-in view (fixed pixel size, opacity fading to zero at a standstill), so on a city-wide view — where many vehicles are on screen at once — stopped or crawling trams almost vanished. The aura now takes the *larger* of a zoom-driven "locator" floor and the existing speed-driven values: zoomed out it keeps a solid, crisper (lower-blur), clearly visible dot for every vehicle regardless of speed, and as you zoom in the floor fades away so the up-close speed/acceleration glow behaves exactly as before.

### Fixed
- **Smoother vehicle animation on a crowded map**: the per-frame loop rebuilt every vehicle's GeoJSON feature and pushed it through `setData` at 60 fps, which is O(number of vehicles) and stuttered once a lot of trams/buses were visible. Rebuilds are now adaptively throttled by vehicle count and zoom — the sub-pixel interpolation between the 1 Hz snapshots is imperceptible when zoomed out, so a busy view updates less often while staying correct. Chasing a selected vehicle is never throttled, so the follow view keeps every frame.

---

## [v0.44.5] - 2026-07-21

### Changed
- **Clearer moving/stopped vehicle cues on the map**: reworked the live-vehicle visual language so movement reads at a glance and a stopped vehicle no longer looks selected.
  - **Motion aura made noticeable**: the coloured glow under each vehicle (green accelerating, red braking, mode-neutral cruising) was easy to miss. It now caps its speed normalisation lower (`spd / 8` ≈ 29 km/h) so it fills at ordinary city-tram speeds instead of only when racing, snaps its opacity up as soon as a vehicle moves (~0.45 → 0.62, was 0.34), and uses a tighter blur (0.55 → 0.4) so the coloured disc stays defined rather than washing out.
  - **Stopped ring softened to a glow**: the static coral "stopped" indicator added in v0.44.3 was a crisp ring that read too much like the gold selection highlight. It is now a subtle, borderless coral glow (high blur, no stroke) that can't be mistaken for the selection ring while still marking a vehicle halted at a light, in traffic, or at a terminus.
  - **Doors-open boarding pulse removed**: dropped the amber pulsing ring (`trams-door-pulse`) and its per-frame pulse phase. The doors-open carriage art (amber door gaps) already signals boarding, so the extra animation was redundant.
- **New icon & animation reference docs**: added `docs/ICONS_AND_ANIMATIONS.md`, a visual catalogue of every tram/bus map icon, stop sign, vehicle-state animation, and panel schematic, with rendered picture examples (linked from the README).

---

## [v0.44.4] - 2026-07-21

### Changed
- **Route network coloured per line**: the background tram/light-rail route network was drawn in HSL's single mode green, so every tram line's route looked identical on the map. It is now tinted by the per-line palette — matching the JORE tiles' `routeIdParsed` line number against the same colours used for the vehicles and line badges — so each line's route reads in its own colour. Lines outside the palette fall back to the mode colour (a null/absent property is a no-op, never a regression); the white casing stays white and buses keep their mode blue.

---

## [v0.44.3] - 2026-07-21

### Fixed
- **Tram icon did not indicate when it was stopped**: the per-frame vehicle features carried a computed `stopped` flag (doors open or speed 0) and the filter-panel legend advertised a coral "Stopped" state, but no map layer ever consumed it. The only stop-related cues were the amber door-pulse (doors open) and the motion aura *fading to nothing* at a standstill — so a tram halted with its doors shut (waiting at a light, stuck in traffic, sitting at a terminus) had no positive indicator and read the same as one crawling slowly. Added a `trams-stopped` layer that draws a static coral (`#e17055`) ring under any stopped vehicle, matching the legend swatch, and collapses to nothing the moment it starts moving.

## [v0.44.2] - 2026-07-21

### Changed
- **Disabled the next-stop route highlight**: the gold line segment drawn from a selected vehicle to its next stop (`next-stop-route-layer`) is turned off behind the `HIGHLIGHT_NEXT_STOP_ROUTE` flag in `Map.tsx`. It relied on closest-point matching against the trip polyline, which produced unreliable back-tracking/jumping paths. The next-stop signpost highlight itself is unchanged and still shown.

---

## [v0.44.1] - 2026-07-21

### Changed
- **Route network is always on and driven by the line filter**: removed the Settings "Routes" toggle. The route network is now shown by default — all routes are visible whenever no line filter is active — and selecting one or more lines narrows the map to just those routes (drawn in their per-line palette colours). This makes the network behave like "Show All": there is no separate on/off switch to get out of sync with the filter. Tram vs bus routes still follow the **Trams**/**Buses** mode toggles.

### Fixed
- **Route network invisible in dark theme**: with the network shown by default, it previously still drew nothing while the map was in dark mode. The HSL background route network (the JORE `routes` vector source and its tram/bus/light-rail/trunk line layers) was defined only in the light-theme `style.json`; the dark theme loads Carto's dark-matter basemap, which has neither, so no route colours appeared. The map now recreates that source and those layers whenever the base style lacks them, so the route network — green trams, blue buses, teal light rail, orange trunk — is drawn in both themes.

---

## [v0.44.0] - 2026-07-21

### Changed
- **Routes network follows the mode toggles**: the settings "Routes" toggle now draws only the tram and bus route network — tram routes appear when **Trams** is enabled and bus/trunk routes appear when **Buses** is enabled, instead of always showing every mode (rail, subway, ferry are no longer drawn as background routes). The network keeps HSL's mode colours (green trams, blue buses) rather than the per-line palette. The toggle now also defaults to **on**, so the tram route network is visible on first load.

---

## [v0.43.1] - 2026-07-21

### Fixed
- **Production-Readiness Audit**: A full sweep of the Go backend and React frontend for release, fixing every error-level lint finding and a set of real runtime defects found by review:
  - **Backend — WebSocket hub**: replaced the unbuffered register/unregister channels with mutex-guarded map operations. Previously, once the hub loop stopped at shutdown, every connected client's handler goroutine blocked forever on unregister (a permanent goroutine leak), and clients whose 16-message send buffer stayed full were skipped forever but never disconnected — they are now dropped with a `slow consumer` close.
  - **Backend — alerts endpoint**: no longer holds a write mutex across the upstream GraphQL round-trip (up to 10s), which serialized *all* concurrent alert requests behind one fetch. Alerts now use the same singleflight + response-cache pattern as the other endpoints.
  - **Backend — hardening**: the in-memory response cache now evicts expired entries (previously unbounded growth from distinct geocode/plan keys); `http.Server` gained `ReadHeaderTimeout`/`IdleTimeout` (slowloris guard); the `.env` loader no longer prints secret values into logs; the `?departures=` parameter is capped at 50; vehicles reporting a missing HFP timestamp are no longer purged as stale on the next sweep; removed the stray `backend/query_trip.go` debug script. `/api/v1/config` can now serve a dedicated `DIGITRANSIT_MAP_API_KEY` to browsers so the server-side routing key can stay private.
  - **Frontend — map**: layer click/hover handlers were re-registered on every theme change and never removed, so after N theme toggles a single tap fired N+1 selection events — they now bind once per map instance. The two bus-stop layer filters used `'and'`, which is not a MapLibre expression operator, and are corrected to `'all'`. Deferred SVG `onload` callbacks no longer touch a removed map, and the 60fps interpolation loop now survives a thrown frame instead of freezing every vehicle for the rest of the session.
  - **Frontend — stale-response races**: stop, bike-station, and route-geometry fetches now ignore responses that arrive after the selection has changed, so a slow response can no longer show the wrong stop's timetable, the wrong station's capacity, or re-draw a deselected line's route.
  - **Frontend — resilience**: all `localStorage` access goes through guarded helpers (Safari Private Browsing / blocked-storage no longer crashes the app) and the app is wrapped in an error boundary with a reload fallback instead of white-screening on an unexpected error. Removed leftover `console.log` noise; `eslint` and `tsc` now pass with zero errors.

---

## [v0.43.0] - 2026-07-21

### Added
- **Per-Route Colour Palette**: Every tram rendered in the same HSL green because HSL colours vehicles by *mode*, not by line — both the GTFS `route.color` field and the JORE vector tiles return one shared green for the whole tram network, so line 4 was indistinguishable from line 9 at a glance. Introduced a curated palette (`lib/routeColors.ts`) that assigns each Helsinki tram line (incl. the line 15 Raide-Jokeri light rail) its own visually distinct colour, with a deterministic hash fallback so any unlisted or new line still gets a stable, unique hue instead of the ambiguous mode green.
  - **On the map**: each moving tram's carriage is now tinted by its line colour (line-specific body images, open/closed door variants), and a highlighted/selected route's path is drawn in that same colour instead of green.
  - **In the UI**: line-number badges are tinted per route across the vehicle card, the detail popup header, the stop popup's "lines serving" chips and departure badges, the filter panel's line chips, and route badges in service alerts — turning the filter grid into a colour legend for the network.
  - Buses keep their mode blue; the palette is documented and centralised so colours stay consistent everywhere a line number appears.

---

## [v0.42.1] - 2026-07-21

### Changed
- **Larger On-Map Vehicle Icons**: The redesigned tram/bus carriage markers rendered a touch small and were easy to lose against the basemap. Bumped the vehicle body's zoom-based `icon-size` (~30% larger across zooms) and scaled the upright line-number label and the selection ring to match, so vehicles read clearly at a glance without crowding each other.

---

## [v0.42.0] - 2026-07-21

### Changed
- **Redesigned Vehicle Markers with Motion & Door Animation**: Live trams and buses were a plain coloured dot with a separate rotating arrow, and the only motion cue was a linear slide between the ~1s position updates — nothing conveyed how fast a vehicle was going, whether it was speeding up or braking, or that it was letting passengers on. Each vehicle is now a small directional carriage: a rounded body with a windshield and nose nub that rotates to its heading (sleek green for trams, boxier blue for buses), with the line number sitting upright on top.
  - **Speed & acceleration**: a soft aura beneath each vehicle grows with its speed and is tinted by acceleration — green while pulling away, red while braking, mode-neutral while cruising — fading to nothing at a standstill. Position interpolation is now acceleration-shaped (`easeByAccel`), so a marker visibly eases out as it rolls into a stop and eases in as it pulls away, instead of gliding at a constant rate.
  - **Doors opening**: while a vehicle's doors are open (`drst === 1`) the body swaps to a variant with amber door gaps and an amber "boarding" ring expands and fades on a ~1.5s loop. Both the door pulse and the aura animate off the existing 60fps interpolation loop via data-driven paint (no extra timers).
  - Added tested `clamp`, `smoothstep` and `easeByAccel` easing helpers to `lib/lerp.ts`.

---

## [v0.41.2] - 2026-07-21

### Changed
- **CHANGELOG Drives the Release Version**: The deployed version and the changelog could drift because the release tag was auto-bumped from conventional-commit prefixes while the `## [vX.Y.Z]` heading was written by hand — a mismatched guess (e.g. a `fix:` commit under a minor-bump heading) shipped a version the changelog never named, and docs-only pushes minted entry-less tags. CI now reads the release version straight from the top `## [vX.Y.Z]` heading in `CHANGELOG.md`, tags the commit to match, and skips the build when that version is unchanged. The changelog heading is now the single source of truth, so the running version always equals the changelog's latest entry. Versioning/committing workflow docs updated to match.

---

## [v0.41.1] - 2026-07-21

### Fixed
- **On-Map Bike Availability Always Zero**: The city-bike markers read `bikesAvailable` straight from the Digitransit rental-station **vector tiles**, but those tiles carry no live availability — only station id, name and location. The count therefore always fell back to `0`, so every station showed "0" and was greyed out as if empty. The map now sources live counts from the realtime API instead of the tiles (see below), so availability is accurate again.

### Added
- **Live Bike Availability Gauge**: Replaced the plain gold dot + bare number with an at-a-glance availability gauge. Each station is a small donut whose coloured arc shows how full it is (bikes ÷ total docks) and whose colour flags scarcity — grey when empty, red when critically low, amber when middling, green when there are plenty — with the available-bike count in the centre once you're zoomed in enough to read it. Empty stations still read instantly from colour alone, even at the wide overview zoom where the number is hidden.
- **`GET /api/v1/bike-stations` Endpoint**: New backend proxy returning every HSL city-bike station with live bike/dock counts as a GeoJSON `FeatureCollection` (Digitransit key stays server-side, coalesced via `singleflight`, cached 20s). The map polls it every 30s and feeds it straight into a MapLibre source. Counts reuse the same resilient `total`/`byType` resolution as the station panel, so map and panel agree.

---

## [v0.41.0] - 2026-07-21

### Added
- **Changelog Link in Version Badge**: The version badge in the map's bottom-left corner is now a clickable link that opens the live changelog (GitHub Pages) in a new tab, so riders can jump straight from the running version to its release history. The badge keeps its existing appearance and hover affordance.

---

## [v0.40.1] - 2026-07-21

### Fixed
- **City Bike Free Docks Always Zero**: The station panel always showed "0 Free Docks" for every city bike station. The backend counted only `availableSpaces` entries whose vehicle form factor was `BICYCLE`, but HSL reports empty docks without a per-type breakdown (only a station-wide total), so the filter never matched and the count collapsed to zero. The backend now reads the authoritative `total` field, counts untyped docks alongside `BICYCLE` ones, and falls back to `total` when the per-type breakdown is absent. Available bikes used the same resilient path now.

---

## [v0.40.0] - 2026-07-21

### Added
- **Bike Availability on the Map**: City-bike station markers now show how many bikes are left directly on the map. Previously only the fully zoomed-in bike sign (zoom ≥ 15.5) carried a count; at the default zoom level (14) stations were just plain gold dots with no indication of availability. The mid-zoom circle markers were enlarged and now display the available-bike count as a label (fading in from zoom 13.5 so the wide overview stays clean), and stations with no bikes left are greyed out so an empty station reads at a glance even before the number is visible. Clicking the number opens the station panel, same as clicking the marker.

---

## [v0.39.0] - 2026-07-20

### Added
- **Journey Line Filtering**: Choosing a route in the "Where to?" destination search now restricts the map to the vehicles running on that journey's transit legs, mirroring how selecting a line filter narrows the map. Clearing the journey restores the full set of vehicles.

---

## [v0.38.1] - 2026-07-19

### Fixed
- **Collapsible Journey Planner on Mobile**: The expanded "Where to?" panel covered the whole map on mobile, and the only way out (the X) cleared the journey — so riders could never see the route they had just planned. Picking an itinerary now auto-collapses the planner to a compact top summary bar (route chips + duration), revealing the highlighted route and stops underneath; tapping the bar re-expands it, while the X still fully clears the journey. Added a minimize control to the expanded header (desktop too) and capped the expanded panel to 60dvh so the map peeks through even before collapsing.

---

## [v0.38.0] - 2026-07-19

### Added
- **Destination Journey Search**: A new top-center "Where to?" search lets riders pick a destination and instantly see the routes that get them there. The origin defaults to the device's current location (with a one-tap "Use current location" option and a manual origin field for when GPS is unavailable), destinations are found via a debounced geocoding autocomplete, and the planner returns ranked itineraries showing departure/arrival times, total duration, transfers, and a colour-coded leg-by-leg breakdown. The planner collapses to a compact summary bar (automatically on mobile once a route is picked) so the highlighted route on the map stays visible without losing the journey — closing it clears the journey.
- **On-Map Journey Highlighting**: Selecting an itinerary draws its legs on the map — solid route-coloured lines for transit legs, dashed grey for walking — with origin/destination markers and highlighted stops the rider would actually use: green for the boarding stop, coral for the final stop, gold for transfers, and small dots for intermediate stops. The camera fits the whole journey into view.
- **Backend Geocoding & Routing Proxies**: Added `GET /api/v1/geocode` (Digitransit Pelias place search, HSL-region constrained, 60s cache) and `GET /api/v1/plan` (Digitransit routing `plan` query, 20s cache), both proxied server-side so the Digitransit subscription key never reaches the browser. Requests are coalesced via `singleflight` and share the existing response cache.

---

## [v0.37.0] - 2026-07-19

### Added
- **Mobile Bottom-Sheet UI**: Replaced the desktop side-drawer layout (previously stretched onto small screens) with a mobile-first pattern. The filter panel and the vehicle/stop/bike detail panels become full-width bottom sheets (Google Maps/Transit style), and a new bottom tab bar (Map / Lines / Details) drives which sheet is expanded — only one at a time, so opening one collapses the other. Desktop layout and interactions are untouched; the behavior is gated entirely behind a `max-width: 768px` media query and a `useIsMobile()` hook.
---

## [v0.36.1] - 2026-07-19

### Fixed
- **Collapsed Sidebar Theme Leak**: The `.filter-panel.collapsed:hover` and `.detail-popup.collapsed:hover` rules hardcoded a dark background, overriding the theme-aware `var(--bg-panel)` inherited from `.glass-panel`. Since the collapsed peek strip is click-to-expand, hovering it in light theme flipped the sidebars to near-black on every open/close. Added a `--bg-panel-hover` design token to both theme blocks and pointed the hover rules at it; the dark theme keeps its previous colour.

---

## [v0.36.0] - 2026-07-18

### Added
- **Global Glass Peeking Layout**: Enforced the peeking sidebar collapsed style globally on all screen sizes, hiding the toggle buttons `.filter-toggle-tab` and `.detail-toggle-tab` globally.
- **Right Sidebar Peeking & Gestures**: Added right sidebar peek offset (16px) when collapsed, click-to-expand onClick support, touch swipe controls (swipe left to expand, swipe right to collapse), and a ChevronRight close header button on `TramPopup`, `StopPopup`, and `BikePopup`.

---

## [v0.35.2] - 2026-07-18

### Fixed
- **Legend Horizontal Alignment**: Changed the legend list items to align compactly side-by-side on the left using `justify-content: flex-start` and `gap: 12px`, removing the empty middle space.
- **Service Alerts Widget Spacing**: Wrapped the alerts widget in a conditional check so it completely disappears from the layout when there are no disruptions, fully reclaiming vertical sidebar space.

---

## [v0.35.1] - 2026-07-18

### Fixed
- **Changelog Alignment**: Aligned the changelog version entry headers to match the actual conventional tags generated by GitHub Actions CI/CD.

---

## [v0.35.0] - 2026-07-18

### Added
- **Compact Alerts Bar**: Hid the checkmark icon and the "OK" badge in clean state to dramatically reduce visual clutter and maximize vertical space in the sidebar.
- **Mobile Sidebar Collapsed Peek**: Hidden the toggle tab button on mobile. The sidebar now leaves a subtle 16px glass edge peeking out when collapsed, allowing users to intuitively click or swipe it out.
- **Swipe Gestures on Mobile**: Enabled touch gestures to swipe the sidebar open (swipe right) and closed (swipe left).
- **Mobile Close Header Chevron**: Added a clear collapse chevron inside the header on mobile when the panel is open.
- **Removed Irrelevant Legend Key**: Removed the "Next Stop" legend key to free up additional vertical space.

---

## [v0.34.0] - 2026-07-18

### Added
- **Dynamic Contextual Alert Filtering**: Sidebar Service Alerts now adapt dynamically to user map selections. Shows alerts only for the selected vehicle, selected stop (itself and all serving routes), or checked line filters.
- **Noise-Free Global Announcement Fallback**: If no selection or filter is active, the sidebar feed displays *only* general/system-wide announcements (e.g. weather delays, network strikes) that affect all lines, filtering out minor line-specific alerts.
- **Positive Status indicators**: Shows clean states like `Line 9 is clear` or `All systems normal` to reassure users of clear service statuses.

---

## [v0.33.2] - 2026-07-13

### Fixed
- **Next Stop ETA and Highlighting**: Resolved bug where previous stops were highlighted or shown as next stops when the vehicle was moving.
- **Map & UI State Sync**: Unified next stop index resolution logic across `Map.tsx`, `TramCard.tsx`, and `TramPopup.tsx` so highlighted route segments always match the information overlays.
- **Premature Next Stop Jumps**: Prevented next stop indicators from jumping to the subsequent stop prematurely when the vehicle is entering/arriving at a stop before doors open.

---

## [v0.33.1] - 2026-07-13

### Fixed
- **Changelog Sync**: Aligned conventional tag versions with release logs.

---

## [v0.33.0] - 2026-07-13

### Added
- **API Request Coalescing (Singleflight)**: Integrated Go's `singleflight.Group` to merge concurrent queries for the same Route, Trip, Stop, or Bike Station into a single upstream Digitransit GraphQL API request.
- **Thread-Safe In-Memory Response Caching**: Added a backend cache with custom TTLs: 1 hour for Route Details (static geometries and stop lists), 10 seconds for Trip and Stop timetables, and 15 seconds for Bike Stations.

### Changed
- **Lifting State Up (Fetch Deduplication)**: Lifted the `selectedTripDetails` fetch logic and state up to `App.tsx`, sharing it via props across `Map.tsx`, `TramCard.tsx`, and `TramPopup.tsx` to eliminate redundant concurrent HTTP requests on vehicle selection.

---

## [v0.32.0] - 2026-07-13

### Added
- **HSL Service Disruption Alerts**: Integrated real-time service disruptions from Digitransit's Routing API.
- **Normalized Multi-lingual Caching**: Added server-side caching (60s TTL) in Go backend keyed by `Accept-Language` headers (`fi`, `sv`, `en`) to prevent API rate limiting while maintaining localized alert messages.
- **Sidebar Alerts Feed**: Implemented a collapsible, interactive Service Alerts feed inside the left `FilterPanel` listing active alerts with severity-colored left borders (INFO, WARNING, SEVERE), affected routes, and stops.
- **Context-Aware Timetable Warnings**: Highlighted specific service disruptions inside `TramPopup` and `StopPopup` if they affect the selected transit vehicle line or the stop timetable.

---

## [v0.31.0] - 2026-07-13

### Fixed
- **Verbose Ingestion Logging**: Commented out verbose MQTT ingestion log output to clean up server console logs.

---

## [v0.30.0] - 2026-06-17

### Added
- **Traffic Sign Pole Map Symbols**: Replaced standard circular dots for tram, standard bus, and trunk bus stops with custom sign-on-a-pole traffic sign symbols when zoomed in (zoom >= 15.5) on the map ([Map.tsx](file:///c:/Antigravity/ratikka/frontend/src/components/Map.tsx)).
- **Dynamic City Bike Counts & Bubble Overlay**: Rendered city bike stations on a pole with a yellow bicycle sign, plus a dynamic green overlay bubble showing the live number of available bikes (`bikesAvailable`) at the top right of the station circle.
- **Interpolated Selection Highlight Translation**: Implemented zoom-based `'circle-translate'` interpolation for stops and city bike selection halo highlights, dynamically shifting the halos upwards by 28px as the map zooms in to frame the sign boards.

---

## [v0.29.2] - 2026-06-17

### Fixed
- **Mobile Viewport & Navigation Bar Overlaps**: Implemented dynamic viewport height rules (`100dvh` / `calc(100dvh - ...)`) across all main layout panels and lists. Configured safe-area bottom insets and mobile-specific offsets for MapLibre map control buttons and the version badge to prevent them from being obstructed by Android OS virtual navigation buttons or iOS Home indicators.

---

## [v0.29.1] - 2026-06-16

### Fixed
- **Legend Layout Overflow**: Repositioned and resized the Legend items (`Moving`, `Stopped`, `Next Stop`) in the left sidebar filter panel to fit horizontally on a single line. Scaled down indicator dots and text sizes to prevent vertical wrapping and overlap with the settings section.

---

## [v0.29.0] - 2026-06-16

### Added
- **Selected-Vehicle Diagnostics & Telemetry Dashboard**: Introduced a premium, multi-tab layout (`Telemetry`, `Schedule`, and `Diagnostics`) inside the selected vehicle sidebar details panel ([TramPopup.tsx](file:///c:/Antigravity/ratikka/frontend/src/components/TramPopup.tsx)).
- **Animated 2D Vehicle Schematic**: Created interactive 2D vector layouts for both trams (3 door pairs) and buses (2 door pairs). Visualizes live doors opening/closing (`drst`), blinking passenger boarding indicators, and spinning wheels at speeds proportional to vehicle velocity.
- **Arc Speedometer & Brake/Acceleration Gauges**: Developed custom SVG speedometer and schedule deviation dials, along with a bidirectional accelerometer bar that dynamically updates to show cruising, positive acceleration, or active braking (G-force).
- **Expanded Live Telemetry API Parsing**: Updated Go backend ingestion worker ([ingestion.go](file:///c:/Antigravity/ratikka/backend/internal/mqtt/ingestion.go)) to parse raw HSL HFP v2 MQTT parameters (`odo` odometer, `loc` coordinates tracking source, `oper` operator registry ID, `jrn` journey ID, `occu` passenger occupancy percentage, `dir` schedule direction ID, `oday` operating day, and `start` planned departure time).

---

## [v0.27.0] - 2026-06-16

### Added
- **Self-Location (GPS)**: Integrated a Geolocate Control button in the bottom-right corner of the map. This allows mobile and desktop users to locate themselves, display a GPS marker on the map, and automatically track and center the view. The geolocation control button inherits the application's glassmorphic dark theme styles.

### Changed
- **Filter Panel Alignment**: Updated the left side filter panel height to `calc(100vh - 160px)`. Combined with the `80px` top positioning, this leaves an equal `80px` margin at the top and bottom of the viewport for vertical symmetry.

---

## [v0.26.3] - 2026-06-16

### Fixed
- **Layout Jitter**: Allocated a fixed-size container for the acceleration indicator in the top telemetry card, preventing constant resizing and layout shifts when vehicles fluctuate between cruising and active acceleration/braking.
- **Direction Markers Visibility**: Enhanced heading indicator arrows for both trams and buses on the map and top telemetry card. Added double-stroking (white inner outline, dark outer boundary) and dynamic vehicle-mode coloring (green for trams, blue for buses) for better contrast against green parkland/forest maps.
- **Next Stop Calculation**: Refactored the `getStopIndices` helper function in both `TramCard` and `TramPopup` to correctly treat the GTFS stop telemetry field as the upcoming next stop rather than the last passed stop when the vehicle is moving. Fixed rendering behavior when moving towards the very first stop of a journey.
- **Filter Panel Constraints**: Refactored the left-side filter panel to use 2 columns instead of 3, widening the label buttons. Set a fixed height (`calc(100vh - 96px)`) so that it doesn't stretch or shift vertically when bus lines are loaded.

---

## [v0.25.0] - 2026-06-15

### Added
- **Acceleration Telemetry**: Parsed and displayed live vehicle acceleration/deceleration on the top telemetry card using Paho MQTT ingestion.

### Fixed
- **Relative ETAs**: Changed top telemetry display card to show relative ETA minutes (e.g., "now", "3 min") instead of static clock times for better readability.
- **Next Stop Resolution**: Resolved next stop coordinates using the full GTFS schedule timeline logic rather than local geometry estimations.
- **Next Stop Visuals**: Redesigned next stop highlight visibility with a glowing neon coral-red color and custom MapLibre vector circles.

---

## [v0.24.0] - 2026-06-12

### Added
- **60fps Map Highlights**: Enabled high-performance, smooth 60fps rendering of highlights for selected stops, city bike stations, next stops, and active routing path segments.
- **Light/Dark Custom 3D Buildings**: Custom 3D building extrusion filters to cleanly toggle building visibilities depending on dark/light map themes.
