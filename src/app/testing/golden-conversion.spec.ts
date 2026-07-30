import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { formatJson } from '../components/dbml-converter/helpers';
import { DbmlParserService } from '../services/dbml-parser/dbml-parser';
import { NestjsGeneratorService } from '../services/output-generators/nestjs-generator/nestjs-generator.service';
import { PrismaGeneratorService } from '../services/output-generators/prisma-generator/prisma-generator.service';

function loadFixture(name: string): string {
  return readFileSync(
    resolve('src', 'app', 'testing', 'fixtures', name, 'input.dbml'),
    'utf8',
  );
}

const FIXTURES = {
  basic: loadFixture('basic'),
  relations: loadFixture('relations'),
  'enums-indexes': loadFixture('enums-indexes'),
  junctions: loadFixture('junctions'),
  'diagnostics-invalid': loadFixture('diagnostics-invalid'),
  commerce: loadFixture('commerce'),
};

describe('golden DBML conversions', () => {
  for (const [name, input] of Object.entries(FIXTURES)) {
    it(`matches every reviewed output for ${name}`, () => {
      const parser = new DbmlParserService();
      const prismaGenerator = new PrismaGeneratorService();
      const typeormGenerator = new NestjsGeneratorService();

      parser.setDbmlContent(input.replace(/\r\n/g, '\n').trimEnd());
      const schema = parser.schema();
      const prisma = prismaGenerator.generateCode(schema);
      const typeorm = typeormGenerator.generateCode(schema);

      expect({
        json: formatJson(schema),
        prisma: prisma.schema.replace(/\r\n/g, '\n'),
        typeorm: {
          ...typeorm.entities,
          'database.module.ts': typeorm.module,
        },
        diagnostics: [
          ...parser.diagnostics(),
          ...prisma.diagnostics,
          ...typeorm.diagnostics,
        ],
      }).toMatchSnapshot();
    });
  }
});
