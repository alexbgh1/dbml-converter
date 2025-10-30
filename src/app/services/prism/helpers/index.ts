/**
 * Get the Prism language identifier from a given filename.
 * If the extension is not recognized, returns 'text'.
 * */
export function getLanguageFromFilename(filename: string): string {
  /* Border cases, no filename or no extension */
  if (!filename) return 'text';
  if (filename.indexOf('.') === -1) return 'text';

  const extension = filename.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'sass':
      return 'scss';
    case 'sql':
      return 'sql';
    case 'py':
      return 'python';
    case 'java':
      return 'java';
    case 'cs':
      return 'csharp';
    case 'php':
      return 'php';
    case 'rb':
      return 'ruby';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'cpp':
    case 'cc':
    case 'cxx':
      return 'cpp';
    case 'c':
      return 'c';
    case 'xml':
      return 'xml';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'md':
      return 'markdown';
    case 'sh':
    case 'bash':
      return 'bash';
    // Custom cases: prisma & dbml languages
    case 'prisma':
      return 'prisma';
    case 'dbml':
      return 'dbml';
    default:
      return 'text';
  }
}
