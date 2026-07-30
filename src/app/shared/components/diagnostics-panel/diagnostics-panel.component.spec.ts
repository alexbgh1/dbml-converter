import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DiagnosticsPanelComponent } from './diagnostics-panel.component';
import {
  Diagnostic,
  DiagnosticRepair,
  DiagnosticRepairRequest,
  DiagnosticsViewState,
} from '../../../services/dbml-parser/interfaces/diagnostics.interface';
import { DIAGNOSTIC_CODES } from '../../../services/dbml-parser/constants/diagnostic-codes.constants';

function diagnostic(partial: Partial<Diagnostic>): Diagnostic {
  return {
    code: DIAGNOSTIC_CODES.PARSE_UNRECOGNIZED_LINE,
    severity: 'warning',
    phase: 'parse',
    message: 'a message',
    ...partial,
  };
}

describe('DiagnosticsPanelComponent', () => {
  let fixture: ComponentFixture<DiagnosticsPanelComponent>;
  let component: DiagnosticsPanelComponent;

  function setDiagnostics(
    diagnostics: Diagnostic[],
    partial: Partial<DiagnosticsViewState> = {},
  ): void {
    fixture.componentRef.setInput('state', {
      freshness: 'current',
      items: diagnostics.map((item, index) => ({
        id: `diagnostic-${index}`,
        diagnostic: item,
      })),
      repairActivity: null,
      repairFailure: null,
      canUndo: false,
      ...partial,
    } satisfies DiagnosticsViewState);
    fixture.detectChanges();
  }

  function text(): string {
    return fixture.nativeElement.textContent;
  }

  function buttonWithLabel(label: string): HTMLButtonElement {
    const button = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((candidate) => candidate.getAttribute('aria-label') === label);
    if (!button) throw new Error(`Button ${label} was not rendered`);
    return button;
  }

  function buttonNamed(name: string): HTMLButtonElement {
    const button = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((candidate) => candidate.textContent?.trim() === name);
    if (!button) throw new Error(`Button ${name} was not rendered`);
    return button;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(DiagnosticsPanelComponent);
    component = fixture.componentInstance;
  });

  it('shows error and warning counts in the badge', () => {
    setDiagnostics([
      diagnostic({ severity: 'error', message: 'boom' }),
      diagnostic({ severity: 'warning' }),
      diagnostic({ severity: 'warning' }),
    ]);

    expect(text()).toContain('1 error');
    expect(text()).toContain('2 warnings');
  });

  it('shows "No problems detected." when only info diagnostics exist', () => {
    setDiagnostics([diagnostic({ severity: 'info' })]);

    expect(text()).toContain('No problems detected.');
    expect(text()).toContain('show 1 info');
  });

  it('keeps compact rows stable with info and repair controls', () => {
    setDiagnostics([
      diagnostic({
        severity: 'error',
        code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
        message: 'the error message',
        line: 7,
      }),
      diagnostic({
        severity: 'warning',
        code: DIAGNOSTIC_CODES.PARSE_UNKNOWN_ATTRIBUTE,
      }),
    ]);
    component.toggleExpanded();
    fixture.detectChanges();

    expect(text()).toContain('SCHEMA_UNKNOWN_REFERENCE_COLUMN');
    expect(text()).not.toContain('the error message');

    const rows = fixture.nativeElement.querySelectorAll('#diagnostics-list li');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelectorAll('button')).toHaveLength(2);
    }
    expect(
      buttonWithLabel('No repair available for PARSE_UNKNOWN_ATTRIBUTE')
        .disabled,
    ).toBe(true);
  });

  it('shows complete diagnostic details in a modal and navigates from it', () => {
    const item = diagnostic({
      severity: 'error',
      code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
      phase: 'schema-validation',
      target: 'prisma',
      message: 'unknown reference column',
      suggestion: 'Reference customers.customer_uuid.',
      line: 7,
      schemaPath: 'tables.orders.columns.customer_id',
    });
    setDiagnostics([item]);
    component.toggleExpanded();
    fixture.detectChanges();
    const lines: number[] = [];
    component.navigate.subscribe((line) => lines.push(line));

    buttonWithLabel('View details for SCHEMA_UNKNOWN_REFERENCE_COLUMN').click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[role="dialog"]'),
    ).not.toBeNull();
    expect(text()).toContain('unknown reference column');
    expect(text()).toContain('Reference customers.customer_uuid.');
    expect(text()).toContain('schema-validation');
    expect(text()).toContain('prisma');
    expect(text()).toContain('tables.orders.columns.customer_id');

    buttonNamed('Go to line 7').click();
    expect(lines).toEqual([7]);
    expect(component.detailItem()).toBeNull();
  });

  it('hides info diagnostics until toggled', () => {
    setDiagnostics([
      diagnostic({
        severity: 'error',
        code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_TABLE,
      }),
      diagnostic({
        severity: 'info',
        code: DIAGNOSTIC_CODES.SCHEMA_FK_COLUMN_CREATED,
      }),
    ]);
    component.toggleExpanded();
    fixture.detectChanges();

    expect(text()).toContain('SCHEMA_UNKNOWN_REFERENCE_TABLE');
    expect(text()).not.toContain('SCHEMA_FK_COLUMN_CREATED');

    component.showInfo.set(true);
    fixture.detectChanges();
    expect(text()).toContain('SCHEMA_FK_COLUMN_CREATED');
  });

  it('exposes expansion and info state through native controls', () => {
    setDiagnostics([diagnostic({ severity: 'info', message: 'details' })]);

    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');

    buttons[0].click();
    buttons[1].click();
    fixture.detectChanges();

    expect(buttons[0].getAttribute('aria-expanded')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('asks for confirmation before emitting a structured repair', () => {
    const repair: DiagnosticRepair = {
      kind: 'replace-reference-target',
      label: 'Reference customers.customer_uuid',
      line: 4,
      expectedText: 'customers.id',
      replacementText: 'customers.customer_uuid',
    };
    setDiagnostics([
      diagnostic({
        severity: 'error',
        code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
        line: 4,
        repairs: [repair],
      }),
    ]);
    component.toggleExpanded();
    fixture.detectChanges();
    const repairs: DiagnosticRepairRequest[] = [];
    component.repair.subscribe((value) => repairs.push(value));

    buttonWithLabel('Repair SCHEMA_UNKNOWN_REFERENCE_COLUMN').click();
    fixture.detectChanges();

    expect(repairs).toEqual([]);
    expect(text()).toContain('customers.id');
    expect(text()).toContain('customers.customer_uuid');

    buttonNamed('Apply repair').click();
    expect(repairs).toEqual([
      {
        diagnosticId: 'diagnostic-0',
        diagnostic: expect.objectContaining({
          code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
        }),
        repair,
      },
    ]);
    expect(component.repairItem()).toBeNull();
  });

  it('keeps validated diagnostics visible and disables repairs while outdated', () => {
    const repair: DiagnosticRepair = {
      kind: 'replace-reference-target',
      label: 'Repair reference',
      line: 4,
      expectedText: 'customers.id',
      replacementText: 'customers.customer_uuid',
    };
    setDiagnostics(
      [
        diagnostic({
          severity: 'error',
          code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
          repairs: [repair],
        }),
      ],
      { freshness: 'pending-validation' },
    );
    component.toggleExpanded();
    fixture.detectChanges();

    expect(text()).toContain('Outdated');
    expect(text()).toContain('SCHEMA_UNKNOWN_REFERENCE_COLUMN');
    expect(
      buttonWithLabel('Repair SCHEMA_UNKNOWN_REFERENCE_COLUMN').disabled,
    ).toBe(true);
  });

  it('renders pending repair activity with shared Undo and validation actions', () => {
    const item = diagnostic({
      severity: 'error',
      code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
    });
    const repair: DiagnosticRepair = {
      kind: 'replace-reference-target',
      label: 'Repair reference',
      line: 4,
      expectedText: 'customers.id',
      replacementText: 'customers.customer_uuid',
    };
    setDiagnostics([item], {
      freshness: 'pending-validation',
      canUndo: true,
      repairActivity: {
        diagnosticId: 'diagnostic-0',
        affectedDiagnosticIds: ['diagnostic-0'],
        diagnostic: item,
        repair,
        before: 'before',
        after: 'after',
        status: 'pending-validation',
        resolvedDiagnosticCount: 0,
      },
    });
    const events: string[] = [];
    component.undo.subscribe(() => events.push('undo'));
    component.validate.subscribe(() => events.push('validate'));
    fixture.detectChanges();

    expect(text()).toContain('Pending validation');
    expect(text()).toContain('customers.customer_uuid');
    buttonNamed('Undo').click();
    buttonNamed('Convert to validate').click();
    expect(events).toEqual(['undo', 'validate']);
  });
});
