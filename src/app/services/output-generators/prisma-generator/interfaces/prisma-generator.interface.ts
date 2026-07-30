import { Diagnostic } from '../../../dbml-parser/interfaces/diagnostics.interface';

/*
  Return schema generated code for Prisma ORM (single file),
  plus output-validation diagnostics collected while generating.
*/
interface PrismaGeneratedCode {
  schema: string;
  diagnostics: Diagnostic[];
}

export type { PrismaGeneratedCode };
