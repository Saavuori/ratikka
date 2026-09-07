import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VehicleSchematic } from './VehicleSchematic';
import { METRO_ORANGE, TRAIN_PURPLE, BUS_BLUE, FERRY_CYAN } from '../lib/routeColors';
import { occupancyColor } from '../lib/occupancy';

const render = (mode: string, doorsOpen = false, occupancy: number | null = null) =>
  renderToStaticMarkup(
    <VehicleSchematic
      mode={mode}
      isDoorsOpen={doorsOpen}
      isMoving
      wheelSpeedCss="0.5s"
      occupancy={occupancy}
    />
  );

describe('VehicleSchematic', () => {
  it('draws a different body for every mode', () => {
    const drawings = ['tram', 'bus', 'metro', 'train', 'ferry'].map((m) => render(m));
    expect(new Set(drawings).size).toBe(5);
  });

  it('tints each body with its mode accent', () => {
    expect(render('bus')).toContain(BUS_BLUE);
    expect(render('metro')).toContain(METRO_ORANGE);
    expect(render('train')).toContain(TRAIN_PURPLE);
    expect(render('ferry')).toContain(FERRY_CYAN);
  });

  it('gives the ferry a saloon that fills with its reported load', () => {
    // The one mode with a real passenger count says so in words as well as in
    // colour; a vessel nobody has counted says nothing rather than "Empty".
    expect(render('ferry', false, 0.9)).toContain(occupancyColor(0.9));
    expect(render('ferry', false, 0.9)).toContain('90%');
    expect(render('ferry', false, 0.1)).toContain('10%');
    expect(render('ferry', false, null)).not.toContain('%');
    // No wheels on a boat — the motion cue is the water it is pushing.
    expect(render('ferry')).not.toContain('rotating-wheel');
    expect(render('ferry')).toContain('M198,52');
  });

  it('gives the metro two coupled units and the train a pantograph', () => {
    // Four door sets (two per unit) is the metro's tell; the tram has three.
    expect(render('metro').match(/door-leaf-left/g)).toHaveLength(4);
    expect(render('tram').match(/door-leaf-left/g)).toHaveLength(3);
    expect(render('train')).toContain('M94,15 L102,8 L116,8 L124,15');
    expect(render('tram')).not.toContain('M94,15');
  });

  it('falls back to the tram body for an unknown mode', () => {
    expect(render('funicular')).toBe(render('tram'));
  });

  it('slides the door leaves apart when the doors are open', () => {
    expect(render('train', false)).not.toContain('translateX(5px)');
    expect(render('train', true)).toContain('translateX(5px)');
  });
});
