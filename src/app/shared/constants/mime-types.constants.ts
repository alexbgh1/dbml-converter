const MIME_TYPES: Record<string, string> = {
  ts: 'text/typescript',
  json: 'application/json',
  sql: 'application/sql',
  txt: 'text/plain',
};

const DEFAULT_MIME_TYPE = 'text/plain';

export { MIME_TYPES, DEFAULT_MIME_TYPE };
