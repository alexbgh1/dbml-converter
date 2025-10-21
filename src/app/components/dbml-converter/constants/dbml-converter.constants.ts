import {
  OutputOption,
  OutputType,
} from '../interfaces/dbml-converter.interface';

const OUTPUT_OPTIONS_MAP: Record<OutputOption, OutputOption> = {
  json: 'json',
  typeorm: 'typeorm',
  prisma: 'prisma',
};

const OUTPUT_OPTIONS_ARRAY = Object.values(OUTPUT_OPTIONS_MAP);

const OUTPUT_TYPES: Record<OutputOption, OutputType> = {
  // Json as Light Blue
  json: {
    id: 'json',
    label: 'JSON',
    description: 'Json representation of the database schema',
    color: '#5B9BD5',
    icon: 'curly-braces',
  },
  // TypeORM as Orange
  typeorm: {
    id: 'typeorm',
    label: 'TypeORM',
    description: 'TypeORM entities code',
    color: '#ff7733',
    icon: 'typeorm',
  },
  // Prisma as Indigo
  prisma: {
    id: 'prisma',
    label: 'Prisma',
    description: 'Prisma schema code',
    color: '#5a67d8',
    icon: 'prisma',
  },
};

const INPUT_CODE_EDITOR_OPTIONS = {
  language: 'dbml',
  height: '400px',
};

export {
  OUTPUT_OPTIONS_MAP,
  OUTPUT_OPTIONS_ARRAY,
  OUTPUT_TYPES,
  INPUT_CODE_EDITOR_OPTIONS,
};
