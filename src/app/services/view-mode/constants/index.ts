const CODE_VIEW_MODE_MAP = {
  preview: 'preview',
  editor: 'editor',
} as const;

const DEFAULT_VIEW_MODE = CODE_VIEW_MODE_MAP.preview;

const CODE_VIEW_MODES = Object.values(CODE_VIEW_MODE_MAP);

export { DEFAULT_VIEW_MODE, CODE_VIEW_MODE_MAP, CODE_VIEW_MODES };
