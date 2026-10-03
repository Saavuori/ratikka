"""Generates trams-dashboard.json, the Grafana dashboard over the per-vehicle
history the backend writes to InfluxDB (measurement vehicle_position; see
docs/MONITORING.md section 5), and trams-dashboard-shareable.json, the same
without template variables, which Grafana's public dashboards do not support.

The output is in Grafana's export format: importing it asks for the InfluxDB
datasource (InfluxQL) and the bucket name, so neither is baked in here.

    python monitoring/grafana/build_trams_dashboard.py
"""

import copy
import json
from pathlib import Path

DS = {"type": "influxdb", "uid": "${DS_INFLUXDB}"}
M = '"${VAR_BUCKET}"."autogen"."vehicle_position"'
LINE = '"desi" =~ /^$line$/'
VEH = '"veh" =~ /^$veh$/'
# Only readings with a satellite fix. Between fixes a tram dead-reckons
# (loc_source "DR"), and its estimated speed runs away: one on line 15 "did"
# 125 km/h for twelve seconds while its odometer said 50, and dropped to 54 the
# moment the fix came back. Every reading over 90 km/h in the first hour of
# data was dead reckoning.
GPS = """"loc_source" = 'GPS'"""

# The live map. Its timelapse takes a moment and a tram (?at=…&veh=…, see
# frontend/src/lib/replayLink.ts) and opens history there, with that tram
# picked and followed.
APP_URL = "https://hsl-live.duckdns.org/"


def replay_link(title, veh):
    """A data link that opens the clicked moment in the app's timelapse."""
    return {"title": title, "url": APP_URL + "?at=${__value.time}&veh=" + veh, "targetBlank": True}
NOW = "time > now() - 2m"
# A tram still signed on to a journey it is not running reports itself hours
# late (two hours, measured on the first afternoon of data), and one such tram
# drags its whole line's average up by ten minutes. Delay aggregates leave out
# anything more than half an hour off; the table and the per-tram panels still
# show the raw value, which is how those trams are found.
SANE = '"delay" > -1800 AND "delay" < 1800'
SANE_D = '"d" > -1800 AND "d" < 1800'
SANE_NOTE = " Readings more than 30 min off schedule are left out: those are trams signed on to a journey they are not running."

_ids = iter(range(1, 1000))


def target(query, ref="A", alias="", fmt="time_series"):
    return {
        "datasource": DS,
        "refId": ref,
        "query": query,
        "rawQuery": True,
        "resultFormat": fmt,
        "alias": alias,
    }


def panel(kind, title, x, y, w, h, targets, description="", unit=None, **extra):
    p = {
        "id": next(_ids),
        "type": kind,
        "title": title,
        "description": description,
        "datasource": DS,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": targets,
        "fieldConfig": {"defaults": {}, "overrides": []},
        "options": {},
    }
    if unit:
        p["fieldConfig"]["defaults"]["unit"] = unit
    for k, v in extra.items():
        if k == "defaults":
            p["fieldConfig"]["defaults"].update(v)
        elif k == "overrides":
            p["fieldConfig"]["overrides"] = v
        else:
            p[k] = v
    return p


def row(title, y):
    return {"id": next(_ids), "type": "row", "title": title, "collapsed": False,
            "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "panels": []}


def thresholds(*steps):
    return {"mode": "absolute",
            "steps": [{"color": c, "value": v} for v, c in steps]}


def stat(title, x, y, query, unit, steps, description="", decimals=None):
    # A count over nothing returns no rows at all, which reads as "No data"
    # rather than the zero it is.
    d = {"thresholds": thresholds(*steps), "color": {"mode": "thresholds"}, "noValue": "0"}
    if decimals is not None:
        d["decimals"] = decimals
    return panel("stat", title, x, y, 4, 4, [target(query)], description, unit,
                 defaults=d,
                 options={"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                          "colorMode": "background", "graphMode": "area", "textMode": "value"})


def series(title, x, y, w, h, targets, unit, description="", stack=False, bars=False, **custom):
    c = {"lineWidth": 1, "fillOpacity": 10, "showPoints": "never", "spanNulls": False}
    if stack:
        c.update({"stacking": {"mode": "normal", "group": "A"}, "fillOpacity": 60})
    if bars:
        c.update({"drawStyle": "bars", "fillOpacity": 80})
    c.update(custom)
    return panel("timeseries", title, x, y, w, h, targets, description, unit,
                 defaults={"custom": c},
                 options={"legend": {"displayMode": "table", "placement": "right",
                                     "calcs": ["mean", "max"], "sortBy": "Mean", "sortDesc": True},
                          "tooltip": {"mode": "multi", "sort": "desc"}})


def last_as(field, alias):
    return f'last("{field}") AS "{alias}"'


def last_per_vehicle(fields, where=NOW, extra_where=LINE, group='"veh"'):
    return f'SELECT {fields} FROM {M} WHERE {where} AND {extra_where} GROUP BY {group}'


panels = []
y = 0

# --- Now ---------------------------------------------------------------
panels.append(row("Right now", y)); y += 1
panels += [
    stat("Trams in service", 0, y,
         f'SELECT count("lat") FROM ({last_per_vehicle(last_as("lat", "lat"))})',
         "none", [(None, "blue")], "Trams that reported a position in the last two minutes."),
    stat("Average delay", 4, y,
         f'SELECT mean("d") / 60 FROM ({last_per_vehicle(last_as("delay", "d"))}) WHERE {SANE_D}',
         "m", [(None, "green"), (2, "yellow"), (4, "red")],
         "Mean of every tram's current delay. Negative is early." + SANE_NOTE, decimals=1),
    stat("Late by over 3 min", 8, y,
         f'SELECT count("d") FROM ({last_per_vehicle(last_as("delay", "d"))}) WHERE "d" > 180 AND "d" < 1800',
         "none", [(None, "green"), (3, "yellow"), (8, "red")], SANE_NOTE.strip()),
    stat("Early by over 1 min", 12, y,
         f'SELECT count("d") FROM ({last_per_vehicle(last_as("delay", "d"))}) WHERE "d" < -60 AND "d" > -1800',
         "none", [(None, "green"), (2, "yellow"), (5, "red")],
         "Running early is worse than late for a rider: the tram leaves before they arrive."),
    stat("Bunched", 16, y,
         f'SELECT count("s") FROM ({last_per_vehicle(last_as("headway_state", "s"))}) WHERE "s" = \'bunched\'',
         "none", [(None, "green"), (2, "yellow"), (5, "red")],
         "Trams running so close behind the one ahead on their line that the two arrive together."),
    stat("Behind a gap", 20, y,
         f'SELECT count("s") FROM ({last_per_vehicle(last_as("headway_state", "s"))}) WHERE "s" = \'gap\'',
         "none", [(None, "green"), (2, "yellow"), (5, "red")],
         "Trams running well behind the one ahead, leaving the stops between them waiting."),
]
y += 4

panels.append(panel(
    "geomap", "Where they are", 0, y, 12, 14,
    [target(f'SELECT last("lat") AS "lat", last("lng") AS "lng", last("delay") / 60 AS "delay", '
            f'last("speed") * 3.6 AS "speed" FROM {M} WHERE {NOW} AND {LINE} GROUP BY "veh", "desi"',
            fmt="table")],
    "Latest position of every tram, coloured by delay.",
    defaults={"thresholds": thresholds((None, "green"), (2, "yellow"), (4, "red")),
              "color": {"mode": "thresholds"}},
    # Units go on their own columns: as a default, "m" would also label the
    # line names, and line 15 would read "15 min".
    overrides=[
        {"matcher": {"id": "byName", "options": "delay"},
         "properties": [{"id": "unit", "value": "m"}, {"id": "decimals", "value": 1}]},
        {"matcher": {"id": "byName", "options": "speed"},
         "properties": [{"id": "unit", "value": "velocitykmh"}, {"id": "decimals", "value": 0}]},
    ],
    options={
        "view": {"id": "coords", "lat": 60.18, "lon": 24.94, "zoom": 12},
        "controls": {"showZoom": True, "mouseWheelZoom": True},
        "basemap": {"type": "default", "name": "Basemap"},
        "layers": [{
            "type": "markers", "name": "Trams",
            "location": {"mode": "coords", "latitude": "lat", "longitude": "lng"},
            "config": {
                "showLegend": True,
                "style": {
                    "size": {"fixed": 7},
                    "color": {"field": "delay"},
                    "opacity": 0.9,
                    "symbol": {"mode": "fixed", "fixed": "img/icons/marker/circle.svg"},
                    "text": {"mode": "field", "field": "desi"},
                    "textConfig": {"fontSize": 10, "offsetX": 0, "offsetY": -12,
                                   "textAlign": "center", "textBaseline": "middle"},
                },
            },
            "tooltip": True,
        }],
        "tooltip": {"mode": "details"},
    }))

panels.append(panel(
    "table", "Every tram now", 12, y, 12, 14,
    [target(f'SELECT last("delay") / 60 AS "Delay", last("speed") * 3.6 AS "Speed", '
            f'last("headway") / 60 AS "Behind ahead", last("headway_state") AS "Headway", '
            f'last("next_stop") AS "Next stop" FROM {M} WHERE {NOW} AND {LINE} GROUP BY "desi", "veh", "dir"',
            fmt="table")],
    "Sorted by delay. Click a column header to re-sort.",
    defaults={"custom": {"align": "auto", "filterable": True}},
    overrides=[
        {"matcher": {"id": "byName", "options": "Time"},
         "properties": [{"id": "custom.hidden", "value": True}]},
        {"matcher": {"id": "byName", "options": "Delay"},
         "properties": [{"id": "unit", "value": "m"}, {"id": "decimals", "value": 1},
                        {"id": "thresholds", "value": thresholds((None, "green"), (2, "yellow"), (4, "red"))},
                        {"id": "custom.cellOptions", "value": {"type": "color-background", "mode": "basic"}}]},
        {"matcher": {"id": "byName", "options": "Speed"},
         "properties": [{"id": "unit", "value": "velocitykmh"}, {"id": "decimals", "value": 0}]},
        {"matcher": {"id": "byName", "options": "Behind ahead"},
         "properties": [{"id": "unit", "value": "m"}, {"id": "decimals", "value": 1}]},
        {"matcher": {"id": "byName", "options": "Headway"},
         "properties": [{"id": "mappings", "value": [{"type": "value", "options": {
             "bunched": {"color": "red", "index": 0},
             "gap": {"color": "orange", "index": 1},
             "regular": {"color": "green", "index": 2}}}]},
            {"id": "custom.cellOptions", "value": {"type": "color-text"}}]},
        {"matcher": {"id": "byName", "options": "desi"},
         "properties": [{"id": "displayName", "value": "Line"}]},
        {"matcher": {"id": "byName", "options": "veh"},
         "properties": [{"id": "displayName", "value": "Tram"}]},
        {"matcher": {"id": "byName", "options": "dir"},
         "properties": [{"id": "displayName", "value": "Dir"}]},
    ],
    options={"showHeader": True, "sortBy": [{"displayName": "Delay", "desc": True}],
             "cellHeight": "sm"}))
y += 14

# --- Punctuality ---------------------------------------------------------
panels.append(row("Punctuality", y)); y += 1
panels.append(series(
    "Average delay by line", 0, y, 16, 9,
    [target(f'SELECT mean("delay") / 60 FROM {M} WHERE $timeFilter AND {LINE} AND {SANE} '
            f'GROUP BY time($__interval), "desi" fill(null)', alias="$tag_desi")],
    "m", "Mean delay across every reading of the line. Positive is late." + SANE_NOTE))
panels.append(panel(
    "bargauge", "Average delay over the period", 16, y, 8, 9,
    [target(f'SELECT mean("delay") / 60 AS "delay" FROM {M} WHERE $timeFilter AND {LINE} AND {SANE} GROUP BY "desi"',
            alias="$tag_desi")],
    SANE_NOTE.strip(), "m",
    defaults={"thresholds": thresholds((None, "blue"), (-0.5, "green"), (2, "yellow"), (4, "red")),
              "color": {"mode": "thresholds"}, "decimals": 1},
    options={"orientation": "horizontal", "displayMode": "gradient", "showUnfilled": True,
             "reduceOptions": {"calcs": ["mean"], "fields": "", "values": False}}))
y += 9
panels.append(series(
    "Trams in service by line", 0, y, 16, 8,
    [target(f'SELECT count("lat") FROM (SELECT last("lat") AS "lat" FROM {M} WHERE $timeFilter AND {LINE} '
            f'GROUP BY time(1m), "veh", "desi") WHERE $timeFilter GROUP BY time(1m), "desi" fill(0)',
            alias="$tag_desi")],
    "none", "Distinct trams reporting each minute.", stack=True))
panels.append(series(
    "Delay spread", 16, y, 8, 8,
    [target(f'SELECT percentile("delay", 10) / 60 AS "p10", median("delay") / 60 AS "median", '
            f'percentile("delay", 90) / 60 AS "p90" FROM {M} WHERE $timeFilter AND {LINE} AND {SANE} '
            f'GROUP BY time($__interval) fill(null)', alias="$col")],
    "m", "The 10th and 90th percentile show how far the worst trams are from the typical one."))
y += 8

# --- Headways ------------------------------------------------------------
panels.append(row("Headways", y)); y += 1
panels.append(series(
    "Bunched trams by line", 0, y, 12, 8,
    [target(f'SELECT count("headway") * 1000 / $__interval_ms FROM {M} WHERE $timeFilter AND {LINE} '
            f'AND "headway_state" = \'bunched\' GROUP BY time($__interval), "desi" fill(0)',
            alias="$tag_desi")],
    "none", "Average number of trams running bunched with the one ahead.", stack=True))
panels.append(series(
    "Trams behind a gap by line", 12, y, 12, 8,
    [target(f'SELECT count("headway") * 1000 / $__interval_ms FROM {M} WHERE $timeFilter AND {LINE} '
            f'AND "headway_state" = \'gap\' GROUP BY time($__interval), "desi" fill(0)',
            alias="$tag_desi")],
    "none", "Average number of trams running well behind the one ahead.", stack=True))
y += 8
panels.append(series(
    "Actual vs timetabled headway", 0, y, 24, 8,
    [target(f'SELECT mean("headway") / 60 FROM {M} WHERE $timeFilter AND {LINE} '
            f'AND "headway_at_least" = false GROUP BY time($__interval), "desi" fill(null)',
            "A", "$tag_desi"),
     # No tram line runs hourly. A longer "timetabled" headway is the
     # backend's line-spacing median thrown off by trams reporting delays of
     # hours, not a timetable.
     target(f'SELECT mean("headway_scheduled") / 60 FROM {M} WHERE $timeFilter AND {LINE} '
            f'AND "headway_scheduled" < 3600 GROUP BY time($__interval), "desi" fill(null)', "B", "$tag_desi timetabled")],
    "m", "Measured minutes behind the tram ahead (solid) against the line's timetabled headway (dashed)."))
panels[-1]["fieldConfig"]["overrides"] = [{
    "matcher": {"id": "byRegexp", "options": ".* timetabled"},
    "properties": [{"id": "custom.lineStyle", "value": {"fill": "dash", "dash": [6, 4]}}],
}]
y += 8

# --- Movement ------------------------------------------------------------
panels.append(row("Speed and movement", y)); y += 1
panels.append(series(
    "Average running speed by line", 0, y, 12, 8,
    [target(f'SELECT mean("speed") * 3.6 FROM {M} WHERE $timeFilter AND {LINE} AND "speed" > 0.5 '
            f'GROUP BY time($__interval), "desi" fill(null)', alias="$tag_desi")],
    "velocitykmh", "Mean speed while moving: readings standing still are left out."))
panels.append(series(
    "Share of time standing still", 12, y, 12, 8,
    [target(f'SELECT count("speed") FROM {M} WHERE $timeFilter AND {LINE} AND "speed" < 0.5 '
            f'GROUP BY time($__interval) fill(0)', "A", "still"),
     target(f'SELECT count("speed") FROM {M} WHERE $timeFilter AND {LINE} '
            f'GROUP BY time($__interval) fill(0)', "B", "all")],
    "percentunit", "Stops, signals and queues together: readings under 0.5 m/s over all readings."))
# InfluxQL cannot divide one query by another, so Grafana does.
panels[-1]["transformations"] = [
    {"id": "joinByField", "options": {"byField": "Time", "mode": "outer"}},
    {"id": "calculateField", "options": {
        "mode": "binary", "alias": "Standing still",
        "binary": {"left": "still", "operator": "/", "right": "all"},
        "replaceFields": True}},
]
panels[-1]["fieldConfig"]["defaults"]["max"] = 1
panels[-1]["fieldConfig"]["defaults"]["min"] = 0
panels[-1]["options"]["legend"] = {"displayMode": "list", "placement": "bottom", "calcs": []}
y += 8
panels.append(series(
    "Traffic light priority", 0, y, 24, 7,
    [target(f'SELECT count("tlp_junction") * 1000 / $__interval_ms FROM {M} WHERE $timeFilter AND {LINE} '
            f'AND "tlp_status" = \'{s}\' GROUP BY time($__interval) fill(0)', ref, s)
     for ref, s in (("A", "granted"), ("B", "denied"), ("C", "requesting"))],
    "none", "Average number of trams whose latest signal priority request was granted, denied or still pending.",
    stack=True))
panels[-1]["fieldConfig"]["overrides"] = [
    {"matcher": {"id": "byName", "options": n}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": c}}]}
    for n, c in (("granted", "green"), ("denied", "red"), ("requesting", "yellow"))
]
y += 7

# --- Top speeds -----------------------------------------------------------
panels.append(row("Top speeds", y)); y += 1
panels.append(panel(
    "table", "Fastest trams", 0, y, 12, 12,
    [target(f'SELECT max("speed") * 3.6 AS "Top speed", "next_stop" AS "Heading for" FROM {M} '
            f'WHERE $timeFilter AND {LINE} AND {GPS} GROUP BY "desi", "veh"', fmt="table")],
    "Each tram's fastest reading in the time range, satellite fixes only. "
    "Click a tram to watch that moment on the live map's timelapse.",
    defaults={"custom": {"align": "auto", "filterable": True}},
    overrides=[
        {"matcher": {"id": "byName", "options": "Time"},
         "properties": [{"id": "displayName", "value": "When"}, {"id": "unit", "value": "time:ddd D.M. HH:mm:ss"}]},
        {"matcher": {"id": "byName", "options": "Top speed"},
         "properties": [{"id": "unit", "value": "velocitykmh"}, {"id": "decimals", "value": 0},
                        {"id": "custom.cellOptions", "value": {"type": "gauge", "mode": "basic"}},
                        {"id": "min", "value": 0}, {"id": "max", "value": 80},
                        {"id": "color", "value": {"mode": "continuous-GrYlRd"}}]},
        {"matcher": {"id": "byName", "options": "veh"},
         "properties": [{"id": "displayName", "value": "Tram"},
                        {"id": "links", "value": [replay_link("Watch on the map", "${__data.fields.veh}")]}]},
        {"matcher": {"id": "byName", "options": "desi"},
         "properties": [{"id": "displayName", "value": "Line"}]},
    ],
    options={"showHeader": True, "sortBy": [{"displayName": "Top speed", "desc": True}], "cellHeight": "sm"}))
panels.append(series(
    "Top speed by line", 12, y, 12, 12,
    [target(f'SELECT max("speed") * 3.6 FROM {M} WHERE $timeFilter AND {LINE} AND {GPS} '
            f'GROUP BY time($__interval), "desi" fill(null)', alias="$tag_desi")],
    "velocitykmh", "Fastest satellite-fixed reading on each line in each interval."))
y += 12

# --- One tram ------------------------------------------------------------
panels.append(row("Selected trams", y)); y += 1
panels.append(series(
    "Speed", 0, y, 12, 8,
    [target(f'SELECT mean("speed") * 3.6 FROM {M} WHERE $timeFilter AND {VEH} '
            f'GROUP BY time($__interval), "veh" fill(null)', alias="$tag_veh")],
    "velocitykmh", "Pick trams in the Tram selector at the top. Click a point to watch that moment on the map."))
panels.append(series(
    "Delay", 12, y, 12, 8,
    [target(f'SELECT mean("delay") / 60 FROM {M} WHERE $timeFilter AND {VEH} '
            f'GROUP BY time($__interval), "veh" fill(null)', alias="$tag_veh")],
    "m"))
y += 8
panels.append(series(
    "Behind the tram ahead", 0, y, 12, 8,
    [target(f'SELECT mean("headway") / 60 FROM {M} WHERE $timeFilter AND {VEH} '
            f'GROUP BY time($__interval), "veh" fill(null)', alias="$tag_veh")],
    "m"))
panels.append(series(
    "Distance into the journey", 12, y, 12, 8,
    [target(f'SELECT last("odometer") / 1000 FROM {M} WHERE $timeFilter AND {VEH} '
            f'GROUP BY time($__interval), "veh" fill(null)', alias="$tag_veh")],
    "lengthkm", "From the tram's odometer, which HFP counts from the start of each journey."))
y += 8

# Every per-tram graph is one series per tram, labelled by it, so a click on
# any point knows both the moment and the tram.
for p in panels:
    if p["type"] == "timeseries" and any(VEH in t["query"] for t in p["targets"]):
        p["fieldConfig"]["defaults"]["links"] = [replay_link("Watch on the map", "${__field.labels.veh}")]

# --- Speed along the route -------------------------------------------------
# Every trip of one line and direction, speed against how far into the journey
# it was. HFP's odometer counts from the start of each journey, so trips of
# the same route share a distance axis and overlay: the same stop is a dip to
# zero at the same distance on every line, and a slow run shows as a lower
# line rather than as a later timestamp.
#
# Grafana's Trend panel draws one series per field against a numeric x, but
# takes a single frame. So the readings are split into a frame per trip, named
# by tram and scheduled departure, and outer-joined back together on distance;
# spanNulls bridges the gaps the join leaves between one trip's readings.
# Averaged over 5 s to keep a few hours of a line to a few thousand rows.
PROFILE = '"desi" = \'$pline\' AND "dir" = \'$pdir\''
panels.append(row("Speed along the route", y)); y += 1
panels.append(panel(
    "trend", "Speed profile", 0, y, 24, 14,
    [target(f'SELECT max("odometer") / 1000 AS "distance", mean("speed") * 3.6 AS "speed", '
            f'last("start") AS "start" FROM {M} WHERE $timeFilter AND {PROFILE} AND {GPS} '
            f'GROUP BY time(5s), "veh" fill(none)', fmt="table")],
    "Speed against distance into the journey: one line per trip of the line and direction picked "
    "above (Profile line, Direction), labelled with its tram and scheduled departure. Dips to zero are "
    "stops, signals and queues. Click a trip in the legend to show only it; shift-click to add others. "
    "Keep the time range within a day: a tram running the same departure on two days would join them.",
    "velocitykmh",
    defaults={"custom": {"lineWidth": 1, "fillOpacity": 0, "showPoints": "never", "spanNulls": True,
                         "drawStyle": "line"}, "min": 0},
    overrides=[{"matcher": {"id": "byName", "options": "distance"},
                "properties": [{"id": "unit", "value": "lengthkm"},
                               {"id": "displayName", "value": "Distance into the journey"}]}],
    options={"xField": "distance",
             "legend": {"showLegend": True, "displayMode": "list", "placement": "right"},
             "tooltip": {"mode": "single", "sort": "none"}},
    transformations=[
        {"id": "organize", "options": {"excludeByName": {"Time": True}}},
        {"id": "partitionByValues", "options": {"fields": ["start", "veh"], "keepFields": False,
                                                "naming": {"asLabels": False}}},
        {"id": "joinByField", "options": {"byField": "distance", "mode": "outer"}},
        {"id": "sortBy", "options": {"sort": [{"field": "distance"}]}},
    ]))
y += 14


def query_var(name, label, query, multi=True, include_all=True):
    return {
        "name": name, "label": label, "type": "query", "datasource": DS,
        "query": query, "definition": query, "refresh": 2, "sort": 3,
        "multi": multi, "includeAll": include_all, "allValue": ".*",
        "current": {"selected": True, "text": ["All"], "value": ["$__all"]},
        "options": [], "hide": 0, "regex": "",
    }


dashboard = {
    "__inputs": [
        {"name": "DS_INFLUXDB", "label": "InfluxDB", "description": "InfluxQL datasource for the InfluxDB the backend writes to",
         "type": "datasource", "pluginId": "influxdb", "pluginName": "InfluxDB"},
        {"name": "VAR_BUCKET", "label": "Bucket", "description": "INFLUX_BUCKET on the server",
         "type": "constant", "value": "ratikka"},
    ],
    "__requires": [
        {"type": "datasource", "id": "influxdb", "name": "InfluxDB", "version": "1.0.0"},
        {"type": "panel", "id": "geomap", "name": "Geomap", "version": ""},
    ],
    "title": "HSL Trams",
    "uid": "hsl-trams",
    "description": "Per-tram history from the ratikka backend: punctuality, headways, speed and positions.",
    "tags": ["ratikka", "hsl", "trams"],
    "timezone": "browser",
    "editable": True,
    "graphTooltip": 1,
    "refresh": "1m",
    "time": {"from": "now-6h", "to": "now"},
    "schemaVersion": 39,
    "templating": {"list": [
        query_var("line", "Line", f'SHOW TAG VALUES FROM {M} WITH KEY = "desi"'),
        # No "All": a hundred trams on one graph says nothing. Grafana starts
        # on the first tram instead.
        query_var("veh", "Tram", f'SHOW TAG VALUES FROM {M} WITH KEY = "veh" WHERE {LINE}', include_all=False),
        # The speed profile is one route at a time: two lines' trips share no
        # distance axis.
        dict(query_var("pline", "Profile line", f'SHOW TAG VALUES FROM {M} WITH KEY = "desi"',
                       multi=False, include_all=False), current={"text": "4", "value": "4"}),
        {"name": "pdir", "label": "Direction", "type": "custom", "query": "1,2", "multi": False,
         "includeAll": False, "current": {"text": "1", "value": "1"}, "hide": 0,
         "options": [{"text": "1", "value": "1", "selected": True}, {"text": "2", "value": "2", "selected": False}]},
    ]},
    "panels": panels,
}
dashboard["templating"]["list"][1]["current"] = {}



def shareable(d):
    """The same dashboard without template variables. It shows every line, and
    leaves out the per-tram section, which is nothing without a tram to pick.
    The time range and $__interval are Grafana's own and still work."""
    d = copy.deepcopy(d)
    d["title"] += " (shareable)"
    d["uid"] += "-shareable"
    d["description"] += " A copy without template variables, for sharing outside Grafana."
    d["templating"] = {"list": []}
    cut = next(i for i, p in enumerate(d["panels"]) if p["type"] == "row" and p["title"] == "Selected trams")
    d["panels"] = d["panels"][:cut]
    for p in d["panels"]:
        for t in p.get("targets", []):
            t["query"] = t["query"].replace(f" AND {LINE}", "")
            assert "$line" not in t["query"] and "$veh" not in t["query"], t["query"]
    return d


for name, d in (("trams-dashboard.json", dashboard), ("trams-dashboard-shareable.json", shareable(dashboard))):
    out = Path(__file__).with_name(name)
    out.write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(d['panels'])} panels)")

