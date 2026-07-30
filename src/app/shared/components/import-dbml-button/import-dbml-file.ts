export const DBML_FILE_EXTENSION = '.dbml';
export const MAX_DBML_FILE_SIZE_MIB = 2;
export const MAX_DBML_FILE_SIZE = MAX_DBML_FILE_SIZE_MIB * 1024 * 1024;

export function validateDbmlFile(
  file: Pick<File, 'name' | 'size'>,
): string | null {
  if (!file.name.toLowerCase().endsWith(DBML_FILE_EXTENSION)) {
    return `Choose a file with the ${DBML_FILE_EXTENSION} extension.`;
  }
  if (file.size === 0) return 'The selected DBML file is empty.';
  if (file.size > MAX_DBML_FILE_SIZE) {
    return `The selected DBML file is larger than ${MAX_DBML_FILE_SIZE_MIB} MiB.`;
  }
  return null;
}
