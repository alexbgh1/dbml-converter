export interface GeneratedCode {
  /**
   * Each entity file generated, with the filename as key and the code content as value
   */
  entities: Record<string, string>;

  /**
   * The main module file content that imports all entities
   */
  module: string;
}

export interface CodeGenerationOptions {
  /**
   * Base directory for generated files
   * by default is ./
   */
  baseDir?: string;

  /**
   * Include explanatory comments in the generated code
   * by default is true
   */
  includeComments?: boolean;
}
