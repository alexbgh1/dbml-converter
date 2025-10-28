interface EditorFile {
  id: string;
  filename: string;
  content: string;
}

interface CodeLine {
  number: number;
  content: string;
}

export type { EditorFile, CodeLine };
