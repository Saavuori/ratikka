# API Reference — Ratikka

> External APIs consumed by the Ratikka tram tracker and internal endpoints exposed by the Go backend.  
> Last updated: 2026-06-15

---

## Table of Contents

- [External APIs (Digitransit / HSL)](#external-apis)
  - [Track A — MQTT HFP Stream](#track-a--mqtt-hfp-stream)
  - [Track B — Routing API v2 (GraphQL)](#track-b--routing-api-v2-graphql)
  - [Track C — Map API v3 (Vector Tiles)](#track-c--map-api-v3-vector-tiles)
- [Internal Backend API](#internal-backend-api)
  - [WebSocket — Live Position Stream](#websocket--live-position-stream)
  - [REST — Trip Details](#rest--trip-details)
  - [REST — Stop Details](#rest--stop-details)
  - [REST — Route Details](#rest--route-details)
  - [REST — Bike Station Details](#rest--bike-station-details)
  - [REST — Bike Stations (All)](#rest--bike-stations-all)
  - [REST — Traffic Lights (All)](#rest--traffic-lights-all)
  - [REST — Destination Search (Geocode)](#rest--destination-search-geocode)
  - [REST — Journey Plan](#rest--journey-plan)
  - [REST — Replay Index](#rest--replay-index)
  - [REST — Replay Window](#rest--replay-window)
  - [REST — Timelapse](#rest--timelapse)
  - [REST — Health Check](#rest--health-check)
  - [REST — Version Info](#rest--version-info)

---

## External APIs

### Track A — MQTT HFP Stream

High-frequency vehicle position data streamed from HSL's public MQTT broker.

| Property | Value |
|---|---|
| **Protocol** | MQTT v3.1.1 over TLS |
| **Broker** | `tls://mqtt.hsl.fi:8883` |
| **Auth** | None (public broker) |
| **QoS** | 0 (at most once) |
| **Frequency** | ~1 message/second per vehicle |

#### Topic Patterns

Trams are subscribed permanently; buses, metro, commuter trains and ferries are
subscribed on demand, while a connected client asks for them (see the WebSocket
control message below):
```
/hfp/v2/journey/ongoing/vp/tram/#     (always)
/hfp/v2/journey/ongoing/vp/bus/#      (on demand)
/hfp/v2/journey/ongoing/vp/metro/#    (on demand)
/hfp/v2/journey/ongoing/vp/train/#    (on demand)
/hfp/v2/journey/ongoing/vp/ferry/#    (on demand)
```

Topic hierarchy (each segment is filterable with `+` wildcard):

```
/hfp/v2/journey/ongoing/vp/{transport_mode}/{operator_id}/{vehicle_number}/{route_id}/{direction_id}/{headsign}/{start_time}/{next_stop}/{geohash_level}/{geohash}/#
```

For this application, `{transport_mode}` = `tram`, `bus`, `metro` or `train`.
Every mode carries the same `VP` payload, so one handler parses all four. The
feeds differ in what they fill in, not in shape: metro positions are derived
from the signalling system (`loc: "MAN"`, no `dl`/`odo`/`drst`/`acc`), while
trains report GPS with delay and — on some units — odometer and door state.

#### HFP Payload (JSON)

```json
{
  "VP": {
    "desi": "9",
    "dir": "1",
    "oper": 22,
    "veh": 229,
    "tst": "2026-06-15T09:30:15.123Z",
    "tsi": 1781461815,
    "spd": 8.5,
    "hdg": 145,
    "lat": 60.16985,
    "long": 24.93848,
    "acc": 0.12,
    "dl": -15,
    "odo": 12456,
    "drst": 0,
    "oday": "2026-06-15",
    "jrn": 456,
    "line": 312,
    "start": "09:15",
    "loc": "GPS",
    "stop": null,
    "route": "HSL:1009",
    "occu": 0
  }
}
```

#### Fields Used by Ratikka

| Field | Type | Description | Used For |
|---|---|---|---|
| `veh` | `int` | Vehicle number (unique ID) | Marker identity |
| `desi` | `string` | Line designation (e.g. `"9"`, `"1T"`) | Label + filtering |
| `lat` | `float` | Latitude (WGS84) | Map position |
| `long` | `float` | Longitude (WGS84) | Map position |
| `hdg` | `int` | Heading in degrees (0–360) | Marker rotation |
| `spd` | `float` | Speed in m/s | Movement indicator |
| `dl` | `int` | Seconds **ahead of** schedule — positive is early, negative is late, the opposite of GTFS-RT. Negated on ingestion so everything downstream reads positive as late. | Schedule info |
| `drst` | `int` | Door status (0=closed, 1=open) | Stopped indicator |
| `route` | `string` | GTFS route ID (e.g. `"HSL:1009"`) | Route lookup |
| `stop` | `string?` | The stop the vehicle is standing at or inside the stop area of. **Null for the whole run between two stops** — over half of all vp messages — so it is never a source for "where is it heading". | Stop association |

The stop a vehicle is heading for is not in the payload at all: it is topic
level 13, `{next_stop}` (see the hierarchy above), and unlike `stop` it is
stated on every message. A five-minute capture of the live tram feed (44,432
messages) carried a next stop on every topic while the payload's `stop` was
null on 52.8% of vp readings; where the payload did name a stop it matched the
topic every time, because a vehicle that has not yet pulled away from a stop is
both at it and heading for it.
| `tst` | `string` | ISO 8601 timestamp | Freshness check |
| `start` | `string` | Trip start time (`"HH:MM"`) | Trip identification |
| `oday` | `string` | Operating day (`"YYYY-MM-DD"`) | Trip identification |
| `dir` | `string` | Direction ID (`"1"` or `"2"`) | Trip identification |
| `occu` | `int?` | Passenger load, 0–100. A real measurement on the **ferry** only; every road and rail vehicle sends a constant `0`, so on those modes it is a schema placeholder and is not drawn as an occupancy anywhere. | Ferry load gauge (marker, 3D body, schematic, popup meter) |

#### Constructing `gtfsTripId`

The GTFS trip ID for Routing API v2 lookups is constructed from topic + payload:

```
HSL:{route}_{oday}_{weekday}_{dir}_{start}
```

Example: `HSL:1009_20260615_Su_1_0915`

> **Note**: This format may need runtime verification. The Routing API's `trip(id:)` query accepts the GTFS trip ID.

---

### Track B — Routing API v2 (GraphQL)

On-demand detail lookups for trips and stops. Proxied through the Go backend to protect the API key.

| Property | Value |
|---|---|
| **Protocol** | HTTPS POST |
| **Endpoint** | `https://api.digitransit.fi/routing/v2/hsl/gtfs/v1` |
| **Auth** | Header: `digitransit-subscription-key: <KEY>` |
| **Content-Type** | `application/graphql` or `application/json` |
| **Rate Limit** | Fair use (no hard documented limit) |

#### Query: Trip Details (for clicked tram)

```graphql
query GetTripDetails($tripId: String!) {
  trip(id: $tripId) {
    gtfsId
    route {
      shortName
      longName
      mode
      color
    }
    tripHeadsign
    stoptimesForTrip {
      scheduledArrival
      realtimeArrival
      arrivalDelay
      scheduledDeparture
      realtimeDeparture
      departureDelay
      realtime
      realtimeState
      stop {
        gtfsId
        name
        code
        lat
        lon
      }
    }
    tripGeometry {
      length
      points
    }
  }
}
```

**Response fields used:**

| Field | Description |
|---|---|
| `route.shortName` | Line number (e.g. `"9"`) |
| `route.longName` | Full route name |
| `route.color` | Route brand color (hex) |
| `stoptimesForTrip[].stop.name` | Stop name for ETA display |
| `stoptimesForTrip[].realtimeArrival` | Real-time arrival (seconds from midnight) |
| `stoptimesForTrip[].arrivalDelay` | Delay in seconds |
| `tripGeometry.points` | Encoded polyline for route drawing |

#### Query: Stop Timetable (for clicked stop)

```graphql
query GetStopTimetable($stopId: String!, $numberOfDepartures: Int!) {
  stop(id: $stopId) {
    gtfsId
    name
    code
    lat
    lon
    routes {
      shortName
      longName
      mode
    }
    platformCode
    stoptimesWithoutPatterns(numberOfDepartures: $numberOfDepartures, omitCanceled: false) {
      scheduledArrival
      realtimeArrival
      arrivalDelay
      realtime
      realtimeState
      serviceDay
      scheduledDeparture
      realtimeDeparture
      departureDelay
      headsign
      trip {
        gtfsId
        directionId
        departureStoptime { scheduledDeparture }
        route {
          gtfsId
          shortName
          color
          mode
        }
      }
    }
  }
}
```

#### Query: Route Geometry (for drawing route on map)

```graphql
query GetRoutePattern($routeId: String!) {
  route(id: $routeId) {
    shortName
    longName
    color
    patterns {
      directionId
      name
      patternGeometry {
        length
        points
      }
      stops {
        gtfsId
        name
        lat
        lon
      }
    }
  }
}
```

---

### Track C — Map API v3 (Vector Tiles)

Base map tiles and stop POI tiles loaded **directly by the browser** (no backend proxy).

| Property | Value |
|---|---|
| **Protocol** | HTTPS GET |
| **Auth** | URL parameter: `?digitransit-subscription-key=<KEY>` |
| **Security** | Key must have HTTP Referrer Restrictions enabled |

#### Map Style URL

```
https://cdn.digitransit.fi/map/v3/styles/hsl-map/style.json?digitransit-subscription-key={FRONTEND_KEY}
```

Used to initialize MapLibre GL JS:

```typescript
const map = new maplibregl.Map({
  container: 'map',
  style: `https://cdn.digitransit.fi/map/v3/styles/hsl-map/style.json?digitransit-subscription-key=${key}`,
  center: [24.9414, 60.1699],
  zoom: 13,
});
```

#### Stop POI Tiles

```
https://cdn.digitransit.fi/map/v3/hsl/fi/stops/{z}/{x}/{y}.pbf?digitransit-subscription-key={FRONTEND_KEY}
```

Format: Mapbox Vector Tile (MVT / protobuf).

Can be added as a MapLibre vector source:

```typescript
map.addSource('stops', {
  type: 'vector',
  tiles: [`https://cdn.digitransit.fi/map/v3/hsl/fi/stops/{z}/{x}/{y}.pbf?digitransit-subscription-key=${key}`],
  minzoom: 12,
  maxzoom: 16,
});
```

Stop features contain properties like `gtfsId`, `name`, `code`, `type`.

---

## Internal Backend API

All endpoints are served by the Go backend at `http://localhost:8080` and proxied through Caddy at `/api/v1/...`.

### WebSocket — Live Position Stream

| Property | Value |
|---|---|
| **Path** | `/api/v1/stream` |
| **Protocol** | WebSocket (`ws://` / `wss://`) |
| **Direction** | Server → Client broadcast, plus a small client → server control message |
| **Frequency** | 1 snapshot per second |

#### Control Message (Client → Server)

Trams always stream. Buses, metro, commuter trains and ferries are opt-in: the
backend only subscribes to those HFP feeds while at least one connected client
wants them. A client announces what it wants on connect and whenever the user
toggles a mode or selects a journey using that mode:

```json
{ "modes": { "bus": false, "metro": true, "train": true, "ferry": true } }
```

Only `bus`, `metro`, `train` and `ferry` are accepted; any other key is ignored.
Omitted modes keep their current value for that client. The older single-mode
form `{ "buses": true }` is still accepted and means `{"modes": {"bus": true}}`.

#### Message Format (Server → Client)

```json
{
  "type": "positions",
  "timestamp": "2026-06-16T09:30:15Z",
  "vehicles": {
    "22-229": {
      "veh": "22-229",
      "desi": "9",
      "lat": 60.16985,
      "lng": 24.93848,
      "hdg": 145,
      "spd": 8.5,
      "dl": -15,
      "drst": 0,
      "route": "HSL:1009",
      "stop": "HSL:1203420",
      "nextStop": "HSL:1203420",
      "ts": 1781461815,
      "tripId": "HSL:1009_20260616_Mo_1_0915",
      "mode": "tram",
      "tlp": {
        "status": "granted",
        "junction": 75,
        "signalGroup": 673,
        "signalGroupNbr": 14,
        "requestId": 219,
        "requestType": "NORMAL",
        "level": "normal",
        "attempts": 1,
        "protocol": "KAR-MQTT",
        "ts": 1781461815
      }
    },
    "18-1245": {
      "veh": "18-1245",
      "desi": "500",
      "lat": 60.19851,
      "lng": 24.95678,
      "hdg": 85,
      "spd": 11.2,
      "dl": 45,
      "drst": 0,
      "route": "HSL:1500",
      "stop": null,
      "ts": 1781461816,
      "tripId": "HSL:1500_20260616_Mo_2_0920",
      "mode": "bus"
    },
    "0050-117": {
      "veh": "0050-117",
      "desi": "M1",
      "lat": 60.15173,
      "lng": 24.69719,
      "hdg": 264,
      "spd": 17.2,
      "dl": 0,
      "drst": 0,
      "route": "31M1",
      "stop": null,
      "ts": 1781461816,
      "tripId": "HSL:31M1_20260616_Mo_2_2112",
      "mode": "metro",
      "loc": "MAN"
    },
    "0090-6305": {
      "veh": "0090-6305",
      "desi": "R",
      "lat": 60.32599,
      "lng": 25.06239,
      "hdg": 25,
      "spd": 37.8,
      "dl": 86,
      "drst": 0,
      "route": "3001R",
      "stop": null,
      "ts": 1781461816,
      "tripId": "HSL:3001R_20260616_Mo_1_2140",
      "mode": "train",
      "loc": "GPS"
    }
  },
  "count": 4
}
```

`nextStop` is the stop the vehicle is running to, lifted from the HFP topic so
it is answered on every message; `stop` is only set while the vehicle is at a
stop, and is null between them. `eol` (omitted when false) says the vehicle has
reached the end of its line and has no next stop. `dl` is seconds **behind**
schedule — positive is late — which is the negation of the HFP field of the same
name and matches the `delay` fields the timetable endpoints return.

`mode` is one of `tram`, `bus`, `metro` or `train`. Field quality varies by
mode: metro positions come from the signalling system (`loc: "MAN"`), so `dl`,
`odo`, `drst` and `acc` are absent for them, and only some train units report
`odo`/`drst`. Both units of a coupled metro train publish the same journey
under different vehicle numbers; the backend keeps one of them, so a metro
journey appears once.

`tlp` is the vehicle's newest **traffic light priority** exchange, folded in
from the HFP `tlr` and `tla` event feeds — a tram or bus asking a signalised
junction for a green, and the junction's answer. It is **omitted entirely**
unless the vehicle has had such an exchange in the last 25 seconds, which is
most vehicles most of the time. Only trams and buses carry the equipment; metro
and commuter trains never report it.

| Field | Description |
|---|---|
| `status` | `requesting` — asked, not yet answered. `granted` / `denied` — the junction answered (HFP `ACK`/`NAK`). `norequest` — the vehicle reached a junction it is equipped to ask and deliberately did not; `reason` says why. |
| `junction` | Signal junction ID (HFP `sid`). **The same number as the `id` on a feature from `/api/v1/traffic-lights`** — both are Helsinki's own junction numbering — so the two can be joined directly to place the exchange on the map. |
| `signalGroup` / `signalGroupNbr` | The group of lights within the junction the request was aimed at, and the specific light in that group. `signalGroupNbr` may be negative. |
| `requestId` | Ties a request to its answer; `[0, 255]`. |
| `requestType` | `NORMAL` (on approach), `DOOR_CLOSE`, `DOOR_OPEN` or `ADVANCE`. |
| `level` | Priority asked for: `normal`, `high`, or `norequest`. |
| `reason` | Why no request was sent: `GLOBAL`, `AHEAD`, `LINE` or `PRIOEXEP`. |
| `attempts` | Attempt sequence number of the current request. |
| `protocol` | Radio protocol used: `MQTT` or `KAR-MQTT`. |
| `ts` | The vehicle's own Unix timestamp for the newest event in the exchange. |

The `vehicles` map is keyed by vehicle ID. The frontend replaces its entire state each tick and uses the previous + current positions to lerp.

---


### REST — Batched Stop Arrivals

| | |
|---|---|
| **Path** | `/api/v1/stops/arrivals` |
| **Method** | `GET` |
| **Query** | `id` (repeatable, required) — stop GTFS IDs; a bare ID is prefixed with `HSL:` |
| **Auth** | None (backend adds Digitransit key) |

The map labels every stop in view once it is zoomed past the sign-board zoom, and
a request per stop would be a request per stop on every refresh. This answers for
several stops in one upstream round trip.

IDs are de-duplicated, sorted (so the same set is one cache entry however it was
asked for) and capped at 12; anything past the cap is dropped. Each stop
contributes up to 3 departures — the map draws one label, and the spares exist so
a cancelled or already-departed row does not leave it empty. Stop IDs travel to
the upstream API as GraphQL variables, never interpolated into the query
document. A stop the upstream API does not know is omitted from `stops` rather
than returned empty. Cached for 10 seconds.

**Response** `200 OK`:

```json
{
  "stops": {
    "HSL:1203420": {
      "gtfsId": "HSL:1203420",
      "name": "Välimerenkatu",
      "departures": [
        {
          "line": "9",
          "headsign": "Pasila",
          "realtime": true,
          "realtimeDepartureTime": 1781504640000,
          "tripId": "HSL:1009_20260615_Su_2_0910",
          "routeId": "HSL:1009",
          "serviceDate": "2026-06-15",
          "directionId": 1,
          "startTimeSeconds": 33000,
          "mode": "TRAM"
        }
      ]
    }
  },
  "fetchedAt": 1781504400000
}
```

Departures carry the same fields as `/api/v1/stop/{id}`. `400` when no `id` is
given; `502` on an upstream failure.

---

### REST — Trip Details

Get route and ETA info for a specific vehicle trip (supporting both trams and buses).

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/trip/{tripId}` |
| **Auth** | None (backend adds Digitransit key) |

> [!NOTE]  
> If the specific `tripId` is not found, the backend automatically performs a fuzzy fallback lookup using the Digitransit GraphQL `fuzzyTrip(...)` query, matching on route name, direction, operating date, and start time. This helps handle schedule drift and date-mismatch issues.

**Path Parameters:**

| Param | Example | Description |
|---|---|---|
| `tripId` | `HSL:1009_20260616_Mo_1_0915` | GTFS trip ID |

**Response** `200 OK`:

```json
{
  "tripId": "HSL:1009_20260615_Su_1_0915",
  "route": {
    "shortName": "9",
    "longName": "Pasila - Jätkäsaari",
    "color": "#007AC9"
  },
  "headsign": "Jätkäsaari",
  "stops": [
    {
      "name": "Pasila",
      "code": "0089",
      "lat": 60.1989,
      "lon": 24.9337,
      "scheduledArrival": "09:18",
      "realtimeArrival": "09:17",
      "delay": -60,
      "realtime": true
    }
  ],
  "geometry": "encoded_polyline_string"
}
```

---

### REST — Stop Details

Get upcoming transit departures at a specific stop, including cancellations.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/stop/{stopId}` |
| **Query** | `?departures=10` (optional, default 10) |
| **Auth** | None (backend adds Digitransit key) |

**Response** `200 OK`:

```json
{
  "stop": {
    "gtfsId": "HSL:1203420",
    "name": "Välimerenkatu",
    "code": "0613",
    "lat": 60.1629,
    "lon": 24.9213
  },
  "routes": ["9", "9H", "7"],
  "departures": [
    {
      "line": "9",
      "headsign": "Pasila",
      "scheduledArrival": "09:25",
      "realtimeArrival": "09:24",
      "delay": -60,
      "realtime": true,
      "tripId": "HSL:1009_20260615_Su_2_0910"
    }
  ]
}
```

The response also includes:

| Field | Meaning |
|---|---|
| `fetchedAt` | Epoch milliseconds when the backend fetched the result; retained on cache hits |
| `stop.platformCode` | Platform identifier, when provided |
| `departures[].scheduledDeparture` / `realtimeDeparture` | Boarding departure clocks (`HH:mm`), not arrival clocks |
| `departures[].scheduledDepartureTime` / `realtimeDepartureTime` | Epoch milliseconds calculated from the upstream service day and departure seconds; omitted when unknown |
| `departures[].departureDelay` | Departure delay in seconds |
| `departures[].realtimeState` | Upstream state, including `CANCELED` |
| `departures[].routeId` | Route GTFS ID, e.g. `HSL:1009` |
| `departures[].serviceDate` | Operating day (`YYYY-MM-DD`) of the trip, from the upstream service day |
| `departures[].directionId` | `0` or `1`; omitted when upstream reports it as unknown |
| `departures[].startTimeSeconds` | The trip's origin departure, seconds since service midnight; omitted when unknown |
| `departures[].mode` | Route mode: `TRAM`, `BUS`, `SUBWAY`, `RAIL`, `FERRY` |

Together `routeId`, `serviceDate`, `directionId` and `startTimeSeconds` name one
trip unambiguously, which is what lets a client pair a departure with the live
vehicle serving it. They are omitted rather than defaulted when upstream does not
report them: direction zero and a midnight origin are both real values, so
inventing either would match the wrong vehicle rather than no vehicle.

Legacy arrival fields remain for compatibility. Use departure fields for boarding
and absolute timestamps for countdowns, including trips after midnight. A scheduled
departure without a live prediction must not be presented as “on time”.

The UI refreshes open departure boards automatically, retains the last successful
response after errors, and marks failed or old fetches as stale. Cancellation
labels are retained, but cancelled rows cannot select a vehicle.

### REST — Nearby Stops

`GET /api/v1/stops/nearby?lat=60.1699&lon=24.9384&radius=1000`

Coordinates must be finite and within geographic bounds. `radius` is optional
(default 1,000 metres, maximum 3,000). Returns `{ "stops": [...], "fetchedAt": ... }`
with up to ten nearby stops, sorted by distance. Each stop includes the same
metadata as `StopInfo`, optional `platformCode`, and `distance` in metres.
The frontend separately fetches bounded departure previews for these stops.
Invalid parameters return `400`; upstream failures return `502`.

---

### REST — Route Details

Get route geometry polylines and stop list for a specific route line
designation. Trams, metro (`M1`, `M2`) and commuter trains (the letter lines)
are all served here — their short names never collide. Buses are not: there are
hundreds of them, and the map draws the bus network from the JORE vector tiles
instead.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/route/{shortName}` |
| **Auth** | None (backend adds Digitransit key) |

**Path Parameters:**

| Param | Example | Description |
|---|---|---|
| `shortName` | `9` | Short route designator |

**Response** `200 OK`:

```json
{
  "shortName": "9",
  "color": "#007AC9",
  "geometries": [
    "encoded_polyline_points_direction_1",
    "encoded_polyline_points_direction_2"
  ],
  "patterns": [
    { "points": "encoded_polyline_points_direction_1", "directionId": 0 },
    { "points": "encoded_polyline_points_direction_2", "directionId": 1 }
  ],
  "stops": [
    "HSL:1203420",
    "HSL:1203421"
  ]
}
```

`patterns` carries the same deduplicated polylines as `geometries`, in the same
order, each with the GTFS `direction_id` of the pattern it came from. HFP
reports the same two directions as `dir` `"1"` and `"2"` (0 and 1 respectively),
which is what lets the map snap a vehicle to the track its journey actually runs
on rather than to whichever rail is nearest.

---

### REST — Bike Station Details

Get live capacity and rental status for a specific city bike station.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/bike-station/{stationId}` |
| **Auth** | None (backend adds Digitransit key) |

**Path Parameters:**

| Param | Example | Description |
|---|---|---|
| `stationId` | `HSL:1203420` | Bike station ID |

**Response** `200 OK`:

```json
{
  "stationId": "1203420",
  "name": "Välimerenkatu",
  "allowPickup": true,
  "allowDropoff": true,
  "bikesAvailable": 12,
  "spacesAvailable": 8
}
```

---

### REST — Bike Stations (All)

Get every HSL city bike station with live bike/dock counts as a GeoJSON
`FeatureCollection`, ready to feed straight into a MapLibre source. The map uses
this to draw availability markers, since the Digitransit vector tiles carry no
live availability. Cached for 20 seconds server-side.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/bike-stations` |
| **Auth** | None (backend adds Digitransit key) |

**Response** `200 OK`:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [24.9384, 60.1699] },
      "properties": {
        "stationId": "1203420",
        "name": "Välimerenkatu",
        "bikesAvailable": 12,
        "spacesAvailable": 8,
        "allowPickup": true,
        "allowDropoff": true
      }
    }
  ]
}
```

Stations without coordinates are omitted. `coordinates` are `[lon, lat]` per the
GeoJSON spec.

---

### REST — Traffic Lights (All)

Get every known signalized-junction location in Helsinki (ordinary traffic
lights and pedestrian/cyclist warning lights) as a GeoJSON `FeatureCollection`,
sourced from Helsinki's open-data WFS (`avoindata:Liikennevalot_piste` and
`avoindata:Varoitusvalot_piste`, CC BY 4.0 — Helsingin kaupunkiympäristön
toimiala / Kaupunkimittauspalvelut). The frontend uses this, together with a
tram's speed/door-state/stop-id, to label a stopped tram as "waiting at
traffic lights" near a matching junction.

**This is a static location dataset, not a live signal-state feed** — it does
not say whether a given light is red right now, only where signalized
junctions exist. Changes rarely, so it's cached for 24 hours server-side
rather than refetched per request.

What *is* live is what the vehicles ask of these junctions: the `tlp` object on
a vehicle position (see the WebSocket section above) names a junction by the
same `id` these features carry, so the two join on equality. That is where "a
tram is requesting priority at Mannerheimintie/Runeberginkatu" comes from.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/traffic-lights` |
| **Auth** | None |

**Response** `200 OK`:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [24.8823, 60.2016] },
      "properties": {
        "id": 27,
        "type": "traffic_light",
        "junction": "Huopalahdentie/Tietokuja",
        "centered": true
      }
    }
  ]
}
```

`type` is `"traffic_light"` or `"warning_light"`. `coordinates` are `[lon, lat]`
per the GeoJSON spec.

`coordinates` are the **middle of the junction**, not the point in the source
data. Helsinki's open data gives the surveyed signal installation — a
controller cabinet, a mast on a corner — which sits 5-30 m off centre, far
enough to put the marker inside a building or a carriageway away from the tram
waiting at it. The middle is computed offline from the city's street
centrelines (where they meet, and where the marked crossings ring the junction)
by `scripts/generate-junction-centers.mjs`, shipped as a table in the backend
and applied when this endpoint is served; `centered: true` marks a feature that
carries a computed centre, and it is absent on the ones left at their
open-data point. A junction listed twice under one number — two masts of the
same crossing — is served once.

---

### REST — Destination Search (Geocode)

Free-text place search powering the journey planner's destination autocomplete.
Proxies the Digitransit geocoding (Pelias) API server-side so the subscription
key never reaches the browser. Results are constrained to the HSL region and
cached for 60 seconds.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/geocode` |
| **Auth** | None (backend adds Digitransit key) |

**Query Parameters:**

| Param | Required | Example | Description |
|---|---|---|---|
| `text` | Yes | `kamppi` | Free-text search query (min. 2 chars from the client) |
| `lat` | No | `60.1699` | Focus point latitude — ranks nearby results first |
| `lon` | No | `24.9384` | Focus point longitude |

**Response** `200 OK`:

```json
{
  "results": [
    {
      "id": "gtfs:stop:HSL:1040601",
      "name": "Kamppi",
      "label": "Kamppi, Helsinki",
      "locality": "Helsinki",
      "layer": "stop",
      "lat": 60.1690,
      "lon": 24.9310
    }
  ]
}
```

`400` if `text` is missing; `502` on an upstream error.

---

### REST — Journey Plan

Plans a trip between two points and returns ranked itineraries — the routes that
take the rider from origin to destination, including the exact stops to board
and alight at. Proxies the Digitransit routing `plan` query and is cached for 20
seconds. The frontend defaults the origin to the user's current location.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/plan` |
| **Auth** | None (backend adds Digitransit key) |

**Query Parameters:**

| Param | Required | Example | Description |
|---|---|---|---|
| `fromLat` / `fromLon` | Yes | `60.1699` / `24.9384` | Origin coordinates |
| `toLat` / `toLon` | Yes | `60.1990` / `24.9330` | Destination coordinates |
| `numItineraries` | No | `4` | Number of itineraries (1–6, default 4) |
| `arriveBy` | No | `false` | If `true`, treat the time as an arrival deadline |
| `date` / `time` | Together | `2026-09-05` / `23:55` | Service-local planning date and time in Europe/Helsinki; omit both to plan now |
| `modes` | No | `TRAM,BUS` | CSV of transit modes (`TRAM,BUS,RAIL,SUBWAY,FERRY`); `WALK` is always included. Empty = all |

**Response** `200 OK`:

```json
{
  "itineraries": [
    {
      "duration": 1200,
      "walkDistance": 340.5,
      "startTime": 1750000000000,
      "endTime": 1750001200000,
      "transfers": 0,
      "legs": [
        {
          "mode": "WALK",
          "transit": false,
          "duration": 180,
          "distance": 220.0,
          "startTime": 1750000000000,
          "endTime": 1750000180000,
          "from": { "name": "Origin", "lat": 60.17, "lon": 24.94 },
          "to": { "name": "Kamppi", "lat": 60.169, "lon": 24.931, "stopId": "HSL:1040601", "stopCode": "1234" },
          "intermediateStops": [],
          "geometry": "<encoded polyline>"
        },
        {
          "mode": "TRAM",
          "transit": true,
          "duration": 600,
          "distance": 2100.0,
          "startTime": 1750000200000,
          "endTime": 1750000800000,
          "headsign": "Pasila",
          "route": { "shortName": "9", "longName": "Pasila - Jätkäsaari", "color": "007AC9", "mode": "TRAM" },
          "from": { "name": "Kamppi", "lat": 60.169, "lon": 24.931, "stopId": "HSL:1040601", "stopCode": "1234" },
          "to": { "name": "Pasila", "lat": 60.199, "lon": 24.933, "stopId": "HSL:1174501", "stopCode": "5678" },
          "intermediateStops": [
            { "name": "Sokos", "lat": 60.171, "lon": 24.941, "stopId": "HSL:1020101", "stopCode": "0001" }
          ],
          "geometry": "<encoded polyline>"
        }
      ]
    }
  ]
}
```

Plan responses also include `fetchedAt` (epoch milliseconds). Transit legs expose
`legId` (opaque refresh identifier), `tripId`, `serviceDate` (`YYYY-MM-DD`),
`realtime`, `realtimeState`, `departureDelay` and `arrivalDelay` (seconds).
Optional `directionId` is GTFS 0/1; `startTimeSeconds` is the trip's origin
departure in service-day seconds, not the rider's boarding time. These fields,
plus `route.gtfsId`, allow conservative matching to HFP telemetry. Stop places
include `platformCode` when available.

`startTime` and `endTime` are epoch milliseconds and reflect predictions where
available. `scheduledStartTime` / `scheduledEndTime` preserve the scheduled
epochs when upstream delay information permits deriving them. Never infer the
operating day from the calendar date of a post-midnight boarding.

`400` on missing/invalid coordinates or date/time; `404` if no journey is found;
`502` on an upstream error.

### REST — Monitor Selected Journey

`GET /api/v1/journey/monitor?legId=...&legId=...`

Accepts one to eight opaque leg IDs from a plan response (up to 2,048 characters
each). Refreshes those exact legs via Digitransit's `leg(id:)` query, including
after boarding, rather than replacing them with a newly planned journey.
Responses are cached for ten seconds.

Returns `{ "legs": [...], "fetchedAt": ... }`, preserving request order. Each
element uses the journey-leg schema above or is `null` when that original leg
is unavailable. Missing legs do **not** prove cancellation. The UI retains
their last known data as stale and offers an explicit search for alternatives.

Transfer warnings subtract walking time from the interval between transit legs.
They are estimates, not guaranteed connections; scheduled or stale data is
identified separately. Invalid requests return `400`; upstream errors return
`502`.

---

### REST — Replay Index

What history the server holds, and where its gaps are. The client draws the
timeline's shaded stretches from `days`, and scrubs against `serverTime` rather
than the browser's own clock — a browser running fast would otherwise let the
scrubber run past the end of the archive.

Coverage is reported per hour rather than per minute: a week is 10,080 minutes,
and the timeline only needs to know where the gaps are.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/replay/index` |
| **Cache** | `public, max-age=15` |

**Response** `200 OK`:

```json
{
  "enabled": true,
  "modes": ["tram"],
  "retentionDays": 7,
  "serverTime": 1757174400,
  "days": [
    {
      "date": "2026-09-06",
      "hours": { "tram": [60, 60, 0, 0, 0, 0, 12, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60] }
    }
  ]
}
```

`enabled` is `false` only where recording was turned off (`REPLAY_DIR=off`) or
the archive could not be opened. Recording is otherwise on by default, into
`/data/replay`: an instance that says nothing about replay still has a
timelapse, and one that names no directory keeps a day rather than a week,
because with no volume mounted there the archive is writing into the
container's own layer. Where `enabled` is `false` the frontend hides the
timelapse entirely rather than offering a control that does nothing.

---

### REST — Replay Window

A slice of recorded history for playback. Every sample carries the same field
names as a live vehicle on the WebSocket, so the map draws a replayed tram with
the code it already uses for a running one.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/replay/window` |
| **Query** | `from`, `to` (Unix seconds, max 15 minutes apart), `step`, `modes`, `bbox` |

`step` thins the result to at most one reading per vehicle per that many
seconds, and is how fast playback stays affordable: sixty times real time draws
the same number of steps as one times, each covering sixty times the ground, so
it fetches an eighth of the readings rather than sixty times as many. Capped at
60.

**Response** `200 OK`:

```json
{
  "from": 1757174400,
  "to": 1757174520,
  "truncated": false,
  "scanned": 9840,
  "samples": [
    {
      "veh": "0040-456", "desi": "9", "lat": 60.171234, "lng": 24.941234,
      "hdg": 187, "spd": 8.42, "acc": -0.31, "dl": -45, "drst": 0,
      "route": "1009", "stop": null, "nextStop": "HSL:1020450",
      "ts": 1757174401, "tripId": "HSL:1009_20260906_Su_1_1736", "mode": "tram"
    }
  ]
}
```

A window that finished more than two minutes ago can never change and is served
`public, max-age=86400, immutable`; one running up to now is still being
appended to and is `no-store`. `truncated` reports that the server's sample cap
was reached and later readings in the window are missing.

`503` when no archive is configured; `400` for a reversed, zero-length or
over-long span.

---

### REST — Timelapse

Every reading that passed through one place over a long span — the query the
packed archive exists for. A junction over a week is on the order of a hundred
thousand readings out of tens of millions, so the bounding box is what makes
the span affordable, and it is required here rather than optional.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/replay/timelapse` |
| **Query** | `from`, `to` (up to the whole retention window), `bbox` (**required**), `step`, `modes` |

`bbox` is `west,south,east,north` in degrees, and may cover at most 0.04 square
degrees — comfortably more than the tram network, and far less than "the whole
world for a week".

The response is shaped exactly like [Replay Window](#rest--replay-window).
`scanned` counts every reading walked, hits and misses together: the filter
rejects rather than skips, which is what the fixed-width record makes cheap —
eight bytes are read per rejected reading and nothing is decoded.

`400` for a missing, malformed, inverted or over-large box.

---

### REST — Health Check

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/health` |

**Response** `200 OK`:

```json
{
  "status": "healthy",
  "mqtt_connected": true,
  "redis_connected": true,
  "active_vehicles": 48,
  "uptime_seconds": 3600
}
```

---

### REST — Version Info

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/version` |

**Response** `200 OK`:

```json
{
  "version": "v1.2.3",
  "build_date": "2026-06-15T09:00:00Z",
  "git_sha": "abc123f"
}
```
