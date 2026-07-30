import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreviewModeComponent } from './preview-mode.component';
import { DbmlStateService } from '../../services/dbml-state/dbml-state.service';
import { DiagnosticsPanelComponent } from '../../shared/components/diagnostics-panel/diagnostics-panel.component';

const REPAIRABLE_DBML = `Table customers {
  customer_uuid uuid [pk]
}

Table orders {
  customer_id uuid [ref: > customers.id]
}`;

describe('PreviewModeComponent', () => {
  let fixture: ComponentFixture<PreviewModeComponent>;
  let state: DbmlStateService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [PreviewModeComponent] });
    state = TestBed.inject(DbmlStateService);
    fixture = TestBed.createComponent(PreviewModeComponent);
  });

  it('does not present an old output after Clear', () => {
    state.dbmlContent.set(REPAIRABLE_DBML);
    state.handleConvert();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain(
      'No converted schema yet.',
    );

    state.clearAll();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'No converted schema yet.',
    );
  });

  it('keeps the last output visible with an outdated state while editing', () => {
    state.dbmlContent.set(REPAIRABLE_DBML);
    state.handleConvert();
    state.onDbmlInput(`${REPAIRABLE_DBML}\nTable extra { id int [pk] }`);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Outdated');
    expect(
      fixture.nativeElement.querySelector('app-code-viewer'),
    ).not.toBeNull();
  });

  it('applies repairs emitted by the diagnostics panel', () => {
    state.dbmlContent.set(REPAIRABLE_DBML);
    state.handleConvert();
    fixture.detectChanges();

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

    expect(state.dbmlContent()).toContain('[ref: > customers.customer_uuid]');
    expect(state.diagnosticsState().repairActivity?.status).toBe(
      'pending-validation',
    );
  });
});
