/**
 * Geometry and layout contracts owned by the application.
 *
 * External layout engines must be adapted to these types at the boundary. This
 * keeps renderer and domain code independent from an engine's public API.
 */

/** Runtime invariant: both coordinates are finite numbers. */
export interface LayoutPoint {
  readonly x: number;
  readonly y: number;
}

export interface LayoutSize {
  readonly width: number;
  readonly height: number;
}

export interface LayoutBounds extends LayoutSize {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export type LayoutPortSide = 'north' | 'east' | 'south' | 'west';

export interface LayoutPortRequest extends LayoutSize {
  readonly id: string;
  /** Position relative to the owning node's top-left corner. */
  readonly position: LayoutPoint;
  readonly side: LayoutPortSide;
}

export interface LayoutNodeRequest extends LayoutSize {
  readonly id: string;
  readonly ports: readonly LayoutPortRequest[];
  /** Optional manual/session position to be honored by a capable engine. */
  readonly position?: LayoutPoint;
  readonly positionMode?: 'automatic' | 'fixed';
}

/** Endpoint in the schema's original relation direction. */
export interface LayoutSemanticEndpoint {
  readonly nodeId: string;
  readonly columnId?: string;
}

/** Endpoint and optional port in the direction presented to the layout engine. */
export interface LayoutEngineEndpoint {
  readonly nodeId: string;
  readonly portId?: string;
}

export interface LayoutEdgeEndpoints<TEndpoint> {
  readonly source: TEndpoint;
  readonly target: TEndpoint;
}

export interface LayoutEdgeRequest {
  readonly id: string;
  /** Original relation direction; it must survive any layout reorientation. */
  readonly semantic: LayoutEdgeEndpoints<LayoutSemanticEndpoint>;
  /** Direction and ports used solely for layout and routing. */
  readonly layout: LayoutEdgeEndpoints<LayoutEngineEndpoint>;
}

export interface LayoutRequestOptions {
  readonly direction: 'right' | 'down' | 'left' | 'up';
  readonly routing: 'orthogonal';
  readonly padding: number;
  readonly componentSpacing: number;
  readonly nodeSpacing: number;
  readonly layerSpacing: number;
}

export interface LayoutRequest {
  readonly requestId: number;
  readonly nodes: readonly LayoutNodeRequest[];
  readonly edges: readonly LayoutEdgeRequest[];
  readonly options: LayoutRequestOptions;
}

export interface LayoutPortPlacement extends LayoutSize {
  readonly id: string;
  /** Absolute position in layout coordinates. */
  readonly position: LayoutPoint;
  readonly side: LayoutPortSide;
}

export interface LayoutNodePlacement extends LayoutSize {
  readonly id: string;
  readonly position: LayoutPoint;
  readonly ports: readonly LayoutPortPlacement[];
}

/**
 * A routed edge may contain multiple sections (for example, when an engine
 * represents a split route). Junction points are metadata and are not assumed
 * to be ordered along the section's main polyline.
 */
export interface LayoutEdgeSection {
  readonly id?: string;
  readonly startPoint: LayoutPoint;
  readonly endPoint: LayoutPoint;
  readonly bendPoints?: readonly LayoutPoint[];
  readonly junctionPoints?: readonly LayoutPoint[];
}

export interface LayoutEdgeRoute extends LayoutEdgeRequest {
  readonly sections: readonly LayoutEdgeSection[];
}

export interface LayoutDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly edgeId?: string;
}

export interface LayoutResult {
  readonly requestId: number;
  readonly engine: 'elk' | 'fallback';
  readonly nodes: readonly LayoutNodePlacement[];
  readonly edges: readonly LayoutEdgeRoute[];
  readonly bounds: LayoutBounds;
  readonly diagnostics: readonly LayoutDiagnostic[];
}

export function isFiniteLayoutPoint(value: unknown): value is LayoutPoint {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['x'] === 'number' &&
    Number.isFinite(candidate['x']) &&
    typeof candidate['y'] === 'number' &&
    Number.isFinite(candidate['y'])
  );
}
