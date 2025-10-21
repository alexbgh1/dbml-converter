import {
  Component,
  ElementRef,
  QueryList,
  ViewChildren,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ExpandingButtonOption,
  RippleEffect,
} from './interfaces/expanding-circle-button.interface';

@Component({
  selector: 'app-expanding-circle-button',
  standalone: true,
  imports: [CommonModule],
  host: {
    class: 'block',
  },
  templateUrl: './expanding-circle-button.component.html',
  styleUrls: ['./expanding-circle-button.component.css'],
})
export class ExpandingCircleButtonComponent {
  // Inputs
  options = input<ExpandingButtonOption[]>([]);
  selectedId = input<string>('');

  // Outputs
  optionSelected = output<string>();

  @ViewChildren('buttonRef') buttonRefs!: QueryList<
    ElementRef<HTMLButtonElement>
  >;

  private rippleState = signal<RippleEffect[]>([]);

  isOptionSelected = (id: string) => this.selectedId() === id;

  getRipplesForOption(optionId: string): RippleEffect[] {
    return this.rippleState().filter((ripple) => ripple.optionId === optionId);
  }

  handleButtonClick(optionId: string, event: MouseEvent): void {
    if (this.isOptionSelected(optionId)) return;
    this.optionSelected.emit(optionId);
  }

  /* Getters for dynamic classes based on selection state */
  getButtonClasses(optionId: string): string {
    const isSelected = this.isOptionSelected(optionId);
    return isSelected
      ? 'text-white shadow-lg'
      : 'bg-gray-100 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700';
  }

  getExpandingCircleClasses(optionId: string): string {
    const isSelected = this.isOptionSelected(optionId);
    return isSelected
      ? 'w-full h-full top-0 left-0 scale-150'
      : 'w-3 h-3 top-1/2 left-4 -translate-y-1/2 scale-100';
  }

  getIndicatorClasses(optionId: string): string {
    const isSelected = this.isOptionSelected(optionId);
    return isSelected ? 'bg-white/30 border border-white/50' : '';
  }
}
