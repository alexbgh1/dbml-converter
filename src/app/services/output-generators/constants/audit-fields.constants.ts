export const CREATED_AT_FIELDS: readonly string[] = [
  'created_at',
  'createdat',
  'creation_date',
];

export const UPDATED_AT_FIELDS: readonly string[] = [
  'updated_at',
  'updatedat',
  'modification_date',
];

export const DELETED_AT_FIELDS: readonly string[] = [
  'deleted_at',
  'deletedat',
  'deletion_date',
];

export const TIMESTAMP_DB_TYPES: readonly string[] = [
  'time',
  'timestamp',
  'timestamptz',
  'datetime',
];

export const AUDIT_TIMESTAMP_FIELDS: ReadonlySet<string> = new Set([
  ...CREATED_AT_FIELDS,
  ...UPDATED_AT_FIELDS,
  ...DELETED_AT_FIELDS,
]);
