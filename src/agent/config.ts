import { EventQueue } from './eventQueue';
import { Booking } from '../schemas/booking';

/**
 * Typed accessors for the values runAgent injects into the LangGraph
 * `configurable` bag. Centralizes the `as` casts that would otherwise be
 * repeated at every node and tool that reads the queue, bookings, or default
 * location off an untyped config.
 */

export function getEventQueue(config: any): EventQueue {
  return config.configurable?.eventQueue as EventQueue;
}

export function getBookings(config: any): Booking[] {
  return (config.configurable?.bookings as Booking[]) || [];
}

export function getDefaultLocation(config: any): string | undefined {
  return config.configurable?.defaultLocation as string | undefined;
}
