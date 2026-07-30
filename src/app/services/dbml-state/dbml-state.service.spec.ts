import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DbmlStateService } from './dbml-state.service';
import { DbmlParserService } from '../dbml-parser/dbml-parser';
import { DIAGNOSTIC_CODES } from '../dbml-parser/constants/diagnostic-codes.constants';
import { DiagnosticRepairRequest } from '../dbml-parser/interfaces/diagnostics.interface';

const TYPE_MISMATCH_DBML = `
Table users {
  id uuid [pk]
}
Table orders {
  id int [pk]
  user_id int [ref: > users.id]
}
`;

const RESERVED_NAME_DBML = `
Table string {
  id int [pk]
}
`;

describe('DbmlStateService', () => {
  let service: DbmlStateService;
  let parser: DbmlParserService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(DbmlStateService);
    parser = TestBed.inject(DbmlParserService);
    service.selectedOutputType.set('json');
  });

  function parse(dbml: string): void {
    parser.setDbmlContent(dbml);
    TestBed.flushEffects();
  }

  function convert(dbml: string): void {
    service.dbmlContent.set(dbml);
    // Synchronous: parsing derives from a computed, no timer (T22)
    service.handleConvert();
    TestBed.flushEffects();
  }

  function repairRequest(code: string): DiagnosticRepairRequest {
    const item = service
      .diagnosticsState()
      .items.find((candidate) => candidate.diagnostic.code === code);
    const repair = item?.diagnostic.repairs?.[0];
    if (!item || !repair) throw new Error(`No repair found for ${code}`);
    return {
      diagnosticId: item.id,
      diagnostic: item.diagnostic,
      repair,
    };
  }

  describe('allDiagnostics severity escalation', () => {
    it('keeps type mismatches as warnings for the JSON output', () => {
      parse(TYPE_MISMATCH_DBML);
      service.selectedOutputType.set('json');

      const mismatch = service
        .allDiagnostics()
        .find(
          (d) => d.code === DIAGNOSTIC_CODES.SCHEMA_REFERENCE_TYPE_MISMATCH,
        );
      expect(mismatch?.severity).toBe('warning');
    });

    it('escalates type mismatches to errors for ORM outputs', () => {
      parse(TYPE_MISMATCH_DBML);

      for (const target of ['prisma', 'typeorm'] as const) {
        service.selectedOutputType.set(target);
        const mismatch = service
          .allDiagnostics()
          .find(
            (d) => d.code === DIAGNOSTIC_CODES.SCHEMA_REFERENCE_TYPE_MISMATCH,
          );
        expect(mismatch?.severity).toBe('error');
      }
    });
  });

  describe('allDiagnostics target filtering', () => {
    it('includes generator diagnostics only for the selected target', () => {
      parse(RESERVED_NAME_DBML);

      service.selectedOutputType.set('prisma');
      expect(
        service
          .allDiagnostics()
          .some((d) => d.code === DIAGNOSTIC_CODES.PRISMA_RESERVED_NAME),
      ).toBe(true);

      for (const target of ['json', 'typeorm'] as const) {
        service.selectedOutputType.set(target);
        expect(
          service
            .allDiagnostics()
            .some((d) => d.code === DIAGNOSTIC_CODES.PRISMA_RESERVED_NAME),
        ).toBe(false);
      }
    });
  });

  describe('Convert gating and instant output switching', () => {
    const dbml = `
Table users {
  id int [pk]
}
`;

    it('exposes no files or diagnostics before Convert', () => {
      service.dbmlContent.set(dbml);
      TestBed.flushEffects();

      expect(service.files()).toEqual([]);
      expect(service.diagnosticsSnapshot()).toEqual([]);
      expect(service.conversionFreshness()).toBe('not-converted');
    });

    it('switches output formats after one Convert without converting again', () => {
      convert(dbml);

      expect(service.files().map((f) => f.filename)).toEqual(['schema.json']);

      service.setOutputType('prisma');
      TestBed.flushEffects();
      expect(service.files().map((f) => f.filename)).toEqual(['schema.prisma']);

      service.setOutputType('typeorm');
      TestBed.flushEffects();
      expect(service.files().map((f) => f.filename)).toEqual([
        'users.entity.ts',
        'database.module.ts',
      ]);
    });

    it('keeps enum source-location metadata out of the JSON output', () => {
      convert(`
        Enum status {
          active
        }
        Table users {
          status status
        }
      `);

      const content = service.files()[0].content;
      expect(content).not.toContain('sourceLine');
      expect(content).not.toContain('valueSourceLines');
      expect(content).toContain('"values": [');
    });

    it('remaps the selected file when the output type changes', () => {
      convert(dbml);

      service.selectedFile.set(service.files()[0]); // schema.json
      service.setOutputType('prisma');
      TestBed.flushEffects();

      expect(service.selectedFile()?.filename).toBe('schema.prisma');
    });

    it('keeps the DBML input (null) selected across output switches', () => {
      convert(dbml);

      service.selectedFile.set(null);
      service.setOutputType('typeorm');
      TestBed.flushEffects();

      expect(service.selectedFile()).toBeNull();
    });

    it('retains the last generated files and diagnostics while source is outdated', () => {
      convert(dbml);
      const validatedFiles = service.files();
      const validatedIds = service
        .diagnosticsState()
        .items.map((item) => item.id);

      service.onDbmlInput(`${dbml}\nTable posts { id int [pk] }`);

      expect(service.conversionFreshness()).toBe('pending-validation');
      expect(service.files()).toEqual(validatedFiles);
      expect(service.diagnosticsState().items.map((item) => item.id)).toEqual(
        validatedIds,
      );

      service.handleConvert();
      expect(service.conversionFreshness()).toBe('current');
      expect(service.files()[0].content).toContain('posts');
    });

    it('keeps schema diagnostic identity stable across target severity changes', () => {
      convert(TYPE_MISMATCH_DBML);
      const jsonItem = service
        .diagnosticsState()
        .items.find(
          (item) =>
            item.diagnostic.code ===
            DIAGNOSTIC_CODES.SCHEMA_REFERENCE_TYPE_MISMATCH,
        );

      service.setOutputType('prisma');
      const prismaItem = service
        .diagnosticsState()
        .items.find(
          (item) =>
            item.diagnostic.code ===
            DIAGNOSTIC_CODES.SCHEMA_REFERENCE_TYPE_MISMATCH,
        );

      expect(prismaItem?.id).toBe(jsonItem?.id);
      expect(jsonItem?.diagnostic.severity).toBe('warning');
      expect(prismaItem?.diagnostic.severity).toBe('error');
    });

    it('clearAll hides files and diagnostics again', () => {
      convert(dbml);
      expect(service.files().length).toBeGreaterThan(0);

      service.clearAll();
      TestBed.flushEffects();

      expect(service.files()).toEqual([]);
      expect(service.diagnosticsSnapshot()).toEqual([]);
      expect(service.conversionFreshness()).toBe('not-converted');
    });
  });

  describe('Diagnostic repairs', () => {
    const dbml = [
      'Table customers {',
      '  customer_uuid uuid [pk]',
      '}',
      'Table orders {',
      '  customer_id uuid [ref: > customers.id, not null]',
      '}',
    ].join('\n');

    it('applies a guarded reference repair and preserves surrounding attributes', () => {
      convert(dbml);
      const request = repairRequest(
        DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
      );

      const result = service.applyDiagnosticRepair(request);

      expect(result.reason).toBe('applied');
      expect(service.dbmlContent()).toContain(
        'customer_id uuid [ref: > customers.customer_uuid, not null]',
      );
      expect(service.files().length).toBeGreaterThan(0);
      expect(service.diagnosticsSnapshot().length).toBeGreaterThan(0);
      expect(service.conversionFreshness()).toBe('pending-validation');
      expect(service.diagnosticsState().repairActivity?.status).toBe(
        'pending-validation',
      );
      expect(service.canUndoRepair()).toBe(true);
    });

    it('rejects a repair from an outdated conversion without changing source', () => {
      convert(dbml);
      const request = repairRequest(
        DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
      );
      service.onDbmlInput(dbml.replace('customers.id', 'customers.legacy_id'));
      const changed = service.dbmlContent();

      const result = service.applyDiagnosticRepair(request);

      expect(result.reason).toBe('conversion-stale');
      expect(service.dbmlContent()).toBe(changed);
      expect(service.diagnosticsState().repairFailure).toEqual(result);
    });

    it('undoes only the latest unchanged repair', () => {
      convert(dbml);
      const request = repairRequest(
        DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
      );
      service.applyDiagnosticRepair(request);

      expect(service.undoLastRepair()).toBe(true);
      expect(service.dbmlContent()).toBe(dbml);
      expect(service.undoLastRepair()).toBe(false);
    });

    it('offers a guarded FK type repair', () => {
      convert(`
        Table users {
          id uuid [pk]
        }
        Table orders {
          user_id int [ref: > users.id]
        }
      `);
      const request = repairRequest(
        DIAGNOSTIC_CODES.SCHEMA_REFERENCE_TYPE_MISMATCH,
      );

      expect(request.repair.kind).toBe('change-column-type');
      expect(service.applyDiagnosticRepair(request).applied).toBe(true);
      expect(service.dbmlContent()).toContain('user_id uuid [ref: > users.id]');
    });

    it('reconciles a repair as resolved after Convert', () => {
      convert(dbml);
      service.applyDiagnosticRepair(
        repairRequest(DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN),
      );

      service.handleConvert();

      expect(service.conversionFreshness()).toBe('current');
      expect(service.diagnosticsState().repairActivity?.status).toBe(
        'resolved',
      );
      expect(
        service
          .diagnosticsSnapshot()
          .some(
            (item) =>
              item.code === DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
          ),
      ).toBe(false);
    });

    it('does not allow another repair until the pending edit is validated or undone', () => {
      convert(dbml);
      const request = repairRequest(
        DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
      );
      service.applyDiagnosticRepair(request);

      const result = service.applyDiagnosticRepair(request);

      expect(result.reason).toBe('pending-repair');
      expect(service.diagnosticsState().repairActivity?.status).toBe(
        'pending-validation',
      );
    });

    it('keeps pending activity but disables Undo after unrelated manual edits', () => {
      convert(dbml);
      service.applyDiagnosticRepair(
        repairRequest(DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN),
      );

      service.onDbmlInput(`${service.dbmlContent()}\n// manual edit`);

      expect(service.diagnosticsState().repairActivity?.status).toBe(
        'pending-validation',
      );
      expect(service.canUndoRepair()).toBe(false);
      expect(service.undoLastRepair()).toBe(false);
    });

    it('restores current freshness when Undo returns to the validated source', () => {
      convert(dbml);
      service.applyDiagnosticRepair(
        repairRequest(DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN),
      );

      expect(service.undoLastRepair()).toBe(true);
      expect(service.conversionFreshness()).toBe('current');
      expect(service.diagnosticsState().repairActivity).toBeNull();
    });
  });

  describe('DBML import', () => {
    it('replaces source while retaining the previous output as outdated', () => {
      convert('Table old_table {\n  id int [pk]\n}');
      const previousFiles = service.files();

      service.importDbml('Table imported {\n  id uuid [pk]\n}');

      expect(service.dbmlContent()).toContain('Table imported');
      expect(service.files()).toEqual(previousFiles);
      expect(service.conversionFreshness()).toBe('pending-validation');
    });
  });
});
