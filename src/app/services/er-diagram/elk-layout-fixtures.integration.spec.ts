import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DbmlParserService } from '../dbml-parser/dbml-parser';
import {
  applyLayoutResult,
  diagramToLayoutRequest,
} from './layout/diagram-layout-adapter';
import { runElkLayout } from './layout/elk-layout-runner';
import type { LayoutPoint, LayoutResult } from './layout/layout-contracts';
import { schemaToDiagram } from './schema-to-diagram';

const FIXTURES = [
  'isolated-long',
  'chain-diamond',
  'cycles-self',
  'hub-parallel',
  'junction-badges',
  'dense-commerce',
  'invalid-endpoint',
] as const;

describe('real ELK fixture integration', () => {
  it.each(FIXTURES)(
    '%s produces usable app-owned geometry',
    async (fixture) => {
      const parser = new DbmlParserService();
      parser.setDbmlContent(loadFixture(fixture));
      const semantic = schemaToDiagram(parser.schema());
      const request = diagramToLayoutRequest(semantic, 901);
      const requestBeforeLayout = JSON.stringify(request);

      const result = await runElkLayout(request);
      const rendered = applyLayoutResult(semantic, result);

      expect(JSON.stringify(request)).toBe(requestBeforeLayout);
      expect(result.engine).toBe('elk');
      expect(result.nodes.map(({ id }) => id).sort()).toEqual(
        request.nodes.map(({ id }) => id).sort(),
      );
      expect(result.edges.map(({ id }) => id).sort()).toEqual(
        request.edges.map(({ id }) => id).sort(),
      );
      expect(finiteResult(result)).toBe(true);
      expect(
        result.edges.every(
          (edge) =>
            edge.sections.length > 0 &&
            edge.sections.every((section) =>
              [
                section.startPoint,
                ...(section.bendPoints ?? []),
                section.endPoint,
                ...(section.junctionPoints ?? []),
              ].every(finitePoint),
            ),
        ),
      ).toBe(true);
      expect(
        rendered.edges.every(
          (edge) =>
            edge.layout.path.length > 0 &&
            !/NaN|Infinity|undefined/.test(edge.layout.path) &&
            Number.isFinite(edge.layout.labelX) &&
            Number.isFinite(edge.layout.labelY),
        ),
      ).toBe(true);
    },
    20_000,
  );

  it('keeps dense-commerce deterministic without pinning exact coordinates', async () => {
    const parser = new DbmlParserService();
    parser.setDbmlContent(loadFixture('dense-commerce'));
    const graph = schemaToDiagram(parser.schema());
    const request = diagramToLayoutRequest(graph, 902);

    const first = await runElkLayout(request);
    const second = await runElkLayout({ ...request, requestId: 903 });

    expect(geometryWithoutRequestId(second)).toEqual(
      geometryWithoutRequestId(first),
    );
  }, 20_000);
});

function loadFixture(fixture: (typeof FIXTURES)[number]): string {
  return readFileSync(
    resolve(
      'src',
      'app',
      'testing',
      'fixtures',
      'er-diagram',
      fixture,
      'input.dbml',
    ),
    'utf8',
  );
}

function finiteResult(result: LayoutResult): boolean {
  const { minX, minY, maxX, maxY, width, height } = result.bounds;
  return (
    [minX, minY, maxX, maxY, width, height].every(Number.isFinite) &&
    maxX >= minX &&
    maxY >= minY &&
    result.nodes.every(
      (node) =>
        finitePoint(node.position) &&
        Number.isFinite(node.width) &&
        node.width > 0 &&
        Number.isFinite(node.height) &&
        node.height > 0 &&
        node.ports.every((port) => finitePoint(port.position)),
    )
  );
}

function finitePoint(point: LayoutPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function geometryWithoutRequestId(result: LayoutResult): unknown {
  return {
    nodes: result.nodes,
    edges: result.edges,
    bounds: result.bounds,
    diagnostics: result.diagnostics,
  };
}
