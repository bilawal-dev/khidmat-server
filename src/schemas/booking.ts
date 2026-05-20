import { z } from 'zod';
import { SERVICE_CATEGORIES } from '../data/providers';

export const BookingSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  category: z.enum(SERVICE_CATEGORIES as [string, ...string[]]),
  sector: z.string(),
  scheduledFor: z.string(),
  scheduledTimestamp: z.number(),
  status: z.enum(['confirmed', 'reminded', 'completed', 'cancelled']),
  reminderAt: z.string(),
  agentThread: z.array(z.unknown()),
  createdAt: z.number(),
});

export type Booking = z.infer<typeof BookingSchema>;
