import { DatabaseSchema } from './dbml-parser.interface';
import { DiagnosticCode } from '../constants/diagnostic-codes.constants';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticPhase =
  | 'parse' // source text could not be fully understood, or was completed
  | 'schema-validation' // parsed model is internally inconsistent
  | 'output-validation'; // model cannot be emitted safely for a target

export type DiagnosticTarget = 'json' | 'prisma' | 'typeorm';

export type DiagnosticRepairKind =
  | 'replace-reference-target'
  | 'change-column-type';

/** A guarded, single-line source edit. Human-readable suggestions are never parsed into edits. */
export interface DiagnosticRepair {
  kind: DiagnosticRepairKind;
  label: string;
  line: number;
  expectedText: string;
  replacementText: string;
}

export interface Diagnostic {
  /** Stable identifier suitable for tests and UI filtering. */
  code: DiagnosticCode;

  /** Base severity; the UI may escalate per selected target (see DbmlStateService). */
  severity: DiagnosticSeverity;
  phase: DiagnosticPhase;
  message: string;

  /** Omitted when the problem applies to every output. */
  target?: DiagnosticTarget;

  /** 1-based line in the original DBML, when known. Line-only by design. */
  line?: number;

  /** Logical location in the intermediate schema, e.g. "tables.orders.columns.customer_id". */
  schemaPath?: string;

  suggestion?: string;
  repairs?: DiagnosticRepair[];
  details?: Record<string, unknown>;
}

export interface RepairApplyResult {
  applied: boolean;
  reason:
    | 'applied'
    | 'stale'
    | 'invalid-line'
    | 'pending-repair'
    | 'conversion-stale';
  message: string;
}

export type ConversionFreshness =
  | 'not-converted'
  | 'current'
  | 'pending-validation';

export type DiagnosticRepairLifecycleStatus =
  | 'pending-validation'
  | 'resolved'
  | 'still-present';

export interface DiagnosticViewItem {
  /** Stable within validated snapshots; independent from message text and line when schemaPath exists. */
  id: string;
  diagnostic: Diagnostic;
}

export interface DiagnosticRepairRequest {
  diagnosticId: string;
  diagnostic: Diagnostic;
  repair: DiagnosticRepair;
}

export interface DiagnosticRepairActivity {
  diagnosticId: string;
  affectedDiagnosticIds: string[];
  diagnostic: Diagnostic;
  repair: DiagnosticRepair;
  before: string;
  after: string;
  status: DiagnosticRepairLifecycleStatus;
  resolvedDiagnosticCount: number;
}

export interface DiagnosticsViewState {
  freshness: ConversionFreshness;
  items: DiagnosticViewItem[];
  repairActivity: DiagnosticRepairActivity | null;
  repairFailure: RepairApplyResult | null;
  canUndo: boolean;
}

export interface ParseResult {
  /** Partial schema is returned even when diagnostics contain errors. */
  schema: DatabaseSchema;
  diagnostics: Diagnostic[];
}
