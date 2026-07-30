import { describe, expect, it } from 'vitest';

import {
  normalizeRoutedEdgeSections,
  simplifyLayoutPolyline,
} from './route-normalizer';

describe('normalizeRoutedEdgeSections', () => {
  it('reads every section and preserves negative coordinates and junctions', () => {
    const result = normalizeRoutedEdgeSections([
      {
        id: 'first',
        startPoint: { x: -40, y: -20 },
        bendPoints: [{ x: 0, y: -20 }],
        endPoint: { x: 0, y: 10 },
        junctionPoints: [{ x: 0, y: -20 }],
      },
      {
        id: 'second',
        startPoint: { x: 0, y: 10 },
        endPoint: { x: 70, y: 10 },
      },
    ]);

    expect(result.status).toBe('valid');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]).toMatchObject({
      id: 'first',
      sourceSectionIndex: 0,
      junctionPoints: [{ x: 0, y: -20 }],
    });
    expect(result.sections[0].points).toEqual([
      { x: -40, y: -20 },
      { x: 0, y: -20 },
      { x: 0, y: 10 },
    ]);
    expect(result.sections[1].sourceSectionIndex).toBe(1);
  });

  it('removes duplicate and same-direction collinear points without removing turns', () => {
    const result = normalizeRoutedEdgeSections([
      {
        startPoint: { x: 0, y: 0 },
        bendPoints: [
          { x: 20, y: 0 },
          { x: 20, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 30 },
        ],
        endPoint: { x: 70, y: 30 },
      },
    ]);

    expect(result.sections[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 70, y: 30 },
    ]);
  });

  it('keeps a reversal because it changes the route geometry', () => {
    expect(
      simplifyLayoutPolyline([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 5, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it('drops only a section with an invalid required endpoint', () => {
    const result = normalizeRoutedEdgeSections([
      {
        startPoint: { x: Number.NaN, y: 0 },
        endPoint: { x: 20, y: 0 },
      },
      {
        startPoint: { x: -20, y: 5 },
        endPoint: { x: 20, y: 5 },
      },
    ]);

    expect(result.status).toBe('degraded');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].sourceSectionIndex).toBe(1);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-start-point',
        action: 'drop-section',
        sectionIndex: 0,
      }),
    );
  });

  it('drops invalid optional points but keeps the usable section', () => {
    const result = normalizeRoutedEdgeSections([
      {
        startPoint: { x: 0, y: 0 },
        bendPoints: [{ x: 30, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 5 }],
        endPoint: { x: 30, y: 30 },
        junctionPoints: [{ x: 30, y: 0 }, null],
      },
    ]);

    expect(result.status).toBe('degraded');
    expect(result.sections[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'invalid-bend-point',
      'invalid-junction-point',
    ]);
  });

  it('reports an invalid optional point list without rejecting the section', () => {
    const result = normalizeRoutedEdgeSections([
      {
        startPoint: { x: 0, y: 0 },
        bendPoints: 'not-a-list',
        endPoint: { x: 20, y: 0 },
      },
    ]);

    expect(result.status).toBe('degraded');
    expect(result.sections[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-point-list',
        action: 'drop-point-list',
        sectionIndex: 0,
      }),
    );
  });

  it('explicitly rejects the edge when no section survives', () => {
    const result = normalizeRoutedEdgeSections([
      null,
      { startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: Number.NaN } },
    ]);

    expect(result.status).toBe('rejected');
    expect(result.sections).toEqual([]);
    expect(result.issues.at(-1)).toMatchObject({
      code: 'no-usable-sections',
      action: 'reject-edge',
      sectionIndex: null,
    });
  });

  it('rejects a one-point section when start and end coincide', () => {
    const result = normalizeRoutedEdgeSections([
      { startPoint: { x: 4, y: -2 }, endPoint: { x: 4, y: -2 } },
    ]);

    expect(result.status).toBe('rejected');
    expect(result.sections).toEqual([]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'zero-length-section',
          action: 'drop-section',
        }),
      ]),
    );
  });

  it('keeps a loop section whose endpoints coincide but bends add length', () => {
    const result = normalizeRoutedEdgeSections([
      {
        startPoint: { x: 4, y: -2 },
        bendPoints: [
          { x: 24, y: -2 },
          { x: 24, y: 18 },
          { x: 4, y: 18 },
        ],
        endPoint: { x: 4, y: -2 },
      },
    ]);

    expect(result.status).toBe('valid');
    expect(result.sections[0].points).toHaveLength(5);
  });

  it('explicitly rejects an absent section list', () => {
    expect(normalizeRoutedEdgeSections(undefined)).toMatchObject({
      status: 'rejected',
      sections: [],
      issues: [
        {
          code: 'missing-sections',
          action: 'reject-edge',
          sectionIndex: null,
        },
      ],
    });
  });
});
