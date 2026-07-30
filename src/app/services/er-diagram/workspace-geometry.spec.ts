import { describe, expect, it } from 'vitest';

import {
  clientPointToWorkspace,
  panAfterBoundsOriginChange,
} from './workspace-geometry';

describe('ER workspace geometry', () => {
  it('converts client coordinates through viewport offset, pan, zoom and bounds', () => {
    expect(
      clientPointToWorkspace(
        { x: 410, y: 260 },
        {
          viewportOrigin: { x: 10, y: 20 },
          pan: { x: 100, y: 40 },
          zoom: 0.5,
          boundsOrigin: { x: -80, y: -30 },
        },
      ),
    ).toEqual({ x: 520, y: 370 });
  });

  it('supports minimum/maximum zoom and rejects unusable transforms', () => {
    expect(
      clientPointToWorkspace(
        { x: 35, y: 70 },
        {
          viewportOrigin: { x: 0, y: 0 },
          pan: { x: 0, y: 0 },
          zoom: 0.35,
          boundsOrigin: { x: 0, y: 0 },
        },
      ),
    ).toEqual({ x: 100, y: 200 });
    expect(
      clientPointToWorkspace(
        { x: 200, y: 400 },
        {
          viewportOrigin: { x: 0, y: 0 },
          pan: { x: 0, y: 0 },
          zoom: 2,
          boundsOrigin: { x: 0, y: 0 },
        },
      ),
    ).toEqual({ x: 100, y: 200 });
    expect(
      clientPointToWorkspace(
        { x: 1, y: 1 },
        {
          viewportOrigin: { x: 0, y: 0 },
          pan: { x: 0, y: 0 },
          zoom: 0,
          boundsOrigin: { x: 0, y: 0 },
        },
      ),
    ).toBeNull();
  });

  it('adjusts pan so expanding negative bounds does not move unchanged nodes', () => {
    expect(
      panAfterBoundsOriginChange(
        { x: 120, y: 80 },
        { x: 40, y: 20 },
        { x: -60, y: -30 },
        0.5,
      ),
    ).toEqual({ x: 70, y: 55 });
  });
});
