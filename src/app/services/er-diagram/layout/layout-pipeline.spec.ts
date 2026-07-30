import { describe, expect, it } from 'vitest';

import { Cardinality } from '../../dbml-parser/interfaces/dbml-parser.interface';
import { schemaToDiagram } from '../schema-to-diagram';
import {
  applyLayoutResult,
  diagramToLayoutRequest,
} from './diagram-layout-adapter';
import { ErLayoutController, ErLayoutInput } from './er-layout-controller';
import { runGridLayout } from './grid-layout-runner';

describe('ER layout pipeline', () => {
  it('keeps a usable rounded diagram when the automatic engine fails', async () => {
    const semanticGraph = schemaToDiagram({
      tables: [
        {
          name: 'posts',
          alias: null,
          columns: [
            { name: 'id', type: 'int', pk: true },
            { name: 'author_id', type: 'int', nullable: false },
          ],
        },
        {
          name: 'users',
          alias: null,
          columns: [{ name: 'id', type: 'int', pk: true }],
        },
      ],
      relations: [
        {
          from: { table: 'posts', column: 'author_id' },
          to: { table: 'users', column: 'id' },
          cardinality: { from: Cardinality.Many, to: Cardinality.One },
        },
      ],
    });
    const initialRequest = diagramToLayoutRequest(semanticGraph, 0);
    const input: ErLayoutInput = {
      nodes: initialRequest.nodes,
      edges: initialRequest.edges,
      options: initialRequest.options,
    };
    const controller = new ErLayoutController(async () => {
      throw new Error('ELK unavailable in test');
    }, runGridLayout);

    await controller.layout(input);

    expect(controller.state.status).toBe('ready');
    if (controller.state.status !== 'ready') return;
    expect(controller.state.source).toBe('fallback');
    expect(controller.state.warning?.code).toBe('layout-engine-fallback');

    const rendered = applyLayoutResult(semanticGraph, controller.state.result);
    expect(rendered.nodes.map((node) => node.label)).toEqual([
      'posts',
      'users',
    ]);
    expect(rendered.edges).toHaveLength(1);
    expect(rendered.edges[0].layout.path).toContain(' Q ');
    expect(rendered.edges[0].layout.path).not.toContain(' C ');
    expect(rendered.edges[0].layout.path).not.toContain('NaN');
    expect(rendered.layout.width).toBeGreaterThan(0);
  });

  it('orients layout parent-to-dependent without changing schema semantics', () => {
    const graph = schemaToDiagram({
      tables: [
        {
          name: 'children',
          alias: null,
          columns: [{ name: 'parent_id', type: 'int' }],
        },
        {
          name: 'parents',
          alias: null,
          columns: [{ name: 'id', type: 'int', pk: true }],
        },
      ],
      relations: [
        {
          from: { table: 'children', column: 'parent_id' },
          to: { table: 'parents', column: 'id' },
          cardinality: { from: Cardinality.Many, to: Cardinality.One },
        },
      ],
    });

    const edge = diagramToLayoutRequest(graph, 9).edges[0];

    expect(edge.semantic.source.nodeId).toBe(graph.nodes[0].id);
    expect(edge.semantic.target.nodeId).toBe(graph.nodes[1].id);
    expect(edge.layout.source.nodeId).toBe(graph.nodes[1].id);
    expect(edge.layout.target.nodeId).toBe(graph.nodes[0].id);
  });
});
