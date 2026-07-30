import { Diagnostic } from '../../../dbml-parser/interfaces/diagnostics.interface';

export interface GeneratedCode {
  /**
   * Each entity file generated, with the filename as key and the code content as value
   */
  entities: Record<string, string>;

  /**
   * The main module file content that imports all entities
   */
  module: string;

  /**
   * Output-validation diagnostics collected while generating
   */
  diagnostics: Diagnostic[];
}
