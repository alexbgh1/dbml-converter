import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

import {
  DiagnosticRepair,
  DiagnosticRepairRequest,
  DiagnosticsViewState,
  DiagnosticViewItem,
} from '../../../services/dbml-parser/interfaces/diagnostics.interface';
import { ActionDialogComponent } from '../action-dialog/action-dialog.component';
import {
  ChevronDownIconComponent,
  ChevronRightIconComponent,
  InfoIconComponent,
  WrenchIconComponent,
} from '../icons';

/*
  Presentational diagnostics panel: a badge with error/warning counts and an
  expandable list grouped by severity. Info diagnostics are hidden behind a
  toggle. Clicking an entry with a source line emits (navigate) so the parent
  can move the DBML editor to it.
*/
@Component({
  selector: 'app-diagnostics-panel',
  imports: [
    ActionDialogComponent,
    ChevronDownIconComponent,
    ChevronRightIconComponent,
    InfoIconComponent,
    WrenchIconComponent,
  ],
  templateUrl: './diagnostics-panel.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class DiagnosticsPanelComponent {
  state = input.required<DiagnosticsViewState>();
  navigate = output<number>();
  repair = output<DiagnosticRepairRequest>();
  undo = output<void>();
  validate = output<void>();

  expanded = signal(false);
  showInfo = signal(false);
  detailItem = signal<DiagnosticViewItem | null>(null);
  repairItem = signal<DiagnosticViewItem | null>(null);
  selectedRepair = signal<DiagnosticRepair | null>(null);

  errors = computed(() =>
    this.state().items.filter((item) => item.diagnostic.severity === 'error'),
  );
  warnings = computed(() =>
    this.state().items.filter((item) => item.diagnostic.severity === 'warning'),
  );
  infos = computed(() =>
    this.state().items.filter((item) => item.diagnostic.severity === 'info'),
  );

  hasProblems = computed(
    () => this.errors().length > 0 || this.warnings().length > 0,
  );

  visibleGroups = computed(() => {
    const groups = [
      { label: 'Errors', kind: 'error', items: this.errors() },
      { label: 'Warnings', kind: 'warning', items: this.warnings() },
    ];
    if (this.showInfo()) {
      groups.push({ label: 'Info', kind: 'info', items: this.infos() });
    }
    return groups.filter((group) => group.items.length > 0);
  });

  toggleExpanded(): void {
    this.expanded.set(!this.expanded());
  }

  toggleInfo(): void {
    this.showInfo.set(!this.showInfo());
  }

  onSelect(item: DiagnosticViewItem): void {
    const diagnostic = item.diagnostic;
    if (diagnostic.line !== undefined) {
      this.navigate.emit(diagnostic.line);
    }
  }

  openDetails(item: DiagnosticViewItem): void {
    this.detailItem.set(item);
  }

  closeDetails(): void {
    this.detailItem.set(null);
  }

  navigateFromDetails(item: DiagnosticViewItem): void {
    this.onSelect(item);
    this.closeDetails();
  }

  openRepairConfirmation(item: DiagnosticViewItem): void {
    if (this.repairDisabled(item)) return;
    const diagnostic = item.diagnostic;
    const firstRepair = diagnostic.repairs?.[0];
    if (!firstRepair) return;
    this.repairItem.set(item);
    this.selectedRepair.set(firstRepair);
  }

  closeRepairConfirmation(): void {
    this.repairItem.set(null);
    this.selectedRepair.set(null);
  }

  confirmRepair(): void {
    const item = this.repairItem();
    const repair = this.selectedRepair();
    if (!item || !repair) return;
    this.repair.emit({
      diagnosticId: item.id,
      diagnostic: item.diagnostic,
      repair,
    });
    this.closeRepairConfirmation();
  }

  repairDisabled(item: DiagnosticViewItem): boolean {
    return (
      !item.diagnostic.repairs?.length ||
      this.state().freshness !== 'current' ||
      this.state().repairActivity?.status === 'pending-validation'
    );
  }

  repairTitle(item: DiagnosticViewItem): string {
    if (!item.diagnostic.repairs?.length) {
      return 'No automatic repair available';
    }
    if (this.state().repairActivity?.status === 'pending-validation') {
      return 'Validate or undo the pending repair first';
    }
    if (this.state().freshness !== 'current') {
      return 'Convert to refresh diagnostics before repairing';
    }
    return 'Review available repair';
  }

  isAffectedByActivity(item: DiagnosticViewItem): boolean {
    return (
      this.state().repairActivity?.affectedDiagnosticIds.includes(item.id) ??
      false
    );
  }
}
