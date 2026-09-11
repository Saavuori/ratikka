import { describe, expect, it } from 'vitest';
import { operatorName } from './operators';

describe('operatorName', () => {
  it('names the operators the feed reports', () => {
    expect(operatorName(22)).toBe('Nobina Finland Oy');
    expect(operatorName(90)).toBe('VR-Yhtymä Oyj');
  });

  it('gives the two city-transport ids the same name', () => {
    // HSL reports Pääkaupunkiseudun Kaupunkiliikenne under both, and Pohjolan
    // Liikenne under two more.
    expect(operatorName(9)).toBe(operatorName(50));
    expect(operatorName(6)).toBe(operatorName(18));
  });

  it('falls back to the number rather than claiming not to know', () => {
    expect(operatorName(404)).toBe('Operator #404');
  });

  it('says only that it is an HSL vehicle when the feed omits the operator', () => {
    expect(operatorName(undefined)).toBe('HSL Operator');
  });
});
