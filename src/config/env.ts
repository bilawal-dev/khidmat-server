import 'dotenv/config';
import { logger } from '../lib/logger';

/**
 * Single source of truth for environment configuration.
 *
 * Validation runs once, at import time, and fails fast with a clear message so
 * misconfiguration surfaces on boot rather than on the first request that
 * happens to touch a given variable.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    logger.error(`FATAL ERROR: ${name} environment variable is missing.`);
    process.exit(1);
  }
  return value;
}

function requiredPort(name: string): number {
  const raw = required(name);
  const port = Number(raw);
  if (isNaN(port) || port <= 0 || !Number.isInteger(port)) {
    logger.error(`FATAL ERROR: ${name} environment variable must be a valid positive integer.`);
    process.exit(1);
  }
  return port;
}

/**
 * Comma-separated allowlist of origins for CORS. Optional — when unset, all
 * origins are permitted (the mobile client sends no browser Origin anyway).
 */
function optionalList(name: string): string[] | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

export const env = {
  PORT: requiredPort('PORT'),
  GEMINI_API_KEY: required('GEMINI_API_KEY'),
  GEMINI_MODEL_NAME: required('GEMINI_MODEL_NAME'),
  CORS_ORIGINS: optionalList('CORS_ORIGINS'),
};
