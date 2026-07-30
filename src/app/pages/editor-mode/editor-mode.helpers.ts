import { DBML_INPUT_FILE } from '../../components/dbml-converter/constants/dbml-in-out.constants';
import { EditorFile } from '../../components/dbml-converter/interfaces/editor.interface';

export interface ProjectArchiveEntry {
  readonly filename: string;
  readonly content: string;
}

/** Builds deterministic ZIP entries without coupling archive policy to JSZip. */
export function projectArchiveEntries(
  files: readonly EditorFile[],
  dbmlContent: string,
): ProjectArchiveEntry[] {
  return [
    ...files.map((file) => ({
      filename: file.filename || `untitled.${file.id || 'txt'}`,
      content: file.content || '',
    })),
    {
      filename: DBML_INPUT_FILE.filename,
      content: dbmlContent || '',
    },
  ];
}
