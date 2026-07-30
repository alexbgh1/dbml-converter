import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DbmlCodeEditorComponent } from './dbml-code-editor.component';

describe('DbmlCodeEditorComponent', () => {
  let fixture: ComponentFixture<DbmlCodeEditorComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DbmlCodeEditorComponent] });
    fixture = TestBed.createComponent(DbmlCodeEditorComponent);
  });

  it('derives highlighted lines directly from the editor model', () => {
    fixture.componentInstance.code.set('Table users {\n  id int [pk]\n}');
    fixture.detectChanges();

    expect(fixture.componentInstance.highlighted()).toContain('token keyword');
    expect(fixture.componentInstance.codeLines()).toHaveLength(3);

    fixture.componentInstance.code.set('Enum role {\n  admin\n}');
    fixture.detectChanges();
    expect(fixture.componentInstance.highlighted()).toContain('Enum');
    expect(fixture.componentInstance.codeLines()).toHaveLength(3);
  });
});
