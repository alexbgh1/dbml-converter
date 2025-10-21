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
   * Directorio base para los imports relativos
   * Por defecto es './'
   */
  baseDir?: string;

  /**
   * Incluir comentarios explicativos en el código generado
   * Por defecto es true
   */
  includeComments?: boolean;
}
