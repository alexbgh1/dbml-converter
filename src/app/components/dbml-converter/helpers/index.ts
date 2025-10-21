/**
 * Formats a JSON object into a pretty-printed string
 */

function formatJson(obj: any): string {
  return JSON.stringify(obj, null, 2);
}

export { formatJson };
