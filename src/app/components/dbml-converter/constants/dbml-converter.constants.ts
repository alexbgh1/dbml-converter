import {
  OutputOption,
  OutputType,
} from '../interfaces/dbml-converter.interface';

const OUTPUT_OPTIONS_MAP: Record<OutputOption, OutputOption> = {
  json: 'json',
  typeorm: 'typeorm',
  prisma: 'prisma',
} as const;

const OUTPUT_TYPES: Record<OutputOption, OutputType> = {
  // Json as Light Blue
  json: {
    id: 'json',
    label: 'JSON',
    description: 'Json representation of the database schema',
    icon: 'curly-braces',
    classNames: 'bg-json',
  },
  // TypeORM as Orange
  typeorm: {
    id: 'typeorm',
    label: 'TypeORM',
    description: 'TypeORM entities code',
    icon: 'typeorm',
    classNames: 'bg-typeorm',
  },
  // Prisma as Indigo
  prisma: {
    id: 'prisma',
    label: 'Prisma',
    description: 'Prisma schema code',
    icon: 'prisma',
    classNames: 'bg-prisma',
  },
};

const OUTPUT_TYPE_OPTIONS: readonly OutputType[] = Object.freeze(
  Object.values(OUTPUT_TYPES),
);

export { OUTPUT_OPTIONS_MAP, OUTPUT_TYPE_OPTIONS, OUTPUT_TYPES };
