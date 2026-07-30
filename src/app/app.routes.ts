import { Routes } from '@angular/router';
import {
  APP_ROUTE_SEGMENTS,
  LEGACY_APP_ROUTE_SEGMENTS,
} from './shared/constants/app-routes.constants';

export const routes: Routes = [
  {
    path: APP_ROUTE_SEGMENTS.home,
    loadComponent: () =>
      import('./components/dbml-converter/dbml-converter.component').then(
        (m) => m.DbmlConverterComponent,
      ),
    children: [
      {
        path: APP_ROUTE_SEGMENTS.home,
        loadComponent: () =>
          import('./pages/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: APP_ROUTE_SEGMENTS.splitView,
        loadComponent: () =>
          import('./pages/preview-mode/preview-mode.component').then(
            (m) => m.PreviewModeComponent,
          ),
      },
      {
        path: APP_ROUTE_SEGMENTS.filesView,
        loadComponent: () =>
          import('./pages/editor-mode/editor-mode.component').then(
            (m) => m.EditorModeComponent,
          ),
      },
      {
        path: APP_ROUTE_SEGMENTS.erDiagram,
        loadComponent: () =>
          import('./pages/er-diagram/er-diagram.component').then(
            (m) => m.ErDiagramComponent,
          ),
      },
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
    ],
  },

  /* Redirect to home page in any other case */
  {
    path: '**',
    redirectTo: APP_ROUTE_SEGMENTS.home,
  },
];
