export const APP_ROUTE_SEGMENTS = {
  home: '',
  splitView: 'split-view',
  filesView: 'files-view',
  erDiagram: 'diagram',
} as const;

export const LEGACY_APP_ROUTE_SEGMENTS = {
  splitView: 'preview-mode',
  filesView: 'editor-mode',
} as const;

export const APP_ROUTES = {
  home: '/',
  splitView: `/${APP_ROUTE_SEGMENTS.splitView}`,
  filesView: `/${APP_ROUTE_SEGMENTS.filesView}`,
  erDiagram: `/${APP_ROUTE_SEGMENTS.erDiagram}`,
} as const;
