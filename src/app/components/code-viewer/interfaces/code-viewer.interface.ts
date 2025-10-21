// Languages can be found in prism lib, or services/prism/custom-languages
// e.g.
// - import 'prismjs/components/prism-json';

export interface CodeViewerOptions {
  language: Prism.Languages;
  height?: string;
}
