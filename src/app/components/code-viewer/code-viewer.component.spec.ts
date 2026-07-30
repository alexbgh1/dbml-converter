import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { CodeViewerComponent } from './code-viewer.component';

describe('CodeViewerComponent', () => {
  let fixture: ComponentFixture<CodeViewerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CodeViewerComponent] });
    fixture = TestBed.createComponent(CodeViewerComponent);
  });

  it('derives highlighted HTML from code and language inputs', () => {
    fixture.componentRef.setInput('code', 'const answer = 42;');
    fixture.componentRef.setInput('language', 'typescript');
    fixture.detectChanges();

    expect(fixture.componentInstance.highlightedCode()).toContain(
      'token keyword',
    );
    expect(fixture.nativeElement.querySelector('code').innerHTML).toContain(
      'token number',
    );

    fixture.componentRef.setInput('code', '');
    fixture.detectChanges();
    expect(fixture.componentInstance.highlightedCode()).toBe('');
  });
});
