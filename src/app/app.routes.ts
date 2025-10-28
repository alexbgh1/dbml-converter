import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/dbml-converter/dbml-converter.component').then(
        (m) => m.DbmlConverterComponent
      ),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'docs',
        loadComponent: () =>
          import('./pages/docs/docs.component').then((m) => m.DocsComponent),
      },
      {
        path: 'preview-mode',
        loadComponent: () =>
          import(
            './components/dbml-converter/views/preview-mode/preview-mode.component'
          ).then((m) => m.PreviewModeComponent),
      },
      {
        path: 'editor-mode',
        loadComponent: () =>
          import(
            './components/dbml-converter/views/editor-mode/editor-mode.component'
          ).then((m) => m.EditorModeComponent),
      },
    ],
  },
];
