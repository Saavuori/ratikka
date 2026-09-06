# Feasibility: a 24-hour replay mode

Analysis of what it would take to let a user scrub back through the last 24
hours of vehicle movement and watch it play out on the existing map.

**Verdict: feasible, and the frontend is already shaped for it.** The cost is
almost entirely on the backend, and it is a cost of *recording*, not of
playback: nothing today keeps a position for longer than 60 seconds. A
trams-only rolling 24 hours costs roughly **275 MB of disk** and about a week
of work; all four modes cost **~2 GB of disk** and, more importantly, force the
bus feed to be ingested permanently — undoing the on-demand ingestion that
keeps steady-state CPU near 3%.

---

## 1. What already works in our favour

| Piece | Why it helps |
|---|---|
| `Map` takes `trams: Record<string, VehiclePosition>` (`components/Map.tsx`) | The map renders *a snapshot*, not *the live feed*. It cannot tell where the snapshot came from. A replay player that produces the same shape is a drop-in. |
| `useTramData` is a two-line store (`hooks/useTramData.ts`) | The single seam where live data enters `App`. A replay source swaps in at `App.tsx:157`. |
| Animation is driven by snapshot *arrival*, not by wall-clock time (`Map.tsx:1655`, `2060`) | The glide window is measured as the gap between the last two snapshots. Feed snapshots a second apart and the interpolation, dead reckoning and rail-snapping all behave exactly as they do live. |
| `VehiclePosition` is already thinned and self-contained (`internal/mqtt/ingestion.go`) | Everything the telemetry, schematic and diagnostics panels display is in the stored payload. Recording it verbatim reproduces the full vehicle UI in replay. |
| Ingestion already dedupes and normalises (`acceptReading`, `normalizeDelay`, `parseNextStop`) | The recorder taps a stream that has already had HSL's 4× tram duplication removed — three quarters of the write volume is gone before it reaches us. |
| `cache.Cache` is an interface | Precedent for adding a second storage backend without touching call sites. |

## 2. What does not exist yet

- **No persistence.** Redis holds the *current* position per vehicle in one
  hash (`ratikka:positions`), capped at 64 MB `allkeys-lru`, and
  `cleanupStaleTrams` (`cmd/ratikka/main.go`) deletes anything older than 60
  seconds. There is no history anywhere, and Redis as configured is not the
  place to put one.
- **No time dimension in the wire protocol.** `PositionsMessage` is a snapshot
  of "now" pushed once a second (`internal/ws/hub.go`); there is no way to ask
  for a different instant.
- **No clock abstraction on the client.** The map animates against
  `performance.now()`. That is fine at 1× but not at 8×.
- **The backend does not have a writable volume.** `docker-compose.yml` gives
  `ratikka-backend` no volume, and `update.sh` recreates the container every
  time a new image lands. A recorder that writes inside the container loses the
  entire history on each deploy.

## 3. How much data is it?

Measured and derived from figures already established in this repo:

- Distinct tram readings after dedupe: **24,276 per 300 s ≈ 81/s**
  (`ingestion.go`, `dedupeTTL` comment).
- Whole feed: **≈655 msg/s, of which buses are ~84%** (CHANGELOG v0.56.0), so
  all four modes land around **600–700 distinct readings/s**. This is the one
  number worth re-measuring with a counter before committing — the two captures
  it is derived from were taken at different times of day.

A representative `VehiclePosition` serialises to **338 bytes**. Over 7,200
synthetic readings with realistic field cardinality, NDJSON costs **335 B per
reading** and `gzip -9` over the stream costs **37.5 B per reading** (~9×). A
packed binary record (vehicle ref, delta timestamp, two int32 coordinates,
speed, acceleration, heading, flags, stop ref) is ~18 B before compression.

| Scope | Readings/day | NDJSON | gzip NDJSON | packed binary |
|---|---|---|---|---|
| Trams only | 7.3 M | 2.5 GB | **275 MB** | ~130 MB |
| All modes | 56 M | 18.8 GB | **2.1 GB** | ~1.0 GB |
| All modes, 10 s resolution | 5.6 M | 1.9 GB | 210 MB | ~100 MB |

Because the window rolls, those are also the steady-state disk figures. Per
minute of history, a chunk is ~190 KB gzipped for trams and ~1.5 MB for all
modes — comfortable to fetch at 1× (25 kbit/s for trams), which is what caps
playback speed (see §6).

**Recommendation: gzipped NDJSON chunks on disk.** It is within a factor of two
of the packed format, needs no encoder, no schema migration and no new
dependency, and the chunks are directly serveable and browser-decodable. Redis
is the wrong store (memory-bound, LRU-evicted); SQLite or Timescale buy query
ability a linear replay never uses.

## 4. Backend design

**Recorder.** A `Recorder` interface with one insertion point, in
`handleMessage` right after the thinned payload is marshalled and next to the
existing `cache.SetPosition` call. It receives exactly what the cache receives,
so it inherits dedupe, metro-unit pairing and next-stop parsing for free.

**Storage layout.** One file per minute per mode, under a bind-mounted volume:

```
/data/replay/2026-09-06/17/36-tram.ndjson.gz
```

Buffer in memory, flush once a second, close and rename the chunk when the
minute rolls. A retention sweeper on the existing 10 s cleanup ticker deletes
directories older than 24 h. Crash exposure is one second of history.

**API.** Two read-only endpoints, no server-side session state:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/replay/index` | Which minutes exist, per mode, plus gaps |
| `GET` | `/api/v1/replay/{yyyy-mm-dd}/{hh}/{mm}` | One minute of readings (`?modes=tram,bus`) |

Chunks are immutable once closed, so they are `Cache-Control: immutable` and
Caddy serves repeats for free. The client prefetches the next minute while
playing the current one. This is deliberately *not* a WebSocket mode: seeking,
pausing and speed changes are all client-side when the client pulls chunks, and
the hub stays a live-only component.

## 5. Frontend design

1. **`useReplay(chunkSource)`** — mirrors `useTramData`'s output shape:
   maintains a virtual clock, fetches and decompresses chunks
   (`DecompressionStream('gzip')`, available in all target browsers), and emits
   a `Record<string, VehiclePosition>` snapshot at the replay's tick rate. Same
   contract as the live path, so `App`'s filtering, selection, journey matching
   and stop logic are untouched.
2. **A source switch in `App`** — one ternary at `App.tsx:157` choosing between
   the WebSocket and the replay player.
3. **Timeline UI** — a scrubber with hour ticks, play/pause, speed selector and
   a "live" button, in the existing glassmorphic idiom.
4. **A time scale for the map** — the one non-trivial frontend change.
   `windowSecRef` is derived from wall-clock arrival gaps (`Map.tsx:2060`) and
   the teleport guard allows `maxSpeed × 4 × window` (`Map.tsx:2185`). At 8×,
   snapshots arrive 125 ms apart carrying a second of travel, so every vehicle
   trips the guard and snaps instead of gliding. Fix: pass the replay's time
   scale into `Map` and derive the window from the *data* delta. Contained, but
   it must be done or fast playback looks broken.

## 6. What replay cannot show, and what that costs

Everything on the map that is not a vehicle is fetched live and would be
anachronistic next to historical vehicles:

- **Stop departures, arrival labels, service alerts** — live-only APIs. In
  replay they must be suppressed, or they show tonight's departures beside this
  morning's trams.
- **Journey planning and monitoring** — meaningless against a past clock.
  Suppress.
- **City-bike capacity** — live-only. Suppress, or record it too (it is tiny:
  one poll a minute for the whole network).
- **Trip details and route geometry** (`fetchTripDetails`) — these *should*
  still resolve for a trip that ran today, since the trip ID is stored with the
  reading, but Digitransit's retention of past operating days needs verifying
  before the vehicle panel is promised in replay.

Deciding what the UI does with half its panels disabled is a larger design
question than any of the plumbing above.

**Playback speed is bounded by bandwidth**, not by the map: all-modes replay at
60× would need ~12 Mbit/s of chunks. Either cap speed at ~8×, or serve a second
tier of chunks downsampled to one reading per vehicle per 10 s for scrubbing —
the table in §3 shows that tier costs 210 MB/day for everything.

## 7. The one real blocker: on-demand ingestion

Buses, metro and commuter trains are only subscribed **while a client is
watching them** (`ws/hub.go`, `mqtt.EnableMode`). Recording cannot be
retroactive, so a 24-hour history of those modes exists only for the minutes
somebody happened to have them switched on. There are three honest options:

1. **Trams only** (recommended MVP). Trams are always subscribed, so the
   history is complete by construction, and it costs 275 MB and no extra CPU.
2. **Always-on ingestion for all modes.** Complete history, ~2 GB/day, and
   steady-state CPU goes back to ~15% whether or not anyone is watching —
   reversing v0.56.0 deliberately.
3. **Record whatever is subscribed.** Cheapest, but produces a replay with
   holes in it, which is worse than not offering the mode.

## 8. Effort

| Phase | Work | Estimate |
|---|---|---|
| 1 | Recorder, chunk writer, retention sweeper, metrics | 1–2 days |
| 2 | Replay index + chunk endpoints | 0.5 day |
| 3 | `useReplay`, virtual clock, chunk prefetch | 2 days |
| 4 | Timeline UI, live/replay mode switching, panel suppression | 2 days |
| 5 | Map time scale + teleport guard | 0.5–1 day |
| 6 | Volume in compose, `deploy.sh`, docs, disk alerting | 0.5–1 day |

**≈1–1.5 weeks** for a trams-only 24-hour replay at 1 s resolution.

## 9. Risks and prerequisites

- **Deployment**: the backend needs a bind-mounted volume in
  `docker-compose.yml` and `deploy.sh`, or every image update wipes the
  history. Check free disk on the Oracle host before enabling all modes — it is
  shared with the other apps behind the same Caddy.
- **Gaps are normal**: MQTT reconnects, deploys and restarts all leave missing
  minutes. The index endpoint must report them and the player must skip them
  rather than stall.
- **Disk growth is unbounded if the sweeper fails.** Alert on the replay
  directory size, not only on the retention job.
- **Licensing**: HSL HFP is open data under CC BY 4.0, so retaining and
  re-serving it is permitted with attribution — worth confirming against the
  current terms before shipping, since we would be redistributing a derived
  archive rather than a live proxy.
- **Vehicle identity**: readings are keyed `{operator}-{vehicle}`, not driver or
  passenger data, so a 24 h archive raises no new privacy question beyond what
  HSL already publishes.

---

## 10. What the archive is actually for: location timelapse

Full-network replay is the obvious use of a 24-hour archive, but it is the
expensive one. The cheap one — and probably the more interesting one — is a
**timelapse of a single place**: point at a junction, a terminus or your own
street, and watch a day of service run through it in a minute.

**It is small.** A 500 m stretch of busy tram street, at an average 15 km/h
including stops, holds a vehicle for ~120 s. At 40 vehicles/hour that is
115,000 readings a day: **39 MB of NDJSON, 4.3 MB gzipped**. A major junction
with every mode running through it is perhaps five times that — **~20 MB for
the whole day**. That is a single download. Everything §6 says about capping
playback speed stops applying: once the extract is local, 600× (a day in two
and a half minutes) is free, and so are trails, scrubbing and looping.

**But the chunk layout in §4 cannot answer the query.** Chunks are partitioned
by time alone, so extracting one junction's day means scanning all 1,440 of
them — 56 M records and 2.1 GB of gzip — for a few megabytes of hits. That is
tens of seconds of CPU per request and trivially abusable. Two fixes, and the
second is the one to take:

1. **Partition chunks spatially as well as temporally.** Correct, but the
   file count explodes: a fine grid over the network is hundreds of thousands
   of files a day. Only workable with coarse cells and longer chunk spans,
   which then hurts sequential replay.
2. **Keep NDJSON as the record of truth and write a fixed-width binary index
   beside it** — vehicle ref, delta timestamp, two int32 coordinates, 18 B a
   record. A bbox query scans 1.0 GB/day of packed coordinates at memory
   bandwidth (~1–2 s, single core, no JSON parsing), and the surviving offsets
   pull full records out of the NDJSON only for hits. Costs 1.0 GB/day for all
   modes, **130 MB/day for trams**, and it is the same packed record §3
   already priced.

So the packed binary format returns — not as the storage format, but as the
scan index that makes location queries possible. Worth building in from the
start if timelapse is a goal, because retrofitting it means reprocessing the
archive.

**Rendering it.** The map already has the layer machinery: a timelapse view is
the live map with a line layer accumulating each vehicle's path and fading it,
which is close to what the route-highlight layers already do. Video export is
further along than it looks — `scripts/verify-vehicle-3d.mjs` already drives a
headless MapLibre through Playwright and captures PNGs, so frame capture plus
`ffmpeg` is a short step, and it belongs in an offline script rather than in the
browser.

**It changes the retention question.** A day is the natural window for "what did
I just miss"; a timelapse of a place wants a season. At trams-only rates the
archive is cheap enough to reconsider: **1.9 GB a week, 8.2 GB a month, 100 GB a
year**. Adding the other modes multiplies that by roughly eight and puts a year
out of reach on this host, but a month of trams for 8 GB is the kind of number
that makes "this junction, every Tuesday in October" a feature rather than a
research project.

**The caveat from §7 still binds.** A timelapse can only show modes that were
being recorded, so a bus junction needs always-on bus ingestion. A tram junction
does not.

---

## 11. A week of trams in memory

**It fits: ~1.1 GB.** But the packing is what makes it fit, not the memory, and
once the data is packed Redis stops earning its place.

A week is 49 M tram readings (81/s measured, §3). What that costs depends
entirely on how it is stored:

| Layout | Week |
|---|---|
| NDJSON, one Redis hash entry per reading | **20.8 GB** |
| Packed 22 B record, one entry per reading | 5.5 GB |
| Packed 22 B record, **one blob per minute** | **1.08 GB** |

The per-entry overhead is the whole story: Redis spends 60–100 B on every key
it tracks, so a reading-per-entry layout pays more in bookkeeping than in data.
Batched into one value per minute — 10,080 keys for the week, 104 KB each —
that overhead disappears and the dataset is just the readings.

The 22 B record is journey ref (u16), timestamp delta (u16), two int32
coordinates, speed (u16), acceleration (i8), heading (u16), flags (u8) and next
stop ref (u16), with route, direction, operating day and trip ID lifted into a
side table keyed by journey ref — ~21,000 journeys a week, about 1.3 MB. Adding
the fields the diagnostics tab shows (odometer, occupancy, GPS source) makes it
28 B and the week 1.4 GB.

### Why not Redis

Nothing in this workload is a Redis workload. The two access patterns are "give
me minute *N*" (sequential) and "scan every coordinate in a bounding box" (full
scan, §10). Neither needs a key-value server, and the current instance is
configured against both:

- **`--appendonly no`.** A week of history evaporates on any Redis restart, and
  `update.sh` recreates containers on a five-minute cron. Enabling AOF or RDB
  means writing to disk anyway — at which point disk is the store and Redis is
  a cache in front of it.
- **`--maxmemory 64mb --maxmemory-policy allkeys-lru`.** Raising this to hold
  the archive also removes the safety property it was set for. Left as LRU it
  silently evicts history under pressure — a replay with holes, discovered by a
  user, not by a metric. It would need `noeviction` and a separate instance so
  the live position hash is not evicted alongside it.
- **BGSAVE forks.** Snapshotting a 1.1 GB dataset can transiently double RSS to
  **~2.2 GB** through copy-on-write, on a box shared with every other app behind
  the same Caddy.

### What to do instead

Write the same packed records as files and let the page cache hold them. A
1.1 GB working set on a host with spare RAM is resident after first touch,
scans at exactly the same speed as anything in Redis, survives restarts and
deploys, needs no eviction policy, and needs no new service. If the process
wants explicit control, `mmap` the week and index into it; the records are
fixed-width, so an offset is arithmetic.

That is the honest version of "in memory": the memory is the page cache, and
the durability comes free.

### The reason to want it

Not replay — replay is sequential and disk serves it fine. The prize is §10.
With the whole week's coordinates resident and fixed-width, a bounding-box scan
over **all 49 M readings takes ~0.13 s** at memory bandwidth. That makes "this
junction, all week" an interactive query rather than a batch job, and it is what
turns location timelapse from a feature into something you poke at.

### Before committing

Check free RAM on the Oracle host — the archive wants ~1.1 GB resident with
headroom for the rest of the stack, and this box runs the user's other
applications too. `free -m` and `podman stats --no-stream` answer it; it could
not be verified from this session.
