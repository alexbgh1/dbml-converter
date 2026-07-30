/**
 * Formats a JSON object into a pretty-printed string.
 * Source-location fields are parser bookkeeping for diagnostics navigation,
 * not schema data.
 */

function formatJson(obj: unknown): string {
  return (
    JSON.stringify(
      obj,
      (key, value) =>
        key === 'sourceLine' || key === 'valueSourceLines' ? undefined : value,
      2,
    ) ?? ''
  );
}

export { formatJson };
