/**
 * Parse a string into a valid TCP port number (positive integer), or null when
 * it isn't one. Kept separate from config/env so the validation can be unit
 * tested without triggering env's fail-fast process.exit on import.
 */
export function parsePort(raw: string): number | null {
  const port = Number(raw);
  if (Number.isNaN(port) || port <= 0 || !Number.isInteger(port)) return null;
  return port;
}
