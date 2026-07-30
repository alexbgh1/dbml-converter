import { describe, expect, it } from 'vitest';

import { DiagramEdge, DiagramNode } from './er-diagram.interface';
import {
  columnMatchesSelection,
  edgeMatchesSelection,
  nodeMatchesSelection,
} from './diagram-selection';

const edge = {
  id: 'edge-orders-users',
  fromNode: 'orders',
  toNode: 'users',
  fromColumnId: 'orders-user-id',
  toColumnId: 'users-id',
} as DiagramEdge;

const users = { id: 'users' } as DiagramNode;
const orders = { id: 'orders' } as DiagramNode;
const tags = { id: 'tags' } as DiagramNode;

describe('diagram selection helpers', () => {
  it('matches edges connected to a selected node', () => {
    const selection = { kind: 'node' as const, nodeId: 'orders' };

    expect(edgeMatchesSelection(edge, selection)).toBe(true);
    expect(
      edgeMatchesSelection(
        { ...edge, fromNode: 'tags', toNode: 'posts' },
        selection,
      ),
    ).toBe(false);
    expect(nodeMatchesSelection(users, [edge], selection)).toBe(true);
    expect(nodeMatchesSelection(tags, [edge], selection)).toBe(false);
  });

  it('matches only the selected column connections', () => {
    const selection = {
      kind: 'column' as const,
      nodeId: 'orders',
      columnId: 'orders-user-id',
    };

    expect(edgeMatchesSelection(edge, selection)).toBe(true);
    expect(
      edgeMatchesSelection(
        { ...edge, fromColumnId: 'orders-status-id' },
        selection,
      ),
    ).toBe(false);
    expect(columnMatchesSelection('orders', 'orders-user-id', selection)).toBe(
      true,
    );
    expect(nodeMatchesSelection(users, [edge], selection)).toBe(true);
  });

  it('emphasizes both endpoints for an edge selection', () => {
    const selection = {
      kind: 'edge' as const,
      edgeId: 'edge-orders-users',
    };

    expect(nodeMatchesSelection(users, [edge], selection)).toBe(true);
    expect(nodeMatchesSelection(orders, [edge], selection)).toBe(true);
    expect(nodeMatchesSelection(tags, [edge], selection)).toBe(false);
  });
});
