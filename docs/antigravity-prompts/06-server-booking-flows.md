Hey — prompts 04 and 05 covered the new-booking flow end-to-end. This one adds the **modify / cancel / query** flows for bookings the user already has, plus a top-level intent classifier that routes between all four flows.

The mental model: the user is in a fresh chat (no conversation history server-side), but the FE sends along their existing bookings from local storage on every request. The agent uses that context to decide whether the user is starting something new, changing something existing, canceling, or just asking. The agent never persists bookings — it emits *intent events* the FE applies to its own storage.

## What I already prepped (don't redo)

- `src/agent/events.ts` already declares three event types for this prompt:
  ```ts
  | { type: 'booking_update'; bookingId: string; changes: Record<string, unknown>; reason: string }
  | { type: 'booking_cancel'; bookingId: string; reason: string }
  | { type: 'booking_query'; bookingId: string; summary: string }
  ```
- `src/schemas/chat.ts` currently has `bookings: z.array(z.unknown()).optional()` — you'll tighten this in this prompt to a real Booking schema.

## Fixes carried over from the previous round

Three cleanups before you touch the new flow code. Do these first — same files you'll be editing for the rest of this prompt.

### Fix 1: `runAgent.ts` emits an event type that doesn't exist

`src/agent/runAgent.ts` currently has:
```ts
queue.push({ type: 'error' as any, message: 'Session expired, starting over' });
```

`error` is not a valid `AgentEvent` — the `as any` is suppressing a real contract violation. Replace with a `thought` event:
```ts
queue.push({ type: 'thought', text: 'Session expired — starting a new conversation.' });
```

### Fix 2: Interrupt detection via string match

`src/agent/graph.ts` calls `interrupt("Missing fields")` and `src/agent/runAgent.ts` catches it with:
```ts
if (err.message === 'Missing fields') { /* expected */ }
```

This is fragile — change the string in one file and the other silently misclassifies legitimate interrupts as errors. LangGraph throws a `GraphInterrupt`. Use a structural check:
```ts
import { GraphInterrupt } from '@langchain/langgraph';
// ...
} catch (err: any) {
  if (err instanceof GraphInterrupt) {
    // expected — graph paused cleanly
  } else {
    console.error('[server] Graph execution error:', err);
  }
}
```
If `GraphInterrupt` isn't re-exported from the top-level package in our installed version, fall back to `err.name === 'GraphInterrupt'`. Don't keep the string match.

### Fix 3: Tools should return errors, not throw

Two existing tools in `src/agent/tools.ts` throw on bad input:
- `rankByDistance` throws `Error("Sector not recognized")` when the location isn't in `SECTOR_COORDS`.
- `confirmBooking` uses `providers.find(...)!` and crashes the graph if the LLM hallucinates a `providerId`.

A throw inside a tool propagates as a graph execution error rather than something the LLM can recover from. Change both to return a structured error the LLM can read, e.g. `{ error: 'unknown_sector', sector }` and `{ error: 'unknown_provider', providerId }`. The agent loop will see the error in the tool message and can re-plan or emit an `awaiting_user`.

Apply the same principle to all new tools added in this prompt: validate inputs, return structured errors, never throw.

## Architecture changes

### 1. Add `src/schemas/booking.ts`

The FE's source of truth is its zustand store at `apps/mobile/lib/stores/useBookingsStore.ts`. Read that file, mirror its Booking shape exactly as a Zod schema:

```ts
export const BookingSchema = z.object({
  id: z.string(),
  // ... mirror useBookingsStore.ts
});
export type Booking = z.infer<typeof BookingSchema>;
```

If a field is hard to type strictly (status enum, timestamps), use the narrowest type that works. Don't drift from the FE shape — when the FE sends a booking, it must parse cleanly.

Then tighten `src/schemas/chat.ts`:
```ts
bookings: z.array(BookingSchema).optional(),
```

If parsing fails because the FE shape doesn't match, the user gets a 400 with details. That's correct — we want the contracts in lockstep.

### 2. Add an intent classifier node at the entry of the graph

The current graph in `src/agent/graph.ts` starts with `intent_extraction` (service/location/time). That assumes new-booking. We need to add a step *before* that:

```
START
  │
  ▼
classify_intent   ← classifies message into one of:
  │                 'new_booking' | 'modify_booking' | 'cancel_booking' | 'query_booking'
  │
  ├─ new_booking ───→ intent_extraction → gate → agent (new-booking tools)
  ├─ modify_booking ─→ agent (modify tools)
  ├─ cancel_booking ─→ agent (cancel tools)
  └─ query_booking ──→ agent (query tools)
```

The classifier is one Gemini structured-output call. System prompt should include: the user's bookings (FE-supplied), the new message, and the four valid labels. If `bookings` is empty or absent, the classifier should always return `'new_booking'` (no existing bookings to act on).

Emit a `thought` event with the classifier's reasoning before the routing decision.

### 3. New tools in `src/agent/tools.ts`

Add these. Each is a `tool({...})` from `@langchain/core/tools`:

| Tool | Input | Output | Events pushed |
|------|-------|--------|---------------|
| `resolveBookingTarget` | `{ bookings: Booking[], userPhrase: string }` | `{ bookingId: string, summary: string }` | (none) |
| `proposeBookingChange` | `{ bookingId: string, changes: { dayLabel?, slot?, scheduledTimestamp?, status? }, reason: string }` | `{ ok: true }` | `{ type: 'booking_update', bookingId, changes, reason }` |
| `proposeBookingCancellation` | `{ bookingId: string, reason: string }` | `{ ok: true }` | `{ type: 'booking_cancel', bookingId, reason }` |
| `answerBookingQuery` | `{ bookingId: string, summary: string }` | `{ ok: true }` | `{ type: 'booking_query', bookingId, summary }` |

`resolveBookingTarget` is the disambiguation step. Given the user's phrasing ("the salon one", "my plumber tomorrow") and the bookings list, Gemini picks which booking. Returns `{ bookingId, summary }` so the agent can refer back to it in subsequent thoughts. If the phrasing is ambiguous (multiple matches) or no match, the tool returns an empty `bookingId` and the agent should emit `awaiting_user` asking for clarification.

`changes` on `proposeBookingChange` is intentionally narrow (`dayLabel`, `slot`, `scheduledTimestamp`, `status`) — these are the only Booking fields the agent is allowed to mutate. Reject anything else at the schema level. Add a Zod schema for the `changes` arg with those four optional fields.

### 4. Branch-specific agent prompts

Each branch (modify, cancel, query) needs its own system prompt for the agent node. Sketch:

- **modify_booking**: "Resolve which booking using `resolveBookingTarget`. Then determine what the user wants to change (time, slot, day). If they're rescheduling, compute the new `scheduledTimestamp`. Call `proposeBookingChange` with the changes + a 1-sentence reason."
- **cancel_booking**: "Resolve the target booking. Confirm intent via a thought (no awaiting_user — the user already said cancel). Call `proposeBookingCancellation` with a 1-sentence reason."
- **query_booking**: "Resolve the target booking. Generate a 2-3 sentence summary answering the user's question using the booking data. Call `answerBookingQuery` with the summary."

All three branches emit `thought` events between tool calls, same as new-booking.

### 5. Routing fallback

If `classify_intent` returns `'new_booking'` but bookings array is non-empty, that's fine — user just wants a new booking despite having old ones. Proceed.

If `classify_intent` returns one of the existing-booking labels but `bookings` is empty/missing, emit a `thought` like "User asked to modify a booking but I don't see any in their history" and fall through to `awaiting_user` with a "you don't have any bookings yet — would you like to make one?" message.

## Multi-turn for the modify/cancel/query branches

Same session/interrupt pattern as prompt 05. If `resolveBookingTarget` fails to disambiguate, agent emits `awaiting_user` with the question; FE replies with same `sessionId`, graph resumes.

## What stays the same

- Event ordering for new-booking flow: unchanged (from prompt 05).
- All existing event types remain valid.
- `src/data/*`, `src/lib/*`, `src/index.ts`, `src/routes/chat.ts` (apart from passing `bookings` through, which is already in place) — don't touch.
- `src/agent/events.ts` — don't add event types. `booking_update`, `booking_cancel`, `booking_query` are already there.

## Don't

- Don't store bookings server-side. The agent reads the bookings FE sent and emits intents — never writes to a DB.
- Don't allow the `changes` field on `proposeBookingChange` to mutate the booking's `id`, `provider`, `bookingId`, `createdAt`, or anything not in the allowlist (`dayLabel`, `slot`, `scheduledTimestamp`, `status`). Enforce via Zod, not just runtime checks.
- Don't add new event types. The three needed already exist in `events.ts`.
- Don't add an LLM-based "should we ask the user to confirm cancellation?" step. The user already said cancel — trust it. The FE will show a confirmation modal before applying.
- Don't touch the mobile app — the FE will be updated separately to consume `booking_update` / `booking_cancel` / `booking_query` events.

## Done when

1. `npm run typecheck` clean.
2. All prompt 04 + prompt 05 smoke tests still pass with no regressions.
3. New smoke tests pass:

**Test D — modify existing booking:**
```powershell
curl.exe -N -X POST http://localhost:5000/chat `
  -H "Content-Type: application/json" `
  -d '{\"message\":\"Reschedule my AC appointment to evening instead\",\"sessionId\":\"test-modify-001\",\"bookings\":[{\"id\":\"b001\",\"provider\":{...},\"slot\":\"10:00 AM\",\"dayLabel\":\"Tomorrow\",\"scheduledTimestamp\":...,\"status\":\"confirmed\"}]}'
```
Expected: `thought` (classifier reasoning) → `thought` (resolved booking) → `thought` (proposing change) → `booking_update` with `changes.slot` set to an evening slot. Stream closes.

**Test E — cancel existing booking:**
```powershell
curl.exe -N -X POST http://localhost:5000/chat `
  -H "Content-Type: application/json" `
  -d '{\"message\":\"cancel my plumber booking\",\"sessionId\":\"test-cancel-001\",\"bookings\":[{...plumber booking...}]}'
```
Expected: `thought`s → `booking_cancel` with reason. Stream closes.

**Test F — query existing booking:**
```powershell
curl.exe -N -X POST http://localhost:5000/chat `
  -H "Content-Type: application/json" `
  -d '{\"message\":\"when is my AC booking?\",\"sessionId\":\"test-query-001\",\"bookings\":[{...ac booking...}]}'
```
Expected: `thought`s → `booking_query` with a 2-3 sentence summary referencing the booking time and provider.

**Test G — ambiguous target (multi-turn):**
- Request 1: `{message: "reschedule my booking", bookings: [<two bookings>], sessionId: "test-ambig-001"}` → classifier picks modify → `resolveBookingTarget` returns empty → `awaiting_user` ("which booking?"). Stream closes.
- Request 2: `{message: "the AC one", sessionId: "test-ambig-001"}` → resume → resolves to AC booking → `booking_update`.

**Test H — modify intent with no bookings:**
- `{message: "cancel my appointment", bookings: []}` → `thought` + `awaiting_user` ("you don't have any bookings yet"). Doesn't crash.

4. The `changes` object on `booking_update` only ever contains keys from the allowed set (`dayLabel`, `slot`, `scheduledTimestamp`, `status`).
5. The FE's existing Booking shape from `apps/mobile/lib/stores/useBookingsStore.ts` parses cleanly through `BookingSchema`.

If the LangGraph routing API (conditional edges, branches) does something unexpected — bail and write a brief note at the top of `src/agent/graph.ts` rather than working around it silently.
