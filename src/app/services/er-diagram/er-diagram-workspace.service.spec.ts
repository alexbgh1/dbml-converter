import { describe, expect, it } from 'vitest';

import { ErDiagramWorkspaceService } from './er-diagram-workspace.service';

describe('ErDiagramWorkspaceService', () => {
  it('keeps defensive session-only position snapshots', () => {
    const service = new ErDiagramWorkspaceService();
    const original = { x: -20, y: 35 };

    service.setNodePosition('orders', original);
    original.x = 999;

    const first = service.snapshot();
    expect(first.get('orders')).toEqual({ x: -20, y: 35 });
    (first.get('orders') as { x: number }).x = 500;
    expect(service.snapshot().get('orders')).toEqual({ x: -20, y: 35 });
  });

  it('retains only IDs present in a new conversion and clears explicitly', () => {
    const service = new ErDiagramWorkspaceService();
    service.setNodePosition('users', { x: 10, y: 20 });
    service.setNodePosition('removed', { x: 30, y: 40 });

    expect([...service.retainNodeIds(['users', 'new-table'])]).toEqual([
      ['users', { x: 10, y: 20 }],
    ]);

    service.clear();
    expect(service.snapshot().size).toBe(0);
  });

  it('rejects missing IDs and non-finite coordinates', () => {
    const service = new ErDiagramWorkspaceService();

    expect(() => service.setNodePosition('', { x: 0, y: 0 })).toThrow(
      TypeError,
    );
    expect(() =>
      service.setNodePosition('users', { x: Number.NaN, y: 0 }),
    ).toThrow(TypeError);
    expect(service.snapshot().size).toBe(0);
  });
});
