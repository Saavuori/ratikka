import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VehicleSchematic } from './VehicleSchematic';
import { METRO_ORANGE, TRAIN_PURPLE, BUS_BLUE } from '../lib/routeColors';

const render = (mode: string, doorsOpen = false) =>
  renderToStaticMarkup(
    <VehicleSchematic mode={mode} isDoorsOpen={doorsOpen} isMoving wheelSpeedCss="0.5s" />
  );

describe('VehicleSchematic', () => {
  it('draws a different body for every mode', () => {
    const drawings = ['tram', 'bus', 'metro', 'train'].map((m) => render(m));
    expect(new Set(drawings).size).toBe(4);
  });

  it('tints each body with its mode accent', () => {
    expect(render('bus')).toContain(BUS_BLUE);
    expect(render('metro')).toContain(METRO_ORANGE);
    expect(render('train')).toContain(TRAIN_PURPLE);
  });

  it('gives the metro two coupled units and the train a pantograph', () => {
    // Four door sets (two per unit) is the metro's tell; the tram has three.
    expect(render('metro').match(/door-leaf-left/g)).toHaveLength(4);
    expect(render('tram').match(/door-leaf-left/g)).toHaveLength(3);
    expect(render('train')).toContain('M94,15 L102,8 L116,8 L124,15');
    expect(render('tram')).not.toContain('M94,15');
  });

  it('falls back to the tram body for an unknown mode', () => {
    expect(render('ferry')).toBe(render('tram'));
  });

  it('slides the door leaves apart when the doors are open', () => {
    expect(render('train', false)).not.toContain('translateX(5px)');
    expect(render('train', true)).toContain('translateX(5px)');
  });
});
