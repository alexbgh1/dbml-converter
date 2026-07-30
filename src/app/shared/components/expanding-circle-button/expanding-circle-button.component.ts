import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';

interface SelectableOption {
  id: string;
  label: string;
  classNames?: string;
}

@Component({
  selector: 'app-expanding-circle-button',
  standalone: true,
  host: {
    class: 'block',
  },
  templateUrl: './expanding-circle-button.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./expanding-circle-button.component.css'],
})
export class ExpandingCircleButtonComponent {
  // Inputs
  options = input<readonly SelectableOption[]>([]);
  selectedId = input<string>('');

  // Outputs
  optionSelected = output<string>();

  isOptionSelected = (id: string) => this.selectedId() === id;

  handleButtonClick(optionId: string): void {
    if (this.isOptionSelected(optionId)) return;
    this.optionSelected.emit(optionId);
  }

  getButtonClasses(option: SelectableOption): string {
    const isSelected = this.isOptionSelected(option.id);
    const classNames = option.classNames ?? '';

    return isSelected
      ? 'text-white shadow-lg ' + classNames
      : ' bg-gray-800 text-gray-300  hover:bg-gray-700';
  }

  getExpandingCircleClasses(option: SelectableOption): string {
    /*
      Expanding Circle is like a ripping effect,
      If active, it expands to cover the button,
      otherwise it stays small
    */
    const isSelected = this.isOptionSelected(option.id);
    const classNames = option.classNames ?? '';
    return isSelected
      ? 'w-full h-full top-0 left-0 scale-150 ' + classNames
      : 'w-3 h-3 top-1/2 left-4 -translate-y-1/2 scale-100 ' + classNames;
  }

  getIndicatorClasses(option: SelectableOption): string {
    /*
      Inner Circle Indicator,
      If active return white dot,
      otherwise return the current option color
    */
    const isSelected = this.isOptionSelected(option.id);
    const classNames = option.classNames ?? '';

    return isSelected ? 'bg-white border border-white/50' : classNames;
  }
}
