import {
  Injectable,
  signal,
  inject,
  effect,
  untracked,
  WritableSignal,
  computed,
} from '@angular/core';

import { DbmlParserService } from '../dbml-parser/dbml-parser';
import { NestjsGeneratorService } from '../output-generators/nestjs-generator/nestjs-generator.service';
import { PrismaGeneratorService } from '../output-generators/prisma-generator/prisma-generator.service';

import {
  OUTPUT_OPTIONS_MAP,
  OUTPUT_TYPES,
} from '../../components/dbml-converter/constants/dbml-converter.constants';
import {
  DATABASE_FILE,
  INPUT,
  JSON_FILE,
  OUTPUT,
  PRISMA_SCHEMA_FILE,
} from '../../components/dbml-converter/constants/dbml-in-out.constants';

import { OutputOption } from '../../components/dbml-converter/interfaces/dbml-converter.interface';
import { EditorFile } from '../../components/dbml-converter/interfaces/editor.interface';

import { formatJson } from '../../components/dbml-converter/helpers';
import { STORAGE_KEYS } from './constants/local-storage.constants';
import {
  ConversionFreshness,
  Diagnostic,
  DiagnosticRepairActivity,
  DiagnosticRepairRequest,
  DiagnosticSeverity,
  DiagnosticsViewState,
  DiagnosticViewItem,
  RepairApplyResult,
} from '../dbml-parser/interfaces/diagnostics.interface';
import { DIAGNOSTIC_CODES } from '../dbml-parser/constants/diagnostic-codes.constants';

@Injectable({ providedIn: 'root' })
export class DbmlStateService {
  private dbmlParserService = inject(DbmlParserService);
  private nestjsGeneratorService = inject(NestjsGeneratorService);
  private prismaGeneratorService = inject(PrismaGeneratorService);

  constructor() {
    /* Save DBML content and output type to localStorage on changes */
    effect(() => {
      const content = this.dbmlContent();
      this.saveToStorage(STORAGE_KEYS.DBML_CONTENT, content);
    });

    effect(() => {
      const outputType = this.selectedOutputType();
      this.saveToStorage(STORAGE_KEYS.OUTPUT_TYPE, outputType);
    });

    /*
      Keep selectedFile valid when `files` recomputes (output-type switch):
      same id -> refresh the reference (content may have changed);
      gone -> select the first file of the new set; null (DBML input) stays.
    */
    effect(() => {
      const files = this.files();
      const selected = untracked(this.selectedFile);
      if (!selected) return;

      const match = files.find((file) => file.id === selected.id);
      if (match) {
        if (match !== selected) this.selectedFile.set(match);
      } else {
        this.selectedFile.set(files[0] ?? null);
      }
    });
  }

  // Shared state across routes
  dbmlContent: WritableSignal<string> = signal<string>(
    this.loadFromStorage(STORAGE_KEYS.DBML_CONTENT) || '',
  );

  selectedOutputType: WritableSignal<OutputOption> = signal<OutputOption>(
    this.loadOutputTypeFromStorage() || OUTPUT_OPTIONS_MAP.json,
  );
  isConverting: WritableSignal<boolean> = signal<boolean>(false);

  /* The source used by the most recent explicit Convert. */
  private lastConvertedDbml = signal<string | null>(null);
  readonly hasConvertedOutput = computed(
    () => this.lastConvertedDbml() !== null,
  );
  readonly conversionFreshness = computed<ConversionFreshness>(() => {
    const convertedSource = this.lastConvertedDbml();
    if (convertedSource === null) return 'not-converted';

    return this.dbmlContent() === convertedSource
      ? 'current'
      : 'pending-validation';
  });
  private pendingSourceLine = signal<number | null>(null);

  /*
    Output files derive from the parsed schema + selected output type, so
    switching JSON/TypeORM/Prisma after one Convert re-renders instantly.
    The parser only re-parses on Convert, so typing doesn't change them.
  */
  files = computed<EditorFile[]>(() => {
    if (!this.hasConvertedOutput()) return [];
    return this.buildFiles(this.selectedOutputType());
  });

  selectedFile: WritableSignal<EditorFile | null> = signal(null);
  expandedFolders: WritableSignal<Set<string>> = signal(new Set());
  private repairActivity = signal<DiagnosticRepairActivity | null>(null);
  private repairFailure = signal<RepairApplyResult | null>(null);
  canUndoRepair = computed(() => {
    const activity = this.repairActivity();
    return !!activity && this.dbmlContent() === activity.after;
  });

  // Computed states
  schema = this.dbmlParserService.schema;

  nestjsCode = computed(() => {
    const schema = this.schema();
    if (!schema) return null;

    return this.nestjsGeneratorService.generateCode(schema);
  });

  private prismaCode = computed(() => {
    const schema = this.schema();
    if (!schema) return null;

    return this.prismaGeneratorService.generateCode(schema);
  });

  prismaSchema = computed(() => this.prismaCode()?.schema ?? null);

  /*
    Combined, target-aware diagnostics: parser diagnostics plus the output
    diagnostics of the selected target's generator. Severity is escalated at
    display time, so the same diagnostic can render differently per output.
  */
  allDiagnostics = computed<Diagnostic[]>(() => {
    const target = this.selectedOutputType();

    const outputDiagnostics =
      target === OUTPUT_OPTIONS_MAP.prisma
        ? (this.prismaCode()?.diagnostics ?? [])
        : target === OUTPUT_OPTIONS_MAP.typeorm
          ? (this.nestjsCode()?.diagnostics ?? [])
          : [];

    return [...this.dbmlParserService.diagnostics(), ...outputDiagnostics].map(
      (diagnostic) => ({
        ...diagnostic,
        severity: this.displaySeverity(diagnostic, target),
      }),
    );
  });

  /* Stable view items for the most recent explicit conversion. */
  private diagnosticItems = computed<DiagnosticViewItem[]>(() =>
    this.hasConvertedOutput()
      ? this.buildDiagnosticViewItems(this.allDiagnostics())
      : [],
  );

  readonly diagnosticsState = computed<DiagnosticsViewState>(() => ({
    freshness: this.conversionFreshness(),
    items: this.diagnosticItems(),
    repairActivity: this.repairActivity(),
    repairFailure: this.repairFailure(),
    canUndo: this.canUndoRepair(),
  }));

  diagnosticsSnapshot = computed<Diagnostic[]>(() =>
    this.diagnosticItems().map((item) => item.diagnostic),
  );

  private displaySeverity(
    diagnostic: Diagnostic,
    target: OutputOption,
  ): DiagnosticSeverity {
    /*
      A schema that JSON can still represent may be invalid for an ORM,
      e.g. an FK whose type doesn't match its target (see the design doc).
    */
    const escalatesForOrm =
      diagnostic.code === DIAGNOSTIC_CODES.SCHEMA_REFERENCE_TYPE_MISMATCH;
    const isOrmTarget = target === 'prisma' || target === 'typeorm';

    if (escalatesForOrm && isOrmTarget) return 'error';
    return diagnostic.severity;
  }

  // Actions
  /**
   * Change the selected output type
   */
  setOutputType(typeId: string): void {
    const type = Object.values(OUTPUT_TYPES).find(
      (option) => option.id === typeId,
    );

    if (!type) {
      console.warn(`Output type with id "${typeId}" not found`);
      return;
    }
    if (this.selectedOutputType() === typeId) return;

    this.selectedOutputType.set(type.id);
  }

  handleConvert(): void {
    this.repairFailure.set(null);
    this.isConverting.set(true);

    /*
      Parsing is synchronous: the parser's ParseResult is a computed over its
      content signal, so everything below observes the new schema immediately
    */
    this.dbmlParserService.setDbmlContent(this.dbmlContent());

    this.lastConvertedDbml.set(this.dbmlContent());
    this.reconcileRepairActivity();

    // Open folders automatically
    const expandedFolders = new Set(this.expandedFolders());
    expandedFolders.add(INPUT);
    expandedFolders.add(OUTPUT);
    this.expandedFolders.set(expandedFolders);

    this.isConverting.set(false);
  }

  /*
    Build the file tree for one output type from the current parsed schema.
    Called from the `files` computed, so switching the output format after a
    Convert re-renders without pressing Convert again.
  */
  private buildFiles(outputType: OutputOption): EditorFile[] {
    const schema = this.schema();
    const generatedFiles: EditorFile[] = [];

    switch (outputType) {
      case OUTPUT_OPTIONS_MAP.json:
        generatedFiles.push({
          id: JSON_FILE.id,
          filename: JSON_FILE.filename,
          content: formatJson(schema),
        });
        break;

      case OUTPUT_OPTIONS_MAP.typeorm: {
        const nestjsCode = this.nestjsCode();
        if (nestjsCode) {
          // Add entities files (e.g., User.ts, Post.ts, etc.)
          Object.entries(nestjsCode.entities).forEach(([filename, content]) => {
            generatedFiles.push({
              id: `entity-${filename}`,
              filename: filename,
              content,
            });
          });

          // Add module file (e.g., database.module.ts)
          generatedFiles.push({
            id: DATABASE_FILE.id,
            filename: DATABASE_FILE.filename,
            content: nestjsCode.module,
          });
        }
        break;
      }

      case OUTPUT_OPTIONS_MAP.prisma: {
        const prismaSchema = this.prismaSchema();
        if (prismaSchema !== null) {
          generatedFiles.push({
            id: PRISMA_SCHEMA_FILE.id,
            filename: PRISMA_SCHEMA_FILE.filename,
            content: prismaSchema,
          });
        }
        break;
      }
    }

    return generatedFiles;
  }

  clearAll(): void {
    this.dbmlContent.set('');
    this.lastConvertedDbml.set(null);
    this.selectedFile.set(null);
    this.repairActivity.set(null);
    this.repairFailure.set(null);
  }

  importDbml(content: string): void {
    this.replaceDbml(content);
  }

  /** Replace the working source while retaining the last validated output. */
  replaceDbml(content: string): void {
    this.dbmlContent.set(content);
    this.repairActivity.set(null);
    this.repairFailure.set(null);
  }

  requestSourceNavigation(line: number): void {
    this.pendingSourceLine.set(line);
  }

  consumeSourceNavigation(): number | null {
    const line = this.pendingSourceLine();
    this.pendingSourceLine.set(null);
    return line;
  }

  /**
   * Handle DBML input changes/updates
   */
  onDbmlInput(code: string): void {
    this.dbmlContent.set(code);
    this.repairFailure.set(null);

    const activity = this.repairActivity();
    if (!activity) return;

    if (code === this.lastConvertedDbml()) {
      this.repairActivity.set(null);
      return;
    }

    if (activity.status !== 'pending-validation') {
      this.repairActivity.set(null);
    }
  }

  /** Apply one guarded source repair and require an explicit Convert afterwards. */
  applyDiagnosticRepair(request: DiagnosticRepairRequest): RepairApplyResult {
    if (this.repairActivity()?.status === 'pending-validation') {
      return this.setRepairFailure({
        applied: false,
        reason: 'pending-repair',
        message:
          'Validate or undo the pending repair before applying another one.',
      });
    }

    if (this.conversionFreshness() !== 'current') {
      return this.setRepairFailure({
        applied: false,
        reason: 'conversion-stale',
        message:
          'The diagnostics are outdated. Convert again before applying a repair.',
      });
    }

    const currentItem = this.diagnosticItems().find(
      (item) => item.id === request.diagnosticId,
    );
    if (!currentItem) {
      return this.setRepairFailure({
        applied: false,
        reason: 'stale',
        message:
          'This diagnostic is no longer part of the validated result. Convert again to refresh diagnostics.',
      });
    }

    const repair = request.repair;
    const before = this.dbmlContent();
    const newline = before.includes('\r\n') ? '\r\n' : '\n';
    const lines = before.split(/\r?\n/);
    const index = repair.line - 1;

    if (index < 0 || index >= lines.length) {
      return this.setRepairFailure({
        applied: false,
        reason: 'invalid-line',
        message:
          'The repair line no longer exists. Convert again to refresh diagnostics.',
      });
    }

    const sourceLine = lines[index];
    const occurrences = sourceLine.split(repair.expectedText).length - 1;
    if (occurrences !== 1) {
      return this.setRepairFailure({
        applied: false,
        reason: 'stale',
        message:
          'The source changed since this diagnostic was created. Convert again before applying a repair.',
      });
    }

    lines[index] = sourceLine.replace(
      repair.expectedText,
      repair.replacementText,
    );
    const after = lines.join(newline);

    this.dbmlContent.set(after);
    const affectedDiagnosticIds = this.diagnosticItems()
      .filter((item) =>
        item.diagnostic.repairs?.some((candidate) =>
          this.repairsMatch(candidate, repair),
        ),
      )
      .map((item) => item.id);
    this.repairActivity.set({
      diagnosticId: request.diagnosticId,
      affectedDiagnosticIds:
        affectedDiagnosticIds.length > 0
          ? affectedDiagnosticIds
          : [request.diagnosticId],
      diagnostic: currentItem.diagnostic,
      repair,
      before,
      after,
      status: 'pending-validation',
      resolvedDiagnosticCount: 0,
    });
    this.repairFailure.set(null);

    return {
      applied: true,
      reason: 'applied',
      message: `${repair.label} applied. Review the edit, then Convert again.`,
    };
  }

  undoLastRepair(): boolean {
    const activity = this.repairActivity();
    if (!activity || this.dbmlContent() !== activity.after) return false;

    this.dbmlContent.set(activity.before);
    this.repairActivity.set(null);
    this.repairFailure.set(null);
    return true;
  }

  private setRepairFailure(result: RepairApplyResult): RepairApplyResult {
    this.repairFailure.set(result);
    return result;
  }

  private reconcileRepairActivity(): void {
    const activity = this.repairActivity();
    if (!activity || activity.status !== 'pending-validation') return;

    const currentIds = new Set(
      this.buildDiagnosticViewItems(this.allDiagnostics()).map(
        (item) => item.id,
      ),
    );
    const remainingIds = activity.affectedDiagnosticIds.filter((id) =>
      currentIds.has(id),
    );

    this.repairActivity.set({
      ...activity,
      status: currentIds.has(activity.diagnosticId)
        ? 'still-present'
        : 'resolved',
      resolvedDiagnosticCount:
        activity.affectedDiagnosticIds.length - remainingIds.length,
    });
  }

  private buildDiagnosticViewItems(
    diagnostics: Diagnostic[],
  ): DiagnosticViewItem[] {
    const occurrenceByIdentity = new Map<string, number>();

    return diagnostics.map((diagnostic) => {
      const location =
        diagnostic.schemaPath ?? `line:${diagnostic.line ?? 'global'}`;
      const identity = JSON.stringify([
        diagnostic.code,
        diagnostic.phase,
        diagnostic.target ?? '',
        location,
      ]);
      const occurrence = occurrenceByIdentity.get(identity) ?? 0;
      occurrenceByIdentity.set(identity, occurrence + 1);

      return {
        id: `${identity}#${occurrence}`,
        diagnostic,
      };
    });
  }

  private repairsMatch(
    left: DiagnosticRepairActivity['repair'],
    right: DiagnosticRepairActivity['repair'],
  ): boolean {
    return (
      left.kind === right.kind &&
      left.line === right.line &&
      left.expectedText === right.expectedText &&
      left.replacementText === right.replacementText
    );
  }

  private saveToStorage(key: string, value: any): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }

  private loadFromStorage(key: string): string | null {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      console.error('Error loading from localStorage:', error);
      return null;
    }
  }

  private loadOutputTypeFromStorage(): OutputOption | null {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.OUTPUT_TYPE);
      if (!saved) return null;

      const outputTypeId = JSON.parse(saved) as OutputOption;

      // ✅ Validar que existe en OUTPUT_OPTIONS
      return Object.values(OUTPUT_OPTIONS_MAP).includes(outputTypeId)
        ? outputTypeId
        : null;
    } catch (error) {
      console.error('Error loading output type from localStorage:', error);
      return null;
    }
  }
}
