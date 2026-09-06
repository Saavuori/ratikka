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
