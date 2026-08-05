import type { Provider } from '../data/providers';

/**
 * Slot matching for the provider directory. Provider slots are display strings
 * like "10:00 AM"; user queries arrive in looser forms ("10am", "10:00",
 * "2 PM"). This normalizes both sides to compare them robustly without pulling
 * in a date library.
 */

/** Normalize a slot/time string to a canonical `HH:MMap` form (e.g. "10:00am"). */
export function normalizeSlot(raw: string): string | null {
  const match = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ?? '00';
  const meridiem = match[3];

  if (hour < 0 || hour > 23) return null;

  // With an explicit am/pm, keep 12-hour form; otherwise infer from 24h input.
  let period = meridiem;
  if (!period) {
    period = hour >= 12 ? 'pm' : 'am';
    if (hour > 12) hour -= 12;
  }
  if (hour === 0) hour = 12;

  return `${hour}:${minute}${period}`;
}

/** Whether a provider offers a slot matching the requested time. */
export function hasSlot(provider: Provider, requested: string): boolean {
  const target = normalizeSlot(requested);
  if (!target) return false;
  return provider.availableSlots.some((slot) => normalizeSlot(slot) === target);
}
