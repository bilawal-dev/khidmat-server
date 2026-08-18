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

/** Minutes since midnight for a slot/time string, or null when unparseable. */
export function slotMinutes(raw: string): number | null {
  const canonical = normalizeSlot(raw);
  if (!canonical) return null;

  const match = canonical.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!match) return null;

  let hour = Number(match[1]) % 12; // 12am → 0, 12pm handled below
  const minute = Number(match[2]);
  if (match[3] === 'pm') hour += 12;

  return hour * 60 + minute;
}

/** A provider slot in display, canonical, and machine-sortable forms. */
export type DescribedSlot = { display: string; normalized: string; minutes: number };

/**
 * Describe a provider's slots for API consumers: each slot's original display
 * string plus its canonical form and minutes-since-midnight, sorted by time.
 * Unparseable slots are dropped so callers always get well-formed data.
 */
export function describeSlots(provider: Provider): DescribedSlot[] {
  return provider.availableSlots
    .map((display) => {
      const normalized = normalizeSlot(display);
      const minutes = slotMinutes(display);
      return normalized && minutes != null ? { display, normalized, minutes } : null;
    })
    .filter((s): s is DescribedSlot => s !== null)
    .sort((a, b) => a.minutes - b.minutes);
}
