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

#### Topic Pattern

```
/hfp/v2/journey/ongoing/vp/tram/#
```

Topic hierarchy (each segment is filterable with `+` wildcard):

```
/hfp/v2/journey/ongoing/vp/{transport_mode}/{operator_id}/{vehicle_number}/{route_id}/{direction_id}/{headsign}/{start_time}/{next_stop}/{geohash_level}/{geohash}/#
```

For trams, `{transport_mode}` = `tram`.

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
| `dl` | `int` | Delay in seconds (negative = early) | Schedule info |
| `drst` | `int` | Door status (0=closed, 1=open) | Stopped indicator |
| `route` | `string` | GTFS route ID (e.g. `"HSL:1009"`) | Route lookup |
| `stop` | `string?` | Current/next stop GTFS ID (null if between stops) | Stop association |
| `tst` | `string` | ISO 8601 timestamp | Freshness check |
| `start` | `string` | Trip start time (`"HH:MM"`) | Trip identification |
| `oday` | `string` | Operating day (`"YYYY-MM-DD"`) | Trip identification |
| `dir` | `string` | Direction ID (`"1"` or `"2"`) | Trip identification |

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
    stoptimesWithoutPatterns(numberOfDepartures: $numberOfDepartures) {
      scheduledArrival
      realtimeArrival
      arrivalDelay
      realtime
      realtimeState
      headsign
      trip {
        gtfsId
        route {
          shortName
          color
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
| **Direction** | Server → Client (unidirectional broadcast) |
| **Frequency** | 1 snapshot per second |

#### Message Format (Server → Client)

```json
{
  "type": "positions",
  "timestamp": "2026-06-15T09:30:15Z",
  "vehicles": {
    "229": {
      "veh": 229,
      "desi": "9",
      "lat": 60.16985,
      "lng": 24.93848,
      "hdg": 145,
      "spd": 8.5,
      "dl": -15,
      "drst": 0,
      "route": "HSL:1009",
      "stop": "HSL:1203420",
      "ts": 1781461815
    },
    "412": { ... }
  },
  "count": 48
}
```

The `vehicles` map is keyed by vehicle ID. The frontend replaces its entire state each tick and uses the previous + current positions to lerp.

---

### REST — Trip Details

Get route and ETA info for a specific tram trip.

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/v1/trip/{tripId}` |
| **Auth** | None (backend adds Digitransit key) |

**Path Parameters:**

| Param | Example | Description |
|---|---|---|
| `tripId` | `HSL:1009_20260615_Su_1_0915` | GTFS trip ID |

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

Get upcoming tram arrivals at a specific stop.

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
