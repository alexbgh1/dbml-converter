/*

  OutputType is the language to convert DBML into.
  Examples: 'nestjs', 'typeorm', 'prisma', etc.

  including metadata like
    label, description, color, icon, etc.
*/

export type OutputOption = 'json' | 'typeorm' | 'prisma';

export interface OutputType {
  id: OutputOption;
  label: string;
  description: string;
  color: string;
  icon: string;
}
