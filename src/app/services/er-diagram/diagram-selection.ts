import { DiagramEdge, DiagramNode } from './er-diagram.interface';

export type DiagramSelection =
  | { kind: 'node'; nodeId: string }
  | { kind: 'column'; nodeId: string; columnId: string }
  | { kind: 'edge'; edgeId: string }
  | null;

export function edgeMatchesSelection(
  edge: DiagramEdge,
  selection: DiagramSelection,
): boolean {
  if (!selection) return true;
  if (selection.kind === 'edge') return edge.id === selection.edgeId;
  if (selection.kind === 'node') {
    return (
      edge.fromNode === selection.nodeId || edge.toNode === selection.nodeId
    );
  }

  return (
    (edge.fromNode === selection.nodeId &&
      edge.fromColumnId === selection.columnId) ||
    (edge.toNode === selection.nodeId && edge.toColumnId === selection.columnId)
  );
}

export function nodeMatchesSelection(
  node: DiagramNode,
  edges: DiagramEdge[],
  selection: DiagramSelection,
): boolean {
  if (!selection) return true;
  if (selection.kind === 'edge') {
    const edge = edges.find((candidate) => candidate.id === selection.edgeId);
    return !!edge && (edge.fromNode === node.id || edge.toNode === node.id);
  }

  if (node.id === selection.nodeId) return true;
  return edges.some(
    (edge) =>
      edgeMatchesSelection(edge, selection) &&
      (edge.fromNode === node.id || edge.toNode === node.id),
  );
}

export function columnMatchesSelection(
  nodeId: string,
  columnId: string,
  selection: DiagramSelection,
): boolean {
  return (
    selection?.kind === 'column' &&
    selection.nodeId === nodeId &&
    selection.columnId === columnId
  );
}
