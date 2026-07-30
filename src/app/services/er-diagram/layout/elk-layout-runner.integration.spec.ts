import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runElkLayout } from './elk-layout-runner';
import type {
  LayoutEdgeSection,
  LayoutPoint,
  LayoutRequest,
  LayoutResult,
} from './layout-contracts';

// Deliberately pinned: changing this value requires rerunning the routing and
// visual fixtures because ELK upgrades may produce equally valid new geometry.
const REVIEWED_ELK_VERSION = '0.11.1';

describe('ELK layout runner integration', () => {
  it('uses the ELK version reviewed with the intentional adapter options', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve('node_modules', 'elkjs', 'package.json'), 'utf8'),
    ) as { version?: unknown };

    expect(packageJson.version).toBe(REVIEWED_ELK_VERSION);
  });

  it('loads real elkjs and returns deterministic finite orthogonal geometry', async () => {
    const first = await runElkLayout(request(401));
    const second = await runElkLayout(request(402));

    expect(first.engine).toBe('elk');
    expect(first.nodes).toHaveLength(4);
    expect(first.edges).toHaveLength(4);
    expect(first.diagnostics).toEqual([]);
    expect(finiteBounds(first)).toBe(true);

    const positions = new Map(
      first.nodes.map((node) => [node.id, node.position]),
    );
    expect(positions.get('account')!.x).toBeLessThan(positions.get('order')!.x);
    expect(positions.get('account')!.x).toBeLessThan(positions.get('audit')!.x);
    expect(positions.get('order')!.x).toBeLessThan(positions.get('invoice')!.x);
    expect(positions.get('audit')!.x).toBeLessThan(positions.get('invoice')!.x);

    for (const node of first.nodes) {
      expect(finitePoint(node.position)).toBe(true);
      expect(Number.isFinite(node.width) && node.width > 0).toBe(true);
      expect(Number.isFinite(node.height) && node.height > 0).toBe(true);
      for (const port of node.ports) {
        expect(finitePoint(port.position)).toBe(true);
        expect(Number.isFinite(port.width)).toBe(true);
        expect(Number.isFinite(port.height)).toBe(true);
      }
    }

    for (const edge of first.edges) {
      expect(edge.sections.length).toBeGreaterThan(0);
      for (const section of edge.sections) {
        expect(finiteOrthogonalSection(section)).toBe(true);
      }
    }

    expect(layoutGeometry(second)).toEqual(layoutGeometry(first));
  }, 20_000);
});

function request(requestId: number): LayoutRequest {
  const nodes = [
    node('account', ['west', 'east']),
    node('order', ['west', 'east']),
    node('audit', ['west', 'east']),
    node('invoice', ['west', 'east']),
  ];

  return {
    requestId,
    options: {
      direction: 'right',
      routing: 'orthogonal',
      padding: 48,
      componentSpacing: 80,
      nodeSpacing: 56,
      layerSpacing: 160,
    },
    nodes,
    edges: [
      edge('account-order', 'account', 'order'),
      edge('account-audit', 'account', 'audit'),
      edge('order-invoice', 'order', 'invoice'),
      edge('audit-invoice', 'audit', 'invoice'),
    ],
  };
}

function node(id: string, sides: readonly ('west' | 'east')[]) {
  return {
    id,
    width: 220,
    height: 108,
    ports: sides.map((side) => ({
      id: `${id}-${side}`,
      position: { x: side === 'west' ? 0 : 220, y: 60 },
      width: 1,
      height: 1,
      side,
    })),
  } as const;
}

function edge(id: string, sourceNodeId: string, targetNodeId: string) {
  return {
    id,
    semantic: {
      source: { nodeId: targetNodeId, columnId: `${targetNodeId}-fk` },
      target: { nodeId: sourceNodeId, columnId: `${sourceNodeId}-id` },
    },
    layout: {
      source: {
        nodeId: sourceNodeId,
        portId: `${sourceNodeId}-east`,
      },
      target: {
        nodeId: targetNodeId,
        portId: `${targetNodeId}-west`,
      },
    },
  } as const;
}

function finiteBounds(result: LayoutResult): boolean {
  const { minX, minY, maxX, maxY, width, height } = result.bounds;
  return (
    [minX, minY, maxX, maxY, width, height].every(Number.isFinite) &&
    maxX >= minX &&
    maxY >= minY &&
    width === maxX - minX &&
    height === maxY - minY
  );
}

function finiteOrthogonalSection(section: LayoutEdgeSection): boolean {
  const points = [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint,
  ];
  const junctionsAreFinite = (section.junctionPoints ?? []).every(finitePoint);
  return (
    junctionsAreFinite &&
    points.every(finitePoint) &&
    points.slice(1).every((point, index) => {
      const previous = points[index];
      return previous.x === point.x || previous.y === point.y;
    })
  );
}

function finitePoint(point: LayoutPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function layoutGeometry(result: LayoutResult): unknown {
  return {
    nodes: result.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      width: node.width,
      height: node.height,
      ports: node.ports,
    })),
    edges: result.edges.map((edge) => ({
      id: edge.id,
      sections: edge.sections,
    })),
    bounds: result.bounds,
    diagnostics: result.diagnostics,
  };
}
