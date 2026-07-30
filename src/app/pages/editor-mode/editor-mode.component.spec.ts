import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';

import { DiagnosticsPanelComponent } from '../../shared/components/diagnostics-panel/diagnostics-panel.component';
import { DbmlStateService } from '../../services/dbml-state/dbml-state.service';
import { EditorModeComponent } from './editor-mode.component';

const REPAIRABLE_DBML = `Table customers {
  customer_uuid uuid [pk]
}

Table orders {
  customer_id uuid [ref: > customers.id]
}`;

describe('EditorModeComponent diagnostics integration', () => {
  let fixture: ComponentFixture<EditorModeComponent>;
  let state: DbmlStateService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [EditorModeComponent] });
    state = TestBed.inject(DbmlStateService);
    fixture = TestBed.createComponent(EditorModeComponent);
  });

  it('uses the shared pending and validation lifecycle without hiding files', () => {
    state.dbmlContent.set(REPAIRABLE_DBML);
    state.handleConvert();
    fixture.detectChanges();
    const validatedFiles = state.files();
    const item = state
      .diagnosticsState()
      .items.find((candidate) => candidate.diagnostic.repairs?.length);
    const repair = item?.diagnostic.repairs?.[0];
    expect(item).toBeDefined();
    expect(repair).toBeDefined();

    const panel = fixture.debugElement.query(
      By.directive(DiagnosticsPanelComponent),
    ).componentInstance as DiagnosticsPanelComponent;
    panel.repair.emit({
      diagnosticId: item!.id,
      diagnostic: item!.diagnostic,
      repair: repair!,
    });
    fixture.detectChanges();

    expect(state.conversionFreshness()).toBe('pending-validation');
    expect(state.files()).toEqual(validatedFiles);
    expect(state.diagnosticsState().repairActivity?.status).toBe(
      'pending-validation',
    );

    panel.validate.emit();
    fixture.detectChanges();

    expect(state.conversionFreshness()).toBe('current');
    expect(state.diagnosticsState().repairActivity?.status).toBe('resolved');
  });
});
