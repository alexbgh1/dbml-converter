import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_ROUTES } from '../../shared/constants/app-routes.constants';
import { HomeComponent } from './home.component';

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  });

  it('renders the alternative hero and links to existing tools', () => {
    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('a'));

    expect(element.textContent).toContain('DBML');
    expect(element.textContent).toContain('CODE');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      APP_ROUTES.splitView,
      APP_ROUTES.erDiagram,
    ]);
  });

  it('uses the format artwork and Prism-highlighted DBML preview', () => {
    const element = fixture.nativeElement as HTMLElement;
    const imageSources = Array.from(
      element.querySelectorAll<HTMLImageElement>('img'),
    ).map((image) => image.getAttribute('src'));

    expect(imageSources).toEqual([
      'images/json-badge.png',
      'images/prisma-badge.png',
      'images/typeorm-badge.png',
    ]);
    expect(fixture.componentInstance.codeLines()).toHaveLength(10);
    expect(
      element.querySelectorAll('[aria-label="Example DBML schema"] code'),
    ).toHaveLength(10);
    expect(element.querySelector('.token.keyword')?.textContent).toBe('Table');
    expect(element.querySelector('er-diagram-icon')).not.toBeNull();
  });
});
