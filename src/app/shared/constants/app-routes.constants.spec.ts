import { describe, expect, it } from 'vitest';

import { routes } from '../../app.routes';
import {
  APP_ROUTES,
  APP_ROUTE_SEGMENTS,
  LEGACY_APP_ROUTE_SEGMENTS,
} from './app-routes.constants';

describe('application routes', () => {
  it('preserves the public route URLs', () => {
    expect(APP_ROUTE_SEGMENTS).toEqual({
      home: '',
      splitView: 'split-view',
      filesView: 'files-view',
      erDiagram: 'diagram',
    });
    expect(APP_ROUTES).toEqual({
      home: '/',
      splitView: '/split-view',
      filesView: '/files-view',
      erDiagram: '/diagram',
    });
  });

  it('registers every destination and keeps the wildcard home redirect', () => {
    expect(routes[0]?.path).toBe(APP_ROUTE_SEGMENTS.home);
    expect(routes[0]?.children?.map((route) => route.path)).toEqual([
      APP_ROUTE_SEGMENTS.home,
      APP_ROUTE_SEGMENTS.splitView,
      APP_ROUTE_SEGMENTS.filesView,
      APP_ROUTE_SEGMENTS.erDiagram,
      LEGACY_APP_ROUTE_SEGMENTS.splitView,
      LEGACY_APP_ROUTE_SEGMENTS.filesView,
    ]);
    expect(routes[0]?.children?.slice(-2)).toEqual([
      {
        path: LEGACY_APP_ROUTE_SEGMENTS.splitView,
        redirectTo: APP_ROUTE_SEGMENTS.splitView,
        pathMatch: 'full',
      },
      {
        path: LEGACY_APP_ROUTE_SEGMENTS.filesView,
        redirectTo: APP_ROUTE_SEGMENTS.filesView,
        pathMatch: 'full',
      },
    ]);
    expect(routes[routes.length - 1]).toMatchObject({
      path: '**',
      redirectTo: APP_ROUTE_SEGMENTS.home,
    });
  });
});
