import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DbmlConversionActionsComponent } from './dbml-conversion-actions.component';

describe('DbmlConversionActionsComponent', () => {
  let fixture: ComponentFixture<DbmlConversionActionsComponent>;
  let component: DbmlConversionActionsComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DbmlConversionActionsComponent],
    });
    fixture = TestBed.createComponent(DbmlConversionActionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('emits Convert and reflects the converting state', () => {
    const convertRequested = vi.fn();
    component.convertRequested.subscribe(convertRequested);

    buttonNamed('Convert').click();
    expect(convertRequested).toHaveBeenCalledOnce();

    fixture.componentRef.setInput('isConverting', true);
    fixture.detectChanges();

    expect(buttonNamed('Convert').disabled).toBe(true);
  });

  it('emits Clear only after destructive-action confirmation', () => {
    const clearRequested = vi.fn();
    component.clearRequested.subscribe(clearRequested);

    buttonNamed('Clear').click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[role="dialog"]'),
    ).not.toBeNull();

    buttonNamed('Cancel').click();
    fixture.detectChanges();
    expect(clearRequested).not.toHaveBeenCalled();

    buttonNamed('Clear').click();
    fixture.detectChanges();
    buttonNamed('Clear everything').click();
    expect(clearRequested).toHaveBeenCalledOnce();
  });

  function buttonNamed(name: string): HTMLButtonElement {
    const host = fixture.nativeElement as HTMLElement;
    const button = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((candidate) => candidate.textContent?.trim() === name);
    if (!button) throw new Error(`Button ${name} was not rendered`);
    return button;
  }
});
