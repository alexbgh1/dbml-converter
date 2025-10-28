import {
  Component,
  ElementRef,
  QueryList,
  ViewChildren,
  input,
  output,
  signal,
} from '@angular/core';
import { RippleEffect } from './interfaces/expanding-circle-button.interface';
import { OutputType } from '../../../components/dbml-converter/interfaces/dbml-converter.interface';

@Component({
  selector: 'app-expanding-circle-button',
  standalone: true,
  host: {
    class: 'block',
  },
  templateUrl: './expanding-circle-button.component.html',
  styleUrls: ['./expanding-circle-button.component.css'],
})
export class ExpandingCircleButtonComponent {
  // Inputs
  options = input<OutputType[]>([]);
  selectedId = input<string>('');

  // Outputs
  optionSelected = output<string>();

  @ViewChildren('buttonRef') buttonRefs!: QueryList<
    ElementRef<HTMLButtonElement>
  >;

  isOptionSelected = (id: string) => this.selectedId() === id;

  handleButtonClick(optionId: string, event: MouseEvent): void {
    if (this.isOptionSelected(optionId)) return;
    this.optionSelected.emit(optionId);
  }

  /* Getters for dynamic classes based on selection state */
  getClassNames(optionId: string): string {
    const classNames = this.options().find(
      (opt) => opt.id === optionId
    )?.classNames;
    return classNames || '';
  }

  getButtonClasses(optionId: string): string {
    const isSelected = this.isOptionSelected(optionId);
    const classNames = this.getClassNames(optionId);

    return isSelected
      ? 'text-white shadow-lg ' + classNames
      : ' bg-gray-800 text-gray-300  hover:bg-gray-700';
  }

  getExpandingCircleClasses(optionId: string): string {
    /*
      Expanding Circle is like a ripping effect,
      If active, it expands to cover the button,
      otherwise it stays small
    */
    const isSelected = this.isOptionSelected(optionId);
    const classNames = this.getClassNames(optionId);
    return isSelected
      ? 'w-full h-full top-0 left-0 scale-150 ' + classNames
      : 'w-3 h-3 top-1/2 left-4 -translate-y-1/2 scale-100 ' + classNames;
  }

  getIndicatorClasses(optionId: string): string {
    /*
      Inner Circle Indicator,
      If active return white dot,
      otherwise return the current option color
    */
    const isSelected = this.isOptionSelected(optionId);
    const classNames = this.getClassNames(optionId);

    return isSelected ? 'bg-white border border-white/50' : classNames;
  }
}
