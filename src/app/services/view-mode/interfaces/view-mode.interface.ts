import { CODE_VIEW_MODES } from '../constants';

type CodeViewMode = (typeof CODE_VIEW_MODES)[number];

interface CodeView {
  mode: CodeViewMode;
}

export type { CodeViewMode, CodeView };
