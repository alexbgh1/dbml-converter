import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionDialogComponent } from './action-dialog.component';

describe('ActionDialogComponent', () => {
  let fixture: ComponentFixture<ActionDialogComponent>;
  let component: ActionDialogComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ActionDialogComponent] });
    fixture = TestBed.createComponent(ActionDialogComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'Confirm action');
  });

  it('renders only while open and exposes an accessible dialog', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('Confirm action');
  });

  it('emits the selected footer action', () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    component.primary.subscribe(primary);
    component.secondary.subscribe(secondary);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('primaryLabel', 'Continue');
    fixture.componentRef.setInput('secondaryLabel', 'Cancel');
    fixture.detectChanges();

    buttonNamed('Cancel').click();
    buttonNamed('Continue').click();

    expect(secondary).toHaveBeenCalledOnce();
    expect(primary).toHaveBeenCalledOnce();
  });

  it('dismisses from Escape and the close control', () => {
    const dismissed = vi.fn();
    component.dismissed.subscribe(dismissed);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    buttonNamed('×').click();

    expect(dismissed).toHaveBeenCalledTimes(2);
  });

  function buttonNamed(name: string): HTMLButtonElement {
    const button = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((candidate) => candidate.textContent?.trim() === name);
    if (!button) throw new Error(`Button ${name} was not rendered`);
    return button;
  }
});
