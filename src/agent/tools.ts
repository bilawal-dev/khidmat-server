import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { providers, Provider, SERVICE_CATEGORIES } from '../data/providers';
import { SECTOR_COORDS } from '../data/sectors';
import { EventQueue } from './eventQueue';
import * as crypto from 'crypto';
import { gemini } from '../lib/gemini';
import { Booking } from '../schemas/booking';

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * 
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export const searchProviders = tool(
  async ({ category, sector }, config) => {
    const queue = config.configurable?.eventQueue as EventQueue;
    queue.push({ type: 'searching', near: sector, category: category as any });
    return providers.filter(p => p.category === category);
  },
  {
    name: 'searchProviders',
    description: 'Find providers in the dataset matching the service category.',
    schema: z.object({
      category: z.enum(SERVICE_CATEGORIES as [string, ...string[]]),
      sector: z.string()
    })
  }
);

export const rankByDistance = tool(
  async ({ providers: inputProviders, fromSector }, config) => {
    const queue = config.configurable?.eventQueue as EventQueue;
    const userCoords = SECTOR_COORDS[fromSector.toUpperCase()];
    if (!userCoords) return { error: 'unknown_sector', sector: fromSector };

    const ranked = (inputProviders as Provider[]).map(provider => {
      const distanceKm = haversineKm(userCoords, provider.coords);
      return { provider, distanceKm };
    }).sort((a, b) => {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return b.provider.rating - a.provider.rating;
    });

    queue.push({ type: 'ranking', candidateCount: ranked.length });
    return ranked;
  },
  {
    name: 'rankByDistance',
    description: 'Rank candidates by distance and rating.',
    schema: z.object({
      providers: z.array(z.any()).describe('The array of providers returned by searchProviders'),
      fromSector: z.string().describe('The user sector')
    })
  }
);

export const checkAvailability = tool(
  async ({ providerId, dayLabel, slotPreference }, config) => {
    const provider = providers.find(p => p.id === providerId);
    if (!provider) return null;

    let pickedSlot = provider.availableSlots[0];
    for (const slot of provider.availableSlots) {
      const isPM = slot.toLowerCase().includes('pm');
      const isAM = slot.toLowerCase().includes('am');
      const match = slot.match(/(\d+)/);
      const hour = match ? parseInt(match[1]) : 12;
      
      if (slotPreference === 'morning' && isAM && hour >= 6 && hour < 12) { pickedSlot = slot; break; }
      if (slotPreference === 'afternoon' && isPM && (hour === 12 || hour < 5)) { pickedSlot = slot; break; }
      if (slotPreference === 'evening' && isPM && (hour >= 5 && hour < 12)) { pickedSlot = slot; break; }
    }

    let daysOffset = 1;
    if (dayLabel === 'Today') daysOffset = 0;
    else if (dayLabel === 'Tomorrow') daysOffset = 1;
    else {
      const Capitalized = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const idx = Capitalized.indexOf(dayLabel);
      if (idx !== -1) {
        const today = new Date().getDay();
        daysOffset = ((idx - today + 7) % 7) || 7;
      }
    }

    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    const m = pickedSlot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (m) {
      let h = parseInt(m[1]);
      const min = parseInt(m[2]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      d.setHours(h, min, 0, 0);
    }

    return { slot: pickedSlot, scheduledTimestamp: d.getTime() };
  },
  {
    name: 'checkAvailability',
    description: 'Check availability of a provider and get the resolved slot and timestamp.',
    schema: z.object({
      providerId: z.string(),
      dayLabel: z.string(),
      slotPreference: z.enum(['morning', 'afternoon', 'evening', 'any'])
    })
  }
);

export const confirmBooking = tool(
  async ({ providerId, slot, dayLabel, scheduledTimestamp, distanceKm, reasoning }, config) => {
    const queue = config.configurable?.eventQueue as EventQueue;
    const provider = providers.find(p => p.id === providerId);
    if (!provider) return { error: 'unknown_provider', providerId };

    queue.push({
      type: 'recommendation',
      provider,
      distanceKm: parseFloat(distanceKm.toFixed(1)),
      reasoning,
      suggestedSlot: slot,
      dayLabel,
      scheduledTimestamp,
    });

    queue.push({
      type: 'booking',
      provider,
      slot,
    });

    const bookingId = crypto.randomUUID();
    queue.push({
      type: 'confirmed',
      bookingId,
    });

    return { bookingId };
  },
  {
    name: 'confirmBooking',
    description: 'Confirm booking with a provider. MUST provide a 2-3 sentence reasoning comparing the top pick against alternatives based on distance and rating.',
    schema: z.object({
      providerId: z.string(),
      slot: z.string(),
      dayLabel: z.string(),
      scheduledTimestamp: z.number(),
      distanceKm: z.number(),
      reasoning: z.string().describe("A 2-3 sentence narrative comparing the top picks. Required.")
    })
  }
);

export const scheduleReminder = tool(
  async ({ bookingId, scheduledTimestamp }, config) => {
    const queue = config.configurable?.eventQueue as EventQueue;
    
    const at = '1 hour before';
    const atTimestamp = scheduledTimestamp - 3600000;
    
    queue.push({
      type: 'reminder_scheduled',
      at,
    });

    return { at, atTimestamp };
  },
  {
    name: 'scheduleReminder',
    description: 'Schedule a reminder for the confirmed booking.',
    schema: z.object({
      bookingId: z.string(),
      scheduledTimestamp: z.number()
    })
  }
);

export const resolveBookingTarget = tool(
  async ({ userPhrase }, config) => {
    const bookings = (config.configurable?.bookings as Booking[]) || [];
    if (!bookings || bookings.length === 0) return { bookingId: '', summary: 'No bookings available.' };
    
    const structuredModel = gemini.withStructuredOutput(z.object({
      bookingId: z.string().describe("The ID of the matching booking, or empty string if ambiguous/no match"),
      summary: z.string().describe("A brief summary of the matched booking, or explanation of why it's ambiguous")
    }));
    
    const prompt = `You are a disambiguation assistant. Given the user's phrasing and a list of bookings, identify which booking they are referring to.
User Phrase: "${userPhrase}"
Bookings: ${JSON.stringify(bookings, null, 2)}

If exactly one booking matches, return its ID. If multiple match or none match, return an empty string for bookingId.`;

    return await structuredModel.invoke(prompt);
  },
  {
    name: 'resolveBookingTarget',
    description: 'Disambiguate which booking the user is referring to based on their phrasing. The active bookings list is available implicitly from session context.',
    schema: z.object({
      userPhrase: z.string()
    })
  }
);

export const proposeBookingChange = tool(
  async ({ bookingId, changes, reason }, config) => {
    const queue = config.configurable?.eventQueue as EventQueue;
    queue.push({ type: 'booking_update', bookingId, changes, reason });
    return { ok: true };
  },
  {
    name: 'proposeBookingChange',
    description: 'Propose a change to an existing booking (e.g. rescheduling).',
    schema: z.object({
      bookingId: z.string(),
      changes: z.object({
        dayLabel: z.string().optional(),
        slot: z.string().optional(),
        scheduledTimestamp: z.number().optional(),
        status: z.enum(['confirmed', 'reminded', 'completed', 'cancelled']).optional()
      }).strict(),
      reason: z.string()
    })
  }
);

export const proposeBookingCancellation = tool(
  async ({ bookingId, reason }, config) => {
    const queue = config.configurable?.eventQueue as EventQueue;
    queue.push({ type: 'booking_cancel', bookingId, reason });
    return { ok: true };
  },
  {
    name: 'proposeBookingCancellation',
    description: 'Cancel an existing booking.',
    schema: z.object({
      bookingId: z.string(),
      reason: z.string()
    })
  }
);

export const answerBookingQuery = tool(
  async ({ bookingId, summary }, config) => {
    const queue = config.configurable?.eventQueue as EventQueue;
    queue.push({ type: 'booking_query', bookingId, summary });
    return { ok: true };
  },
  {
    name: 'answerBookingQuery',
    description: 'Answer a user query about an existing booking.',
    schema: z.object({
      bookingId: z.string(),
      summary: z.string()
    })
  }
);
