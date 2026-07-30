import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoadDbmlExampleButtonComponent } from './load-dbml-example-button.component';

describe('LoadDbmlExampleButtonComponent', () => {
  let fixture: ComponentFixture<LoadDbmlExampleButtonComponent>;
  let component: LoadDbmlExampleButtonComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoadDbmlExampleButtonComponent],
    });
    fixture = TestBed.createComponent(LoadDbmlExampleButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('emits only after confirming the overwrite', () => {
    const loadRequested = vi.fn();
    component.loadRequested.subscribe(loadRequested);

    buttonNamed('Load example DBML code').click();
    fixture.detectChanges();
    buttonNamed('Cancel').click();
    fixture.detectChanges();
    expect(loadRequested).not.toHaveBeenCalled();

    buttonNamed('Load example DBML code').click();
    fixture.detectChanges();
    buttonNamed('Load example').click();
    expect(loadRequested).toHaveBeenCalledOnce();
  });

  function buttonNamed(name: string): HTMLButtonElement {
    const button = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((candidate) => candidate.textContent?.trim() === name);
    if (!button) throw new Error(`Button ${name} was not rendered`);
    return button;
  }
});
