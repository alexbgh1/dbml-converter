import { describe, expect, it } from 'vitest';

import { isFiniteLayoutPoint } from './layout-contracts';

describe('layout contracts', () => {
  it('accepts finite points, including negative coordinates', () => {
    expect(isFiniteLayoutPoint({ x: -120.5, y: 0 })).toBe(true);
  });

  it.each([
    { x: Number.NaN, y: 0 },
    { x: 0, y: Number.POSITIVE_INFINITY },
    { x: '0', y: 0 },
    { x: 0 },
    null,
  ])('rejects a non-finite or incomplete point: %j', (point) => {
    expect(isFiniteLayoutPoint(point)).toBe(false);
  });
});
