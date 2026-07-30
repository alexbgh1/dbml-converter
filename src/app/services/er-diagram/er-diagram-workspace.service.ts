import { Injectable } from '@angular/core';

import {
  isFiniteLayoutPoint,
  type LayoutPoint,
} from './layout/layout-contracts';

/**
 * Session-only presentation state for the ER workspace.
 *
 * Positions intentionally live outside DatabaseSchema and generated output.
 * The root lifetime keeps them across route navigation, while a page reload
 * remains the natural reset boundary.
 */
@Injectable({ providedIn: 'root' })
export class ErDiagramWorkspaceService {
  private readonly manualPositions = new Map<string, LayoutPoint>();

  snapshot(): ReadonlyMap<string, LayoutPoint> {
    return new Map(
      [...this.manualPositions].map(([nodeId, position]) => [
        nodeId,
        { ...position },
      ]),
    );
  }

  setNodePosition(nodeId: string, position: LayoutPoint): void {
    if (!nodeId) {
      throw new TypeError('A manual ER position requires a node ID.');
    }
    if (!isFiniteLayoutPoint(position)) {
      throw new TypeError(
        'A manual ER position must contain finite coordinates.',
      );
    }
    this.manualPositions.set(nodeId, { ...position });
  }

  retainNodeIds(nodeIds: Iterable<string>): ReadonlyMap<string, LayoutPoint> {
    const retained = new Set(nodeIds);
    for (const nodeId of this.manualPositions.keys()) {
      if (!retained.has(nodeId)) {
        this.manualPositions.delete(nodeId);
      }
    }
    return this.snapshot();
  }

  clear(): void {
    this.manualPositions.clear();
  }
}
