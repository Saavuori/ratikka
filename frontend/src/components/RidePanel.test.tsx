import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RidePanel } from './RidePanel';
import type { RideDetection } from '../hooks/useRideDetection';

function detection(over: Partial<RideDetection> = {}): RideDetection {
  return {
    status: 'off',
    suggestion: null,
    ambiguous: null,
    rideVehicleId: null,
    rideMode: null,
    error: '',
    start: vi.fn(),
    stop: vi.fn(),
    accept: vi.fn(),
    dismiss: vi.fn(),
    ...over,
  };
}

const render = (props: Partial<Parameters<typeof RidePanel>[0]> = {}) =>
  renderToStaticMarkup(
    <RidePanel detection={detection()} rideLine={null} rideNextStop={null} {...props} />
  );

describe('RidePanel', () => {
  it('offers nothing while the map is not locating the reader', () => {
    expect(render()).toBe('');
  });

  it('offers to look once the reader has put themselves on the map', () => {
    // The apostrophe in "I'm on board" comes back HTML-escaped from the
    // static renderer, so the launcher is recognised by its class.
    expect(render({ locating: true })).toContain('ride-launcher');
  });

  it('keeps a search on screen after locating is switched off, with its way out', () => {
    const markup = render({ detection: detection({ status: 'scanning' }), locating: false });
    expect(markup).toContain('Looking for your vehicle');
    expect(markup).toContain('Stop');
  });

  it('says why it cannot look, rather than offering to', () => {
    const markup = render({
      detection: detection({ status: 'denied', error: 'Location permission was refused' }),
      locating: true,
    });
    expect(markup).toContain('Ride along unavailable');
  });
});
