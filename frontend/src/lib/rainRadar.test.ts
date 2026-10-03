import { describe, it, expect } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import {
  RADAR_ATTRIBUTION,
  RADAR_CAPABILITIES_URL,
  RADAR_LAYER_NAME,
  RADAR_MAX_ZOOM,
  latestRadarFrame,
  radarFrameLabel,
  radarSourceSpec,
  radarTileUrl,
} from './rainRadar';

// The layer's dimensions as FMI's capabilities document carries them,
// elevation and the two FMI-specific ones included: each has a `default` too,
// and only the time's is a frame.
const CAPABILITIES = `
<Layer queryable="1" opaque="0">
  <Name>radar_finland_cappi_rate</Name>
  <Title>Rain Rate CAPPI Finland Radar</Title>
  <Dimension name="time" default="2026-10-03T12:30:00Z" units="ISO8601">2026-09-19T02:20:00.000Z/2026-10-03T12:30:00.000Z/PT5M</Dimension>
  <Dimension name="elevation" default="600.0" units="Meters" unitSymbol="m">600.0</Dimension>
  <Dimension name="FILTER" default="filtered" units="">filtered</Dimension>
  <Dimension name="GEOCONF" default="finradfast" units="">finradfast</Dimension>
</Layer>`;

describe('radarTileUrl', () => {
  const url = radarTileUrl('2026-10-03T12:30:00Z');

  it('asks FMI open WMS for the Finland-wide rain-rate composite', () => {
    expect(url.startsWith('https://openwms.fmi.fi/geoserver/Radar/wms?')).toBe(true);
    expect(url).toContain(`layers=${RADAR_LAYER_NAME}`);
    expect(RADAR_LAYER_NAME).toBe('Radar:radar_finland_cappi_rate');
  });

  // Without a time FMI serves the latest frame under a day-long Cache-Control,
  // and the browser would keep showing it.
  it('names its frame', () => {
    expect(url).toContain('time=2026-10-03T12%3A30%3A00Z');
  });

  it('leaves the bbox token for MapLibre, in the CRS it fills it in', () => {
    expect(url).toContain('bbox={bbox-epsg-3857}');
    expect(url).toContain('crs=EPSG:3857');
  });

  it('is a transparent PNG, so the map shows through where it is dry', () => {
    expect(url).toContain('format=image/png');
    expect(url).toContain('transparent=true');
  });
});

describe('radarSourceSpec', () => {
  it('is a raster source MapLibre accepts', () => {
    const errors = validateStyleMin({
      version: 8,
      sources: { 'fmi-rain-radar': radarSourceSpec('2026-10-03T12:30:00Z') },
      layers: [],
    } as never);
    expect(errors).toEqual([]);
  });

  it('stops at a zoom MapLibre can smooth up from, instead of FMI’s hard squares', () => {
    expect(radarSourceSpec('2026-10-03T12:30:00Z').maxzoom).toBe(RADAR_MAX_ZOOM);
  });

  it('carries the credit the licence requires', () => {
    expect(radarSourceSpec('2026-10-03T12:30:00Z').attribution).toBe(RADAR_ATTRIBUTION);
    expect(RADAR_ATTRIBUTION).toContain('Ilmatieteen laitos');
  });
});

describe('RADAR_CAPABILITIES_URL', () => {
  // The workspace-wide document is ~400 kB; the per-layer one is ~12 kB.
  it('is the one layer’s capabilities, not the whole workspace’s', () => {
    expect(RADAR_CAPABILITIES_URL).toContain('/Radar/radar_finland_cappi_rate/wms?');
    expect(RADAR_CAPABILITIES_URL).toContain('request=GetCapabilities');
  });
});

describe('latestRadarFrame', () => {
  it('reads the time dimension’s default, the newest frame', () => {
    expect(latestRadarFrame(CAPABILITIES)).toBe('2026-10-03T12:30:00Z');
  });

  it('does not take another dimension’s default for it', () => {
    const noTime = CAPABILITIES.replace(/<Dimension name="time"[^\n]*\n/, '');
    expect(latestRadarFrame(noTime)).toBeNull();
  });

  it('finds it whatever order the attributes come in', () => {
    expect(latestRadarFrame('<Dimension default="2026-10-03T12:35:00Z" name="time" units="ISO8601">'))
      .toBe('2026-10-03T12:35:00Z');
  });

  it('rejects a default that is not a timestamp', () => {
    expect(latestRadarFrame('<Dimension name="time" default="current" units="ISO8601">')).toBeNull();
  });

  it('returns nothing for an error page', () => {
    expect(latestRadarFrame('<html><body>502 Bad Gateway</body></html>')).toBeNull();
    expect(latestRadarFrame('')).toBeNull();
  });
});

describe('radarFrameLabel', () => {
  it('is the frame’s Helsinki wall-clock time', () => {
    // 12:30 UTC is 15:30 in Helsinki summer time (UTC+3)...
    expect(radarFrameLabel('2026-10-03T12:30:00Z')).toBe('15:30');
    // ...and 14:30 in winter time (UTC+2).
    expect(radarFrameLabel('2026-12-03T12:30:00Z')).toBe('14:30');
  });
});
