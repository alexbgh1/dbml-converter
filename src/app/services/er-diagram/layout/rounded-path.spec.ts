import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROUTE_CORNER_RADIUS,
  roundedPolylinePath,
} from './rounded-path';

describe('roundedPolylinePath', () => {
  it('handles zero, one, and two points without invalid SVG', () => {
    expect(roundedPolylinePath([])).toBe('');
    expect(roundedPolylinePath([{ x: -5, y: 2 }])).toBe('M -5 2');
    expect(
      roundedPolylinePath([
        { x: -5, y: 2 },
        { x: 10, y: 2 },
      ]),
    ).toBe('M -5 2 L 10 2');
  });

  it('uses the default radius and leaves long segments straight', () => {
    expect(DEFAULT_ROUTE_CORNER_RADIUS).toBe(8);
    expect(
      roundedPolylinePath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
        { x: 180, y: 60 },
      ]),
    ).toBe('M 0 0 L 92 0 Q 100 0 100 8 L 100 52 Q 100 60 108 60 L 180 60');
  });

  it('clamps a corner to half of the shortest adjacent segment', () => {
    expect(
      roundedPolylinePath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 6 },
      ]),
    ).toBe('M 0 0 L 7 0 Q 10 0 10 3 L 10 6');
  });

  it('supports negative coordinates', () => {
    expect(
      roundedPolylinePath([
        { x: -30, y: -20 },
        { x: -10, y: -20 },
        { x: -10, y: 10 },
      ]),
    ).toBe('M -30 -20 L -18 -20 Q -10 -20 -10 -12 L -10 10');
  });

  it('uses straight lines when radius is zero', () => {
    expect(
      roundedPolylinePath(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
        ],
        0,
      ),
    ).toBe('M 0 0 L 20 0 L 20 20');
  });

  it('never emits NaN for invalid points or radius', () => {
    expect(
      roundedPolylinePath([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 10 },
      ]),
    ).toBe('');

    const path = roundedPolylinePath(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
      Number.NaN,
    );
    expect(path).not.toContain('NaN');
    expect(path).toBe('M 0 0 L 12 0 Q 20 0 20 8 L 20 20');
  });

  it('does not emit NaN when finite coordinates overflow during subtraction', () => {
    const path = roundedPolylinePath([
      { x: -Number.MAX_VALUE, y: 0 },
      { x: Number.MAX_VALUE, y: 0 },
      { x: Number.MAX_VALUE, y: 20 },
    ]);

    expect(path).not.toContain('NaN');
    expect(path).not.toContain('Infinity');
  });
});
