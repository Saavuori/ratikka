# HSL-LIVE Changelog

All notable changes to this project will be documented in this file.

## [v0.68.1] - 2026-09-08

### Changed
- **"I'm on board" only appears once the map is locating you.** The offer to find the vehicle you are sitting in sat at the bottom of the map at all times, including for a reader who has never told the map where they are — and tapping it opened with a permission prompt out of nowhere. It now follows the map's own locate control: switch that on and the offer is there, switch it off and it goes away, because a reader who has not put themselves on the map is not asking to be found. The control's background state — where the dot keeps up after a pan but the camera has been let go — still counts as on. A search or a ride already under way stays on screen whatever the locate control does afterwards, so nothing can strand a rider with a search running and no way to stop it.

### Fixed
- **The ride-along strip fits on the screen, and can be called off.** On a phone the "Looking for your vehicle" card hung off the bottom of the map: its lines were stacked instead of laid out in a row, the bottom half of it disappeared under the tab bar, and the button that stops the search went with it — leaving a search that could be started and not stopped. The card is one of the map's glass panels, and those are written for the popups that float over the map: they take themselves out of the flow and stack their contents downwards. The bottom dock lays its cards out itself, so an out-of-flow card left the dock measuring nothing at all, and the card grew down from the dock's own edge and through the tab bar rather than sitting above it. It is a row in the dock's flow again, so the dock is as tall as what it holds and everything in it clears the tab bar, the version badge and the map's own controls. The stop button says **Stop** rather than showing a crosshair, because the one thing a rider needs from that card while it is still searching is the way out of it.
- **The vehicle toggles still work while a ride is being looked for.** Finding the vehicle you are sitting in needs every mode on the wire — the bus under you cannot be matched against a feed that is switched off — but that requirement had been wired straight to what the map draws, so starting a search turned on buses, metro, trains and ferries for everyone to look at, and tapping the toggles did nothing until the search ended. What is subscribed to and what is drawn are now two separate questions: the extra feeds stream for the detector and stay invisible, the toggles keep deciding what is on the map, and the one vehicle the search settles on is drawn whatever the toggles say — which is the only marker the search was ever asked for.

---

## [v0.68.0] - 2026-09-08

### Added
- **The map can work out which vehicle you are sitting in, and ride it with you.** Following a tram has meant finding it on the map first — which is the one thing that is genuinely awkward to do from inside it, where a dozen markers are within a block of you and the one under your feet looks like all the others. So the app now answers it from your own position: tap **I'm on board** and it watches where you are, compares that against every live vehicle, and names the one carrying you. From there it does what you would have done by hand — selects that vehicle, opens its route and its stop list, and locks the camera to it — so the map shows the run you are actually on, next stop first, without you having identified anything.
  A single fix cannot answer the question and the app does not pretend otherwise. At a stop you are as close to the tram you are waiting for as to the one you just left, and a bus passing a pavement comes within a few metres of everyone standing on it. What separates a ride from a near miss is that a ride *keeps* being near, so the evidence is gathered per vehicle over a rolling window: how long it has stayed within reach, how close it has been on average, and — the part that does the real work — how much ground the two of you have covered *together*. A vehicle is claimed outright only after four fixes, twenty-five seconds and a hundred and fifty metres of shared travel with no fix in between where it was not alongside; on weaker evidence it is offered as a question ("On the tram 9?") rather than asserted, because being told you are on the 7 while you are standing beside it is worse than being asked. Say no and that run is not offered again.
  How far away still counts is not a fixed radius: it is the length of the vehicle's body, plus whatever uncertainty the phone reports for its own fix, plus the ground the vehicle has covered since its last report — a generous allowance for a 27 m tram and a poor GPS in a metal box, which is exactly the case this has to work in. Two things it deliberately refuses to answer: a fix too vague to place anyone on one side of a street is dropped rather than scored, and two vehicles running different journeys that fit the evidence equally well are reported as ambiguous rather than resolved by a coin toss. The coupled halves of one train are not ambiguous — either answer names the same ride — so those are settled by which unit is nearer.
  While it is still looking, every mode streams, because the bus you are sitting on cannot be found if the bus feed is off; once a ride is locked, only that ride's own mode is kept on, and the vehicle stays on the map whatever the line filters say. Stepping off ends it: three fixes in a row without the vehicle alongside, or a minute of silence from it, and the camera is released and the search resumes rather than chasing a tram you have left. Nothing starts on its own — geolocation costs a permission prompt and a radio, so the watch begins on a tap, and is resumed unprompted on a later visit only for a reader who has both asked for it before and already granted the permission.
- **A planned journey now tells you when to get off.** Asking "where to?" already worked out the stop you leave the vehicle at — it is the end of the transit leg you are riding — but it left you to count stops out of the window, which is the whole thing you were trying not to do on a line you do not know. The journey now says it out loud: while a leg of the selected plan is being ridden, a strip at the bottom of the map counts your stop down, turns gold two stops out, goes coral and buzzes the phone when the vehicle's next stop is yours, and says **Get off here** when the doors open at it. Allow notifications once and the same two moments arrive on the lock screen, so the phone can be in a pocket.
  The countdown is taken from the vehicle running your leg, not from the clock: the leg carries its own stop list, so the vehicle's reported next stop is looked up in it and what is left is the number of stops still to run. Where no vehicle can be unambiguously matched to the leg — two trams on the same trip identity, a leg with no trip ID, a mode whose feed is off — it falls back to the arrival prediction and *says* that it has, because "the tram says your stop is next" and "the timetable thinks you arrive in ninety seconds" are not the same claim, and a rider deciding whether to stand up should know which of the two they have been given.
  Which leg you are on is settled by the ride detection above where it has an answer, and by the clock otherwise. A stop the vehicle has already left is reported as passed rather than counted down to — an alert that fires after the fact is noise on top of a missed stop — and "get ready" is shown on screen but never pushed to the lock screen, because three interruptions per leg teaches a rider to ignore all three. The buzz and the banner never depend on the notification permission; a browser that has frozen the tab cannot fire anything at all, which is the honest limit of a web page in a pocket.

---

## [v0.67.4] - 2026-09-07

### Fixed
- **The timelapse stops lurching every couple of minutes.** Playback fetched history two minutes at a time, whatever speed it was running at — and two minutes of unthinned tram history is nine thousand readings and just under three megabytes. Parsing that and building nine thousand objects is a tenth of a second of blocked main thread on a desktop and several times that on a phone, and while it is blocked nothing is drawn: the map froze, the clock stalled, and both resumed a beat later. Once every two minutes of playback, which is exactly the rhythm of the lurch.
  A block is now sized by the work it makes rather than by the clock it covers: half a minute of history read second by second, eight minutes of it read every thirtieth second, and roughly two thousand readings either way. Every span is a doubling of the smallest and aligned to its own size, so replaying a stretch still asks for the same URLs and the browser cache still answers them. The parse that used to cost three megabytes now costs three quarters of one, four times as often — small enough to land inside a frame or two instead of stopping the map.
  A block that size is also a much shorter wait when the scrubber is dragged somewhere new: the first window a seek needs comes back in a second and a half rather than three and a half. And the parallel fetching added in v0.67.3 now only runs in parallel when the cursor is actually close to running out of history — at real time, where one block lasts half a minute, they land one at a time, because three blocks parsed back to back would be three times the hitch this change exists to remove.

---

## [v0.67.3] - 2026-09-07

### Fixed
- **The fast timelapse is smooth, and the trams stay on the map.** Played at thirty times and above, history juddered: vehicles crawled a step behind the map and then snapped forward to catch up, and trams blinked out of existence in ones and twos before reappearing. Three separate causes, all of them the same mistake — code that was right about the live feed being asked about a replay running two hundred and forty times faster than it.
  The map's glide between two snapshots is measured from the gap between them, floored at seven tenths of a second because a live feed that speaks once a second and reports twice in a tenth is hiccuping, not talking fast. A replay at sixty times genuinely does deliver a snapshot every eighth of a second, and the floor meant every glide was cut off at a fifth of its length by the next one: the vehicles were drawn covering a fifth of the ground they had actually travelled, falling further behind on each snapshot until the guard against teleports fired and put them where they belonged in one jump. That guard was the second cause: it measures a step against a second of travel, and eight seconds of perfectly ordinary tram between two snapshots at sixty times looks, by that measure, like a vehicle crossing the city — so it fired on nearly every step and turned the replay into a slideshow. Both are now measured against the history a window carries rather than the wall clock it took, and past a couple of seconds per window the easing curve steps aside too: the two ends of the glide are both measured positions several hundred metres apart, and the honest way between them is a straight line at a constant rate rather than an ease-in and ease-out eight times a second.
  The disappearances were the player outrunning its own fetching. Windows were fetched one at a time, and at two hundred and forty times the cursor crosses a two-minute block in half a second — so the player spent most of its time waiting out a round trip, playing into history it did not hold. What it drew there was the last thing it knew: a crowd of vehicles going stale one by one and winking out as they passed the minute the live map drops a silent vehicle at. Fetching now runs a few windows in parallel and asks for the next one the moment one lands, and the cursor waits where it is when it does reach the end of what has been fetched, which is what a video player does and reads as what it is. A speed change no longer empties the buffer either: a reading is a reading, so speeding up mid-playback keeps everything already held and carries straight on instead of blanking the map.
  Underneath, the playback clock is now driven by animation frames rather than by a timer — an eighth-of-a-second `setInterval` is coalesced and drifts, and the map draws unevenly spaced snapshots as unevenly moving trams — and the buffer merges arriving readings into what it holds instead of re-sorting and replaying the whole thing from the start on every fetch, which at speed was several thousand readings landing twice a second into a buffer of tens of thousands.

---

## [v0.67.2] - 2026-09-07

### Changed
- **The timelapse gets the screen to itself.** Opening it left every live control in place: the line filter sidebar, the vehicle-mode chips, the map-view chips, the journey planner, the departures board and, on a phone, the bottom tab bar. All of them answer for *right now* — a departure board beside an hour-old tram is quietly answering a question nobody asked of the past — and the app already knew as much, clearing any open selection when a replay starts. The controls themselves now step aside for the same reason: while history plays, the scrubber is the only chrome on the map, and the version badge that opened it goes too, since the panel carries its own exit. Everything comes back exactly as it was when the replay ends.
- **The timelapse panel itself gives the map back most of its space.** What is left on screen while history plays is now two rows instead of four, and about half the area: the play button, the speeds and the way back to live share one row; the moment being replayed sits beside the scrubber that sets it, rather than in a header of its own. The panel's own title is gone — a clock, a scrubber and a Live button do not need to be told what they are — as is the second exit, since the X and the Live button both did the same thing. The standing status line ("Last 7 days · Helsinki time", which the scrubber already says to a screen reader) now appears only when there is something to report: a gap, a load, or an error. And the panel sits on the corner of the screen instead of above the version badge and the tab bar, which are not there to make room for.

---

## [v0.67.1] - 2026-09-07

### Fixed
- **A traffic light is drawn where the junction is, not where the cabinet is.** The markers have always sat slightly wrong — beside the crossing, inside the corner building, a carriageway away from the tram waiting at the light — and the reason is what the open data actually holds. `avoindata:Liikennevalot_piste` gives one point per signalized junction, but that point is a surveyed *installation*: the controller cabinet, a mast on a kerb. It is typically 5-30 m from the middle of the crossing, which is nothing on a citywide view and the whole width of the junction at the zooms the marker is drawn at.
  The middle is recoverable from the city's own street geometry, and now is. `avoindata:Liikennevaylat` carries the carriageway centrelines noded at every junction, so a junction is a point three or more of them meet at — several such points where a dual carriageway or a staggered crossing splits, and the centroid of the ones belonging to one crossing is the middle of the whole thing. The marked pedestrian crossings (`Suojatie`) ring that same box, so their centroid is a second, independent reading of it, and the only reading there is for a mid-block signal, which has no meeting of streets at all. Where both readings exist the centre is their mean: scored against a sample of junctions, each reading flatters itself and the open-data point is worst under either scoring, so the mean is the answer that stays close whichever way it is measured. 466 of 565 signals move, by a median of 7.4 m.
  A correction is only kept when the geometry agrees with the point it is correcting — under 45 m of movement, and never on a single piece of evidence — because being 20 m off is a blemish and being snapped to the next junction down the street is a lie. The 99 signals with no clear answer keep their open-data coordinates exactly as before, and say so: a feature carries `centered: true` only when the point served is a computed centre. A junction listed twice under one number, which is two masts of the same crossing, is now served once instead of as two markers stacked on the same spot.
  None of this is work the app does at runtime: 111,000 street centrelines are not something to intersect on a request, or on a timer, for a dataset that changes when a street is rebuilt. `scripts/generate-junction-centers.mjs` computes the table offline against Helsinki's WFS, and the backend embeds it and applies it as it serves `/api/v1/traffic-lights`.

---

## [v0.67.0] - 2026-09-07

### Changed
- **The traffic light is one object again: the marker, at every zoom.** The 3D signal built in v0.65.0 — the mast, the cantilever arm, the two heads, the ring on the ground — is gone, and the junction marker no longer fades out to make room for it. A signal is a thin object a metre wide, and modelled at real scale it was a smear of a few pixels at exactly the camera angle 3D view puts you at, while the flat head it replaced said the same thing legibly: which lens is lit, and how many vehicles are asking. So the marker stays up from zoom 15 all the way in, tilted or flat, and it is the only drawing of a junction the map has. The junction still selects, still takes the gold on its ring, still opens the panel listing who is asking it for a green — all of that was the marker's already.
  `scripts/verify-traffic-lights.mjs` drops its mast measurements for what is left to check: that every state's art decodes and paints, that a granted request paints green the idle marker paints none of, that the marker is drawn and lit at street level, at close range and under a 60° pitch, and that a warning light stays one amber lamp with no signal lenses.

---

## [v0.66.1] - 2026-09-07

### Fixed
- **The timelapse can be opened with a finger.** The archive hides behind a double-click on the version badge, and on a phone that double-click never arrived: touch browsers synthesize a `click` for each tap but do not reliably emit `dblclick`, so the badge saw two unrelated single taps and did what a single tap asks for — it opened the changelog. The pair is now counted from the clicks themselves, which is the one path a mouse and a finger both travel, so the gesture behaves the same on a phone as on a desktop and the `dblclick` event is no longer needed for anything.
  Two smaller things stood in the way of a finger even when the counting was right. The badge is nine-point type in the map's corner, too small a target to land on twice in a row, so on narrow screens it is padded out to something a thumb can hit; and a double tap on it was also the browser's own zoom gesture, which `touch-action: manipulation` now hands back to the badge. The link itself is unchanged: one tap still opens the changelog once the grace period shows no second tap is coming, falling back to this tab where a popup opened from a timer is refused.

---

## [v0.66.0] - 2026-09-07

### Added
- **The ferry, and how full it is.** The map has had four modes and HSL runs five: the Suomenlinna crossing is the one that was missing, and it is the one worth having, because it is the only mode whose HFP `occu` field means anything. Every tram, bus, metro and commuter train sends a constant `0` there — the schema has the field, nothing on board counts anybody — while the boats report a genuine load percentage. So the ferry is not just a fifth carriage in a fifth colour: it is the one vehicle on the map that can show you whether you will fit on it.
  It is also the one vehicle that is not a carriage, and it is not drawn as one. The marker is a vessel seen from above — a raked bow, a beam half as wide as the hull is long, a deckhouse set inboard of open decks fore and aft, a wheelhouse forward and a funnel behind it — because that silhouette is what makes the fifth mode identifiable before any colour is read, next to four rectangles with noses. The 3D body follows the same drawing at real scale: a 35 m hull on an 8.5 m beam, a saloon, a bridge, a funnel, a short wake astern while it is making way, and no wheels, no bogies, no pantograph and no articulation, because a boat has none of those.
  The load goes into both. The marker's deckhouse is a saloon that fills from the stern forward and is ringed in the same colour, so the state survives being shrunk to twenty pixels; the 3D body carries the gauge along its saloon roof, which is the one surface a pitched camera looks straight down on, so it reads from every bearing like a battery meter. The colours run the opposite way to the city-bike gauge and for the same reason — there a full rack is the good news, here an empty deck is: green through amber to red, in the palette the bike gauges already use. The telemetry panel states it in words and a meter (`Filling up · 62%`), and the panel schematic draws the saloon as a glass tank with the water and a bow wave under it.
  A vessel nobody has counted gets an empty **grey** gauge, never a green one. "No report" is not "nobody aboard", and a mode that does not measure occupancy at all is treated as having none rather than as being empty — which is why a tram's `occu: 0` still draws no gauge anywhere.
  Everything else the other four modes have, the ferry now has: its own toggle in the corner (a fifth chip, in HSL's ferry cyan `#00b9e4`), the quays as stop discs and as sign boards carrying a vessel over its own wake, the quay as 3D furniture at the pier's own scale, the dashed cyan route line across the water following the toggle instead of being hidden outright, the line filter, the journey planner and the stop departures switching the feed on when a leg or a departure needs it, and its own dead-reckoning ceiling — 10 m/s, set from what a Suomenlinna boat actually does rather than from the feed, on the same two-second horizon the street modes use.
- **`ferry` as an opt-in stream mode.** The backend subscribes to `/hfp/v2/journey/ongoing/vp/ferry/#` on the same on-demand basis as buses, metro and commuter trains: only while a connected client asks for it. `{"modes": {"ferry": true}}` on the WebSocket is now accepted alongside the other three.
  The history archive already packs `occu` into its 28-byte record (255 meaning "not reported"), so a deployment that names `ferry` in `REPLAY_MODES` gets the load gauge in the timelapse too, filling and emptying through the week exactly as it did live. The default stays trams alone, for the reason it always was: a mode that is only ingested while somebody is watching would leave holes in its own history.

---

## [v0.65.0] - 2026-09-07

### Added
- **Trams ask the traffic lights for a green, and now you can watch them do it.** A tram does not simply wait at a signalised junction: its onboard computer requests priority as it comes up on the crossing, and the junction answers. Both halves of that exchange are on the same HFP feed the positions come from, as their own event types — `tlr` for the request, `tla` for the answer — and the app had been ignoring them.
  It reads them now. The newest exchange per vehicle is held in the ingestion worker and folded into that vehicle's next position update, so it reaches clients on the stream they already read rather than as a second one to join; it is dropped again after 25 seconds, because a request is a momentary thing and a tram three junctions further on is not still asking this one. An answer carries neither the junction nor what was asked for, only a request ID, so it inherits both from the request it matches — and where no request was seen, it stands on its own with the junction read off the topic. `tlr` also fires when a vehicle reaches a junction it is equipped to ask and *decides not to*, which is a different thing from asking and is reported as its own state with the reason attached.
  Junctions are joined by identity, not by geography: HFP's `sid` is Helsinki's own junction number, which is exactly the `id` the traffic-lights endpoint already served. Measured against a capture of the live feed, 145 of 147 tram requests named a junction that is in the open-data set. So a stopped tram's popup no longer says it is *probably near* some traffic lights — where the tram named them, it says it is waiting at *those* ones, and the Diagnostics tab carries the whole exchange: request type (on approach, on closing doors, on opening doors, in advance), priority level, attempt number, signal group, and the radio protocol it went out on.
  Only trams and buses run the equipment. Tram priority streams always; a bus's arrives with the bus feed and leaves with it.
- **A traffic light that shows what it was asked.** The junction marker was a piece of clip-art, which was enough while a traffic light on this map was only a location. It is a state display now, and it is drawn as one: a signal head with a hood over each lens on a mast, with every lens at its unlit colour by default — so the marker reads as a traffic light rather than as a green light that happens to be showing — and the lens matching the live request lit, ringed in the same colour, drawn a size up and sorted above the junctions that are not being asked for anything. There is an image per state and the layer picks between them by expression, so a request changing lights the marker without rebuilding it.
- **3D traffic signals.** The counterpart to the stop shelters and the bike racks: from zoom 16.4, in 3D view, a junction becomes a mast at real metre scale — a three-lens head at driver's eye level, a second head under the cantilever arm reaching out over the carriageway, hoods over the lenses, standing 3.2 m off the junction point rather than in the middle of the crossing, and turned to the street the route lines say runs past. Whatever lens the live request lit is lit here too, and a band on the ground rings the junction in the same colour: a head is a few pixels from a rooftop camera angle, and the ring is the part still legible from there. A ring rather than a disc, because a filled circle of signal colour buries the junction it is meant to mark. The flat marker fades out across the band the mast fades in over, so a junction is drawn as a symbol or as a signal and never as both. Pedestrian and cyclist warning lights — the other half of the dataset, and nothing a tram can ask anything of — keep their own shorter pole and single amber lamp, and get no state variants.
- **A junction is now something you can select.** The vehicle panel answers "what is this tram asking?"; clicking the lights answers the question you have when you are looking at the crossing instead of at one tram — which vehicles are asking *this* junction for a green right now, and which of them it has answered. The panel lists them grouped by outcome — granted, requesting, refused, and the ones that reached the junction and deliberately did not ask — each with its line in its own colour, how far off it still is, whether it is rolling or standing, what it asked for and which attempt this is, and how long ago. Picking a line out of the list opens that vehicle's own panel, so the two halves of the exchange are one click apart in both directions.
  The index behind the markers had been keeping only the leading exchange per junction, because a marker can show one state; it keeps them all now, because a corner two tram lines share routinely has more than one vehicle negotiating with it at the same moment, and "one of them" is the wrong answer to "who is asking?". The marker still shows the leading state — an answer outranks a request — and the junction being read takes the same selection gold a stop or a vehicle does, on its ring and on its 3D mast, never on its lenses: recolouring those to mean "you clicked me" would overwrite the one thing the signal exists to say.
  Both markers open it, the flat one and the 3D mast, and the panel is careful with its words throughout: "granted" is the junction acknowledging a request, not a green light showing. HFP publishes the negotiation and never the aspect.
- **`scripts/verify-traffic-lights.mjs`**, which renders the marker and the mast in Chromium and measures the pixels: that every state's art decodes and paints, that a granted request paints green the idle marker paints none of, that the mast stands *above* its own projected footprint rather than lying flat on it, that the arm is drawn at its modelled length, and that the ground ring appears only while something is being asked. The same shape as the bike-station and stop-marker checks, and for the same reason — none of this is type-checked, it is validated by MapLibre in a browser.

---

## [v0.64.0] - 2026-09-06

### Added
- **The map can be wound back a week**: double-click the version badge in the bottom-left corner and it stops being about now. A scrubber covers the last seven days of tram movement — recorded stretches shaded, so the gaps a deploy or a broker reconnect left are visible rather than discovered — with play, pause, and speeds from 1× to 240×, at which a whole day runs past in six minutes. The panel is deliberately not part of the map's ordinary furniture: watching the city's past is a different errand from watching it now, and a map that offers to replay the week in its own chrome asks a question most people opening it did not have.
  A replayed tram is not a different kind of thing from a live one. It carries the same telemetry, rides the same rails, opens the same doors and reports the same delay, because the archive stores exactly what the live map was shown — the reading after ingestion has deduplicated HSL's fourfold tram copies, paired down the metro's coupled units, read the next stop off the topic and normalised the delay's sign. Everything downstream of the source switch — filtering, selection, the three-tab vehicle panel, the rail snapping, the dead reckoning — works on history without knowing it is history.
  Everything on the map that is *not* a vehicle is fetched for right now, so entering a replay clears the stop, journey, bike and arrival selections rather than showing tonight's departures beside this morning's trams.

- **A week of trams in 1.1 GB**: the archive is not a database, because nothing is ever asked of it that wants one — playback is a sequential read and a timelapse is a full scan. A reading is therefore a fixed-width 28-byte record in a per-minute chunk file, with each journey's line, direction, trip and operating day interned once per day rather than repeated on all ~1,700 readings that journey produces. Stored as the JSON the WebSocket sends, a week would be 20.8 GB; one reading per Redis hash entry, 5.5 GB, most of it key bookkeeping. Packed, it is 1.08 GB — small enough that the page cache simply holds it, with durability across restarts for free and no eviction policy to get wrong.
  That layout is also what makes a *place* answerable rather than only a moment. `GET /api/v1/replay/timelapse` takes a bounding box and a span up to the whole retention window, and rejects a reading by reading eight bytes of it and decoding nothing else. Measured, a junction-sized box costs 117 µs per minute of archive, so a whole week is about 1.2 seconds.

- **Fast playback fetches less, not more**: a replay at sixty times real time does not need sixty readings a second of every tram — it needs the same number of *drawn* steps as a replay at one times, each covering sixty times the ground. The window endpoint takes a `step` that thins the result to one reading per vehicle per that many seconds, and the player picks it to hold the drawing rate near eight snapshots a second whatever speed is selected. At 1× through 8× nothing is thinned at all and the map animates a replay exactly as it animates the live feed.

### Changed
- **The map's animation now knows how fast time is running**: everything it does with distance — carrying a vehicle forward on its own reported speed and acceleration, snapping a tram to the rail its journey is using, deciding a step is too large to be real — is measured in seconds of *history*, while the glide between two snapshots is measured on the wall clock. Those were the same number for as long as the only source was a live feed once a second. At sixty times they are not: a snapshot arrives every eighth of a second carrying eight seconds of travel, and a map told only the wall figure concludes that every vehicle on it has teleported and snaps them all into place. The two are now tracked separately, with the ratio between them supplied by whatever is playing. At 1× the ratio is one and nothing about live behaviour changes.

### Fixed
- **`docs/REPLAY_FEASIBILITY.md` corrected against the built thing**: the analysis put a week-wide bounding-box scan at 0.13 s, which counted the coordinate comparisons and not the ten thousand files they live in. Measured, it is ~1.2 s. It also expected playback speed to be capped by bandwidth, which server-side thinning removed entirely.

---

## [v0.63.0] - 2026-09-06

### Added
- **An aerial basemap**: a third map beside light and dark, and the one a transit map is oddly often missing — the ground itself. It is the National Land Survey's orthophoto mosaic (`ortokuva`), not Google's imagery: Google's satellite tiles may only be drawn by Google's own APIs, and for Helsinki the national photos are the better picture anyway, flown for mapping rather than assembled into a global mosaic. They are open data under CC BY, so the map carries the credit while they are showing.
  The photo is a raster layer slid *under* the dark style's labels rather than a style of its own. Everything the vector style draws below its first label — land, water, roads, buildings — ends up beneath an opaque photo and is simply never seen, while street and place names keep drawing on top, which is the one thing a bare aerial view badly lacks; anything the style happens to order after its labels is switched off so it cannot draw over the imagery. The stops, platforms, route ribbons and vehicles are unchanged and sit above both, in their dark-theme colours, because dark is what the labels under them are.
  The open interface serves the orthophotos to zoom 16 — about 1.2 m per pixel at Helsinki's latitude — and the map goes to 18, so the last two zooms are the level-16 tiles overzoomed: softer up close, but imagery that keeps going where the stops get interesting rather than cutting out there.
  The mode needs a (free) National Land Survey key in `MML_API_KEY`, served to the browser by `GET /api/v1/config` beside the Digitransit map key. A deployment without one does not show the chip at all, rather than offering a map that would come back as a grid of 401s.

---

## [v0.62.3] - 2026-09-06

### Fixed
- **Trams now run on the right rails**: the map draws both tracks of a tram street, because each direction is its own pattern polyline — and the tram was drawn where its GPS said it was, which is between them, on the wrong one, or on the pavement. That is not a bug in the positions: Helsinki's tram tracks run as a pair some 5–8 m apart, and street-level GPS error is several times that, so the coordinate simply cannot say which of the two rails a tram is on. The feed can. HFP reports the journey's direction as `dir`, Digitransit reports which direction each pattern polyline belongs to, and the vehicle is now snapped within its own direction's polylines alone. Where the feed omits the direction, the tram's heading picks the rail that runs the way it is going instead.
  A junction needed one thing more. A line's own polyline can pass through the same few metres of street twice — a loop, a turn-back, two arms of a crossing — and position and heading both say the same thing about all of them. So the placement is now measured for continuity as well: a tram is expected to be found within its own speed's travel of where it was last placed, and a fix somewhere else on the route is charged 60 m before it can win. Only the arm that continues the run the tram is already making passes that test.
  Being on the rails also means being carried along them: a snapped tram now slides *along* its track between two position reports, through curves a straight interpolation used to cut across. A tram that is genuinely off its route — a diversion, a depot run, a replacement working — is still drawn where it says it is; past 35 m from any of its own rails nothing is snapped at all.

### Changed
- **A tram bends at its joints**: a 27 m Artic tram was one rigid box, and a rigid 27 m box cannot take a street corner — it either drives its nose through the building on the outside of the curve or swings its tail through the one inside it. The body is three sections on articulation joints, and it is now drawn as three: each rigid section is placed at its own point on the rails at the bearing the rails have *there*, with the gangway stretched between the two frames it joins rather than laid out in one section's space. The running gear, doors, pillars and lamps ride with the section they belong to, which is both the truthful drawing and the cheap one — one path lookup per section per frame, not one per polygon. A vehicle with no track under it (a bus, or a tram off its route) is still drawn rigid, exactly as before. `scripts/verify-vehicle-3d.mjs` measures the difference in rendered pixels: through a right-angle corner the bent body spans 23.6 m against the rigid body's 28.8 m, occupies both legs of the corner, and stays in one piece.
- **`lib/metroTracks` is now `lib/railTracks`**, because the geometry it holds is no longer the metro's alone. The metro's own snapping is unchanged — it keeps its 400 m reach, its pattern hysteresis and its refusal to read direction from movement — and the tram is given its own, much tighter, licence beside it: 35 m of reach, a 4 m switching margin narrower than the gap between the two rails, and the direction and continuity tests above.

### Added
- **`patterns` on `GET /api/v1/route/{shortName}`**: the same deduplicated polylines as `geometries`, each carrying the GTFS `direction_id` of the pattern it came from. `geometries` is unchanged, so the route ribbons — which do not care which way a polyline runs — read exactly what they always did.

---

## [v0.62.2] - 2026-09-06

### Fixed
- **The metro "M" signs follow the Metro toggle**: switch metro off in the city centre and the map still stood thick with orange M pins. The entrance pins, their letter and wheelchair badges, and the named metro station icons come from the HSL vector style rather than from anything the app draws, so nothing had ever tied them to the mode toggles — the metro trains, stations and lines went away and their signage stayed. They are now switched with the mode, alongside the metro stops and route lines, and restored the same way after a theme or style reload.

---

## [v0.61.1] - 2026-09-06

### Fixed
- **Stops stay visible when you zoom out**: zoom back from street level and the stops vanished while the city-bike gauges stayed put, which made it look as though the map only knew about bikes. The stops were there the whole time — as dots of about one pixel. They inherit the HSL vector style's own radius ramp, which grows a stop from 1 px at zoom 12 to 24 px at zoom 22, but the discs are only ever drawn between zoom 13 and 15.5, where the sign boards take over. Almost the entire ramp sits above the band it is used in, so every disc came out at the very bottom of it. The ramp is now scoped to that band (3.2 px at zoom 13 rising to 5 px, stations a size up), the discs carry their own thin white ring for contrast now that the style's casing layers are switched off, and the threshold at which they appear is pinned to the same constant as the city-bike gauges so the two kinds of marker keep arriving together.

---

## [v0.61.0] - 2026-09-06

### Changed
- **City-bike stations look like city-bike stations**: a station was a circle with a number in it. Correct, and it said "data point" — the one thing on a map full of trams, buses and shelters that never said what it was. It is now a bicycle: the availability gauge is kept, because how full a station is is the reason to look at it at all, but the ring is drawn around a bicycle rather than around a numeral, and the count moves underneath where it stays readable as the marker shrinks. The scarcity colours are unchanged — grey when the last bike has gone, red when one more rider empties it, amber in the middle, green when there is no question.

### Added
- **City-bike racks in 3D**: zoom past 16.2 in 3D view and the marker hands over to the station itself — an apron, a dock post for every dock, a yellow bike standing in every dock that has one, and the payment terminal at the end, built from the same `fill-extrusion` boxes in ground metres as the 3D vehicles and the stop shelters, so a station beside a tram stop belongs to the same scene. Because a dock is drawn per dock and a bike per bike, the number the gauge summarises is, up close, simply the thing you see: a full rack looks full and an empty one looks empty. The rack takes its orientation from the route line running past it, turns gold when the station is selected, and clicking it opens the same panel its marker does.
- **A sixth map verification script** (`scripts/verify-bike-stations.mjs`): the marker is an SVG rasterised through an `Image`, which draws nothing at all when it is malformed, and the rack is geometry in metres, which is still a row of boxes at the wrong size or heading. Eighteen checks measure the rendered pixels — every bucket's art decodes and paints, a fuller station paints a longer arc, the apron matches its modelled length, the rack turns with its bearing and stands above its footprint, nothing is extruded below the fade-in zoom, a fuller rack shows more bikes and an empty one none, and the selection gold reaches the screen.

---

## [v0.60.0] - 2026-09-06

### Fixed
- **The next stop is now the next stop**: it had been showing the stop already behind the tram, or nothing at all, and the reason was that we were reading the wrong field. HFP's `VP` payload carries a `stop`, and it is the stop the vehicle is standing *at* — null for the entire run between two stops. On a five-minute capture of the live tram feed (44,432 messages, 47,424 `vp` readings) it was null 52.8% of the time. So for more than half of every journey there was nothing to read, and the display fell back to guessing: take the last stop we saw and add one. That guess is wrong the moment a stop is missed or the vehicle is picked up mid-trip, and before its first stop of the trip had been seen there was no guess to make at all — hence "nothing".
  The stop a vehicle is heading for was there the whole time, one level up: `next_stop`, level 13 of the MQTT topic itself. Unlike the payload field it is stated on **every** message — 44,432 out of 44,432 in that capture — and where the payload did name a stop the two agreed exactly, 22,376 times out of 22,376, because a vehicle that has not yet pulled away is both at a stop and heading for it. It is now parsed off the topic and published as `nextStop` on every vehicle, with `eol` for a vehicle that has run out of line. Replaying 102,172 captured live messages through the ingestion path, all 83 vehicles left in the cache carried a next stop; only 34 of them carried a payload `stop`.
- **Late was showing as early, and early as late**: HFP's `dl` counts seconds *ahead* of schedule, the opposite of GTFS-RT and the opposite of the `delay` the timetable API returns for the very same journeys — and the app read it as the latter. Checked against the scheduled times HFP publishes on its own stop events (`ttarr` against the event's `tst`), 108 of the 109 samples more than 90 seconds off schedule in that capture confirmed it. `dl` is negated on ingestion, so one convention now holds everywhere: positive is late.
- **The timetable fallback read the wrong clock**: when nothing about a vehicle can be matched to its trip, the next stop is guessed from stop times — which are on Helsinki's clock, but were compared against the browser's. Correct in Helsinki, out by the offset everywhere else.

### Changed
- **One next-stop resolver instead of three**: the vehicle card, the vehicle panel and the map each carried their own copy of the guessing logic, and they did not agree with each other — the map named the stop the vehicle was standing at while the card named the one after it. They now share `tripProgress`, which prefers what the vehicle reports and says where its answer came from (`reported`, `at-stop`, `timetable`, `end-of-line`), so a guess is never mistaken for the feed's own word.
- **A stop can now tell you the tram is actually coming**: the next-arrival block distinguishes a vehicle that names this stop as the one it is running to (`Live · on its way here`) from one that is merely visible on the map with stops to make first, and a vehicle standing at the platform with its doors open (`Here now · doors open`) from either. The countdown is still the feed's own prediction and nothing else — locating a vehicle has never been allowed to become a second, competing estimate of the same number, and this does not change that. It changes what can be said about the vehicle behind it.
---

## [v0.59.1] - 2026-09-06

### Changed
- **The departures list looks like the stop panel it opens**: the saved and nearby lists showed their previews as plain text — a bold line number, the headsign, and the times run together in grey — while opening the same stop gave the coloured line badge and the two-column timetable row. Same departures, two visual languages, and the line number lost the one colour that identifies it. Each stop is now a card carrying its name and its code chip, and its previews reuse the stop panel's own departure row: the line's colour behind the badge, the headsign eliding rather than wrapping, and the time and status right-aligned in their own column. Nothing about the data changed; the list simply stops disagreeing with the panel it leads to.

---

## [v0.59.0] - 2026-09-06

### Added
- **Zoom into a stop and the next tram is written on it**: the arrival tracking added in v0.58 answered the question, but only once you had opened the stop's panel and pressed a button — which is a lot of asking for something you wanted at a glance. From zoom 15.5, the same zoom at which a stop stops being a dot and puts up its sign board, every stop near the middle of the view now carries its next departure above the sign: the line number and the minutes, in that line's own colour. Zooming in on a stop is the whole gesture. Nothing to open, nothing to press.
  The countdown is the departures feed's own prediction, exactly as in the panel, so a label needs no vehicle located and turns on no extra live feed to be drawn — a bus stop labels itself without the bus feed being subscribed. A stop with nothing honest to say gets no label at all rather than an empty badge, because an empty badge over a stop reads as “nothing runs here”, which is a different claim from “we don't know yet”. A departure more than thirty seconds gone stops being a label before it stops being a timetable row.

### Changed
- **Stops are asked about in one request, not one each**: a zoomed-in view can hold hundreds of stops and each label is a departure lookup, so `GET /api/v1/stops/arrivals` takes up to twelve stop IDs and answers for all of them in a single upstream round trip. The map asks only when the view settles — never per frame — and only for the stops nearest the middle of the screen, which is where the eye is and the same rule the 3D stop furniture is already capped by. IDs are de-duplicated and sorted so the same set of stops is one cache entry however it was asked for, and they travel to the upstream API as GraphQL variables rather than being pasted into the query document: an ID arrives from a query string, and a request that interpolates caller input into a query is a request that lets the caller write the query.
- **One definition of a departure**: the departure selection and its mapping were about to exist twice, once per endpoint. Both stop queries now share a single GraphQL fragment and a single mapping function, so the batched arrivals cannot drift from what the timetable panel means by a departure.
- **A sixth thing the map checks cannot see**: the label is a `symbol` layer with a `text-field`, and text needs glyphs. Four of the five map checks draw on a blank style with no glyph endpoint, so they can prove the layer's spec is valid and its source is fed, and nothing more — whether the label actually appears above the board is check 2's claim to make. Recorded in CLAUDE.md alongside the dark-theme platform case. The label's text is a pure function and is unit tested in CI.

---

## [v0.58.1] - 2026-09-06

### Fixed
- **One scrollbar, and the times above the fold**: the stop sheet drew two scrollbars side by side — the departures list carried a viewport-height cap and an `overflow` of its own inside the panel's scrolling body, so the phone painted a track for each and split the wheel between them. The list is now plain content in the panel's single scrolling region. What that region shows is mostly departures now, too: on a phone the sheet is 78% of the viewport rather than 62%, the internal `HSL:` stop id (useful for a bug report, not for catching a tram) is gone from the header, the "Lines serving this stop" label is dropped in favour of the coloured chips that already say it, and the freshness note shares its line with the "Upcoming departures" label and shortens to `Live · 12s ago` instead of restating the polling interval. Nothing is removed from the desktop panel, which has the room.

---

## [v0.58.0] - 2026-09-06

### Added
- **The stop answers the question you actually walked up to ask**: standing at a stop, or on the way to one, there is one question — is something coming, and can I see it. The timetable answered it only by making you read a list and do the subtraction. The stop panel now opens on a **Next arrival** block: the line, where it is going, the countdown in figures you can read at arm's length, and how confident that number is. The countdown is always the feed's own prediction; locating the vehicle never becomes a second, competing estimate of the same number, it only unlocks the map trace below.
- **See it coming down the street**: press **Track on map** and the vehicle bringing that departure is followed on the map, with its remaining approach drawn along the route it will actually take — around the corners, not as a bearing through the blocks between. The stop takes the same gold signpost and pulse a selected vehicle's next stop has had since v0.57, and lights amber at the platform edge while the doors are open, because it is the same relationship seen from the other end: this vehicle, that stop. It reuses those layers rather than adding any, and the camera frames the pair once when tracking starts rather than re-framing every second, which is unusable to someone walking. When the tracked departure leaves, tracking moves to whatever is next instead of stranding the map on a vehicle that has gone.
- **Catch the next one**: one press in the Departures panel finds your location, takes the nearest stop by walking distance, opens it, and starts following its next arrival — the whole walk-to-the-stop gesture without picking anything from a list. Location is still only ever requested when you press the button.
- **Whether the walk beats the departure**: nearby stops now carry a verdict — *Easy walk*, *Walk now*, *Run for it*, *Too late* — with the minutes you have spare or are short. It is computed from Digitransit's walking distance along streets and paths, never from a straight line: in Helsinki a straight line is usually across water.
- **Selecting a stop turns on the feeds its own departures need**: buses, metro and commuter trains stream only while a client asks for them, so a bus stop's arrivals had no vehicles to be matched against in the first place. Opening a stop now requests exactly the modes its departures use, for as long as the stop is open, and the tracked vehicle stays drawn even when its mode or line is filtered out — hiding it is precisely what tracking exists to stop.

### Changed
- **A departure names its trip**: `/api/v1/stop/{id}` now returns `routeId`, `serviceDate`, `directionId`, `startTimeSeconds` and `mode` per departure. Together these name one trip unambiguously, which is what allows a departure to be paired with the live vehicle serving it. They are omitted rather than defaulted when the upstream feed does not report them — direction zero and a midnight origin are both real values, so inventing either would match the *wrong* vehicle rather than no vehicle. The matcher itself is now shared with the journey planner rather than duplicated: one implementation, one set of refusals. An ambiguous match is still no match.
- **The approach-path geometry is testable**: slicing a route polyline between a vehicle and a stop was inline logic in the map component, exercised by nothing. It is now `lib/approachPath.ts` with unit tests, and both the selected-vehicle highlight and the new arrival tracking call it.

---

## [v0.57.1] - 2026-09-06

### Fixed
- **The stop sheet fits the phone it is on**: on a narrow screen the stop's timetable opened as a bottom sheet tall enough to reach up into the two corner chip rows, which float above it — so the map-view and vehicle-mode chips sat on top of the sheet's own header, over the stop's name on one side and its close button on the other. The chips now step aside while a sheet is expanded and come back when it closes, and the sheet is shorter (62% of the viewport, down from 72%). Inside it, the stop's name, code, save button and any service alerts stay put while only the departures scroll, instead of the whole panel scrolling the stop's identity off the top; the redundant collapse chevron in the header is gone on mobile (the drag handle, the toggle tab and the bottom bar's Details button all do the same thing), and the save button is a compact chip rather than a full-width block that read as the panel's primary action. Departure rows no longer wrap: a long headsign elides and the departure time keeps its own column on one line.

---

## [v0.57.0] - 2026-09-05

### Added
- **Stops are places on the map, not pins on it**: a stop was a coloured circle that became a disc on a stick — a road sign, in a city where the stop itself is usually a raised island you can see from the tram. The island was already on screen and had been all along: OpenStreetMap has the platform footprints, the basemap carries them in its `transportation` layer, and the light style drew them as `road_service_area` — the same anonymous grey it gives every pedestrian square and service yard. They are now drawn as what they are: a paved surface with a kerb line around it and a dashed ochre edge band at close zoom, fading in from zoom 15 so the city view stays clean. No geometry is invented; it is the OSM footprint, restyled. The dark theme has no platform data of its own (Carto's dark-matter carries no dependable platform subclass), so it attaches the same Digitransit tiles the light theme already loads, gated to zoom 14 and up — one extra request, only when zoomed in, so both themes draw identical ground.
- **A kerbside sign board instead of a road sign**: HSL's stop furniture is a rectangular board on a pole, and drawing it that way is most of what makes a stop read as a stop. The disc is gone; each stop now carries a mode-coloured board with a white pictogram, a pole beneath it and a contact shadow at its foot, drawn at twice the resolution so the board's edges and the glyph stay crisp zoomed in. The stop's name appears under the board from zoom 17. Boards no longer ignore placement, so at a dense terminal the labels step out of each other's way rather than stacking.
- **Stop furniture at real scale in 3D**: in the tilted view the vehicles have been extruded bodies measured in ground metres since v0.56; the stops they call at were still flat symbols. Each stop now gets a pad, a glazed shelter with a roof slab, a pole and a sign board, all in metres — a tram island 24 m long against the 27 m Artic drawing up beside it, a shorter kerbside pad for a bus, a wider apron and canopy for a metro or commuter-rail entrance. Nothing about the stop tiles says which way a stop faces, so the bearing is read off geometry already on the map: the long axis of the platform polygon the stop stands in, or failing that the nearest route line. A stop with neither gets a square pad and a pole and no shelter — furniture placed at a guessed angle would read as data. Where OSM already gives a stop a platform, that polygon is extruded to kerb height instead of a synthetic slab being laid over it. Clicking a shelter opens the same popup its sign does.
- **The stop a selected vehicle is heading for shows it**: pick a vehicle and its next stop takes the gold of the selection ring across its board, pole and pad, and pulses under it on the same clock the vehicles animate to. While the vehicle is standing there with its doors open, the platform edge lights amber — the boarding cue in the place a passenger would be standing.

### Changed
- **A fifth map check**: `scripts/verify-stop-markers.mjs` joins the four existing ones (see `.github/copilot-instructions.md`). A stop now fails invisibly in three separate ways — a kerb drawn from drifted geometry still renders, a shelter at the wrong size or heading is still a box, and the live cues are colour swaps that render either way — so the script draws a synthetic stop with the app's own models and paint and measures the pixels: kerb against polygon, pad length against the model, walls above the footprint, zoom gates honoured, cues visible. It needs no Digitransit key.

---

## [v0.56.2] - 2026-09-05

### Fixed
- **Trams, buses and commuter trains stop being drawn a second behind themselves**: the metro has been dead-reckoned since v0.55.1; every other mode was still drawn by gliding to the newest reported position, which by construction puts it a whole report in the past — the glide only *begins* once the report that ends it has arrived. So every second, on every vehicle on the map, a second of travel arrived as a correction and had to be tugged in. Measured against the coordinate each vehicle actually reported next, over a five-minute capture of the live feed, that tug is 9.6 m for a tram, 13.1 m for a bus and 32.6 m for a commuter train at the ninetieth percentile. Each report carries the speed and acceleration measured on board, and integrating those over the second or two that matter here lands within 0.6 m, 1.1 m and 2.2 m of the next reported position — so aiming the glide where the vehicle *will be* rather than where it was does not trade accuracy for smoothness, it removes the disagreement that caused the tug. Replaying the capture through the animation, the drawn vehicle goes from 13.2 m to 5.1 m behind the feed for a tram at the ninetieth percentile, 22.5 to 9.0 for a bus and 48.5 to 19.7 for a train, and the share of moving time in which a vehicle is drawn crawling at under a fifth of its real speed falls from 11.6% to 2.7%, 11.2% to 2.8% and 19.3% to 9.6%.
- **A vehicle that goes quiet coasts to a stop instead of being driven on down the road**: the metro is carried for eight seconds through the silences in its feed, because a metro holds its coordinate while it is still moving. A tram, bus or train that goes quiet has usually done the opposite — stopped at a light, at a stop, or dropped out while parked — so its last reported speed describes something that is no longer happening. Scored on where each vehicle actually turned up next, predicting beats freezing tenfold under two seconds of silence and loses badly past it: a bus silent for six seconds is 11 m from where freezing would draw it and 56 m from where its last speed says it should be. Surface modes therefore stop predicting at two seconds, which in normal service never binds at all.
- **Each mode is capped at its own top speed rather than the metro's**: the prediction clamped every vehicle to the metro's 22 m/s line speed, which is slower than a commuter train actually runs. Caps are now per mode, set just above each one's fastest honest reading in the feed. A coordinate flung right across the city — the capture contains single steps implying 427 km/h for a tram and 2867 for a train — is drawn as the jump it is rather than glided, which would render it as a vehicle sprinting down a street it was never on.
- **The glide follows the feed's actual pace instead of assuming exactly one second**: a snapshot that arrived late left every vehicle standing still until it turned up, because the window it was gliding through had already run out. The window is now measured from the snapshots themselves.
- **Switching buses on no longer drops the whole map to ten frames a second**: the per-frame rebuild walked every vehicle in the feed and handed the lot to MapLibre, and the throttle that kept that affordable was scaled by the size of the feed — so a close-in view of three trams was throttled to a third of its frame rate by several hundred buses nowhere near the screen. Only vehicles in view (plus the selected one) are put in the collection now, and the throttle is scaled by that count. Positions are still interpolated for every vehicle, so one panned back into view resumes its glide rather than restarting it.
- **Three quarters of tram ingestion work removed**: HSL publishes each tram's position message four times over — 97,099 tram messages in a five-minute capture carried 24,276 distinct readings, the same vehicle and timestamp and coordinate delivered four times within about a hundred milliseconds. Every copy was being parsed, thinned, re-marshalled and written to the position cache. Exact repeats are now dropped on arrival; a genuinely re-reported position still gets through, since its timestamp is what keeps the vehicle alive in the cache.

---

## [v0.56.1] - 2026-09-04

### Fixed
- **Metro trains stop turning round and sliding backwards**: v0.55.1 started carrying a train along its track through the seconds its coordinate is held, and in doing so broke the thing that decides which way it is facing. That was worked out by comparing each new report with where the train was last drawn — which is now deliberately a prediction, running ahead of the feed. Every report therefore measured as travel *backwards*, so the train spun round and the next prediction carried it back down its own tunnel until the following report spun it round again. Replaying a captured feed through the animation, the shipped version turns trains round 152 times and draws 5% of frames moving backwards; both go to zero. Direction is now read from the last *reported* position, not from the prediction, and a new report is aimed a window ahead like a held one, so the train never has to step back to meet it.
- **A single bad coordinate no longer reverses a train**: direction was re-derived on every report, so any step that measured backwards flipped the train. Off the live feed, 64 of some 1700 movement steps measure as reversals and every one of them falls in an exact pair — the signature of one coordinate flung off the line and then returned, not of a train turning. A metro train cannot turn round mid-pattern anyway: the two directions of a line are separate polylines, so a real reversal arrives as a change of pattern and is still read from the heading there, which agrees with the direction of travel 98% of the time.

---

## [v0.56.0] - 2026-09-03

### Added
- **A switch that takes the route lines off the map**: the map's densest ink is the route network — the tiled JORE lines under everything and, once a line or a vehicle is picked, the fanned per-line ribbons on top. Useful for seeing where a line runs, in the way when what you want is the vehicles and the streets beneath them. The view chips in the corner now carry a third switch that hides both at once, leaving the vehicles, stops and any planned journey on a clean basemap. It is on by default, remembers the choice across visits, and is independent of the per-mode toggles: switching route lines back on restores exactly the network those toggles and the current selection call for.

---

## [v0.55.2] - 2026-09-03

### Fixed
- **The 3D doors actually open instead of just changing colour**: a doorway that recolours in place is not a door opening — shut and open drew the same panel in two colours, which said less than the popup schematic's parted leaves it was meant to echo. Each doorway is now a pair of leaves that meet in the middle when shut and slide their own width clear when the real doors open, uncovering an amber doorway in the gap between them; the leaves keep their own colour, so it is the movement that reads. The window band, the doorway and the leaves each stand a little further proud of the flank, so none of the three z-fights with the others, and the doorway is only drawn while it can be seen.

---

## [v0.55.1] - 2026-09-03

### Fixed
- **A metro train no longer sits still between stations and then lurches fifty metres**: the prediction that carries a train through the gaps in its feed was asking the wrong question about what a gap is. HFP does not go quiet — a metro's messages arrive every second like every other mode's — but only the timestamp on them ticks at that rate. The coordinate and speed are held and refreshed in steps: measured off the live feed, 74% of consecutive messages between stations repeat the previous position exactly, and 96% do at a platform, so a train typically stands still for about three seconds and then arrives some fifty metres further down the line. The map read each ticking timestamp as a fresh report and re-anchored the train on its own stale position every second, which left the dead reckoning nothing to carry forward. It now re-anchors only when the coordinate actually changes, and carries the train along its track at the speed it last reported in between. Replayed against a captured feed, that cuts the seconds in which a train is drawn motionless from 81% to 29%, and the biggest distance it covers in any single second from about 100 m to 22 m.
- **A train stops being predicted after eight seconds rather than twenty**: the long held coordinates are the ones at platforms, where the frozen message keeps reporting the speed the train came in at while it is really slowing, dwelling and leaving — that reading predicts the eventual movement anywhere from a fifth of it to nearly six times it, so there is nothing there worth integrating. Between stations, where the same reading is good to about a tenth, a hold is over within four seconds nine times in ten, so a shorter horizon costs those nothing. On the captured feed it is the difference between a correction pulling a train back by up to 199 m — visibly running past its platform and being yanked back — and by at most 43 m.

---

## [v0.55.0] - 2026-09-03

### Added
- **The vehicles are solid, real-size models in 3D view**: turning on 3D used to tilt the buildings and leave the vehicles as flat stickers lying on the street. Each mode now has an extruded body built from the same anatomy as its schematic — a 27 m tram, a 12.5 m bus, the metro's coupled pair with the gap between its two units, and a 75 m commuter train with the pantograph on its roof — drawn at true scale in metres, so a train really is three tram-lengths of the street and the modes are tellable apart by size alone before you read a number. The schematic's detail comes with it, chosen for what a map camera looking down can actually see: a window band around the flanks, individual doors on both sides that go amber as they slide open, a pale cab patch on the roof at each driving end (which is what says which way a vehicle faces once the icon's nose has faded out), the metro's white roof band and the train's pantograph. Bodies carry their line's colour exactly as the icons do, and a selected vehicle goes gold. The bodies fade in over one zoom level as the flat icons fade out, so the swap is a crossfade rather than a pop, and only vehicles actually on screen are built.

---

## [v0.54.2] - 2026-09-03

### Fixed
- **Metro dead reckoning actually runs now, so trains stop looking frozen**: the prediction that carries a metro train down its tunnel through the seconds the feed is silent needs the line's track geometry, and it was reading that from the same state the map uses to *draw* highlighted route ribbons — which only holds a line while it is selected, or a stop or a vehicle on it is. In the ordinary view (metro switched on, nothing selected) there were no tracks, so no train was ever snapped to one, no position fix was ever recorded and nothing was ever predicted forward: every metro train sat still between reports and then jumped, exactly the motion v0.53.2 was written to remove. The metro's polylines are now fetched on their own, once per page load, for whichever metro lines are actually in the feed, and they never reach the map style — so the snapping, the along-track glide and the dead reckoning work whether or not a line is highlighted, and switching the metro off costs no request at all.

---

## [v0.54.1] - 2026-09-03

### Fixed
- **The metro and commuter trains get their own vehicle schematic**: the diagnostics panel drew one generic rail carriage for everything on rails, so clicking an M-train or an Sm-unit showed the same three-door tram body, only tinted a different colour — the map icons had told the modes apart for a while, the panel had not. Each mode now has its own side-on drawing: the metro is the coupled pair it actually is, two units with the coupling seam between them, a cab at each outer end and four door sets; the commuter train has the raked nose, the pantograph on the roof and paired bogie wheels; the tram keeps the single carriage with a cab at both ends. Doors still slide with the reported `drst` and the wheels still spin at the vehicle's own speed.

---

## [v0.54.0] - 2026-09-01

### Changed
- **The Settings section is gone; its switches live on the map**: light/dark and 3D now sit as their own translucent chip pair in the top-left corner of the map, mirroring the mode chips already in the top-right, and the four vehicle-mode toggles are only in that corner row rather than duplicated in the panel. Every switch that was two taps behind a drawer — a bottom sheet on a phone — is one tap on the map, the filter panel is just the line list plus service alerts, and the phone's bottom bar loses its Settings tab.

---

## [v0.53.2] - 2026-09-01

### Fixed
- **Metro trains keep moving between position reports instead of freezing and lurching**: the metro feed is the sparsest on the map — the trains spend most of their run in tunnel, and while they do, HFP goes quiet for seconds at a time while the backend keeps rebroadcasting the last known point every second. The animation had nothing to say about that silence: it eased into the last reported point, arrived, and froze; the next report then landed several seconds of travel further down the line and was crammed into one second of glide. A metro train is the easiest vehicle here to predict, though — it is on rails, it cannot leave them, and every report carries the speed and acceleration measured on board. Those are now integrated forward along the train's own track, so a five-second gap draws five seconds of travel and the next report only corrects a small error rather than delivering a jump. The prediction is deliberately conservative: a reported acceleration is trusted for four seconds and then coasts, speed is clamped to the line's, and after twenty seconds of silence the train stops rather than being carried off on a twenty-second-old reading.
- **A metro train covers each second at the rate it is actually travelling**: the within-update motion was shaped by a generic ease-in/ease-out curve picked from the sign of the acceleration. It now follows the same speed profile that placed the target, which also means a window opened four seconds into a gap in the feed is animated with the speed the train has by then, not the speed it had when it last spoke.

---

## [v0.53.1] - 2026-09-01

### Fixed
- **Both directions of a route are drawn again**: a line ships a dozen-odd pattern polylines — each direction, plus short turns and branch variants — and they were collapsed to a single path so the repeats would not stack on top of each other. That took the return leg with them, and outside the centre the two directions do not share a track: trams heading one way were drawn beside their route line rather than on it, and on the metro, where positions are projected onto the route geometry itself, half the trains ran along a tunnel that was not drawn at all. The patterns are now split into their two directions and thinned within each, so the short turns and duplicates still go but the other direction survives. It is kept only where it actually has its own alignment, measured on a grid fine enough (about 11 m) to tell one track from the other, so a single-track section is still drawn once rather than twice over. Both directions share their line's offset slot and run the same way round, so they stay the real distance apart on screen instead of being thrown to opposite sides of the fan.

---

## [v0.53.0] - 2026-09-01

### Added
- **Mode switches in the corner of the map**: tram, bus, metro and commuter train each get a small translucent chip in the top-right corner, tinted with that mode's own colour when it is on and greyed when it is off — so the row doubles as a legend for what is currently on the map. They drive exactly the same state as the Settings toggles (which stay where they are), including the WebSocket mode request that makes the backend subscribe to a feed; switching a mode was two taps behind a drawer, or a bottom sheet on a phone, and it is the control people reach for most. The row sits beside the destination search on desktop and stacks vertically on phones, where the centre of the screen is the search pill's.

---

## [v0.52.2] - 2026-09-01

### Fixed
- **Metro trains run on the metro tracks now**: nearly all of both metro lines is in tunnel, where there is no GPS fix and HFP positions are dead-reckoned from odometry — so trains drifted off their alignment and were drawn in parks, in the sea, or a block from the platform they were standing at. There are exactly two lines and both are grade-separated, so every train that exists is somewhere on one of a handful of known polylines: reported positions are now projected onto the line's own route geometry (up to 400 m of drift; further off and the message is left alone rather than given an invented position), and a train keeps to the pattern it is already running along instead of flickering between the two near-coincident directions.
- **A metro train slides along its tunnel between updates instead of across the map**: with the train pinned to a known track, the once-a-second position updates are interpolated as distance *along* the geometry, so it follows the curves rather than cutting the corner, and it points the way it is actually travelling — worked out from how it moved, not from the heading the feed reports, which underground is as dead-reckoned as the position. A correction that arrives mid-glide is now eased in from wherever the vehicle is on screen rather than snapping it back to the previous update's endpoint; this applies to every mode, not just the metro.

### Changed
- **The metro has an icon of its own**: it was a rounded carriage a shade wider than the tram's, which at map size read as "a tram in orange". It is now drawn as what it is — a coupled pair of units, one long flat-fronted train split across the middle by the coupling gap, with a cab windshield at each end (a metro train reverses at the terminus rather than turning around), the leading one brighter so the direction of travel still reads.

---

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
