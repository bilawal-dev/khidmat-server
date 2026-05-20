Hey — prompt 06 landed but the modify / cancel / query branches don't actually work end-to-end. The new-booking flow is fine; this prompt is a targeted fix-up for the three new branches and a couple of bits of debris from 06.

Read [graph.ts](../../apps/server/src/agent/graph.ts), [tools.ts](../../apps/server/src/agent/tools.ts), and [runAgent.ts](../../apps/server/src/agent/runAgent.ts) before you start — the bugs are all in those three files.

## Bug 1: The branch agents never see the user's bookings

The system prompts in `modifyAgent`, `cancelAgent`, and `queryAgent` say "resolve which booking using `resolveBookingTarget`" — but the bookings array is never injected into the system message. The LLM is being asked to reason about bookings it can't see.

Compounding it, `resolveBookingTarget` requires `bookings` as a tool argument (`schema: z.object({ bookings: z.array(z.any()), userPhrase: z.string() })`). The LLM can't supply something it never received in context, so it ends up calling the tool with `bookings: []` or hallucinated objects.

### Fix

**1a. `resolveBookingTarget` reads bookings from config, not from tool args.**

In `tools.ts`:
- Drop `bookings` from the tool's input schema. Keep only `userPhrase`.
- Inside the tool, read `bookings` from `config.configurable.bookings` (it's already injected there by `runAgent.ts`).
- Description should say: "Disambiguate which booking the user is referring to based on their phrasing. The bookings list is available implicitly from session context."

```ts
export const resolveBookingTarget = tool(
  async ({ userPhrase }, config) => {
    const bookings = (config.configurable?.bookings as Booking[]) || [];
    if (bookings.length === 0) return { bookingId: '', summary: 'No bookings available.' };
    // ... existing Gemini disambiguation logic, unchanged
  },
  {
    name: 'resolveBookingTarget',
    description: 'Disambiguate which booking the user is referring to based on their phrasing. The active bookings list is available implicitly from session context.',
    schema: z.object({
      userPhrase: z.string(),
    }),
  }
);
```

**1b. Each branch agent's system prompt includes a compact summary of the bookings.**

Don't paste raw JSON — render a short text summary the LLM can scan. Example helper:

```ts
function bookingsSummary(bookings: Booking[]): string {
  if (!bookings.length) return '(no bookings)';
  return bookings.map((b, i) =>
    `${i + 1}. id=${b.id} | ${b.category} with ${b.providerName} | ${b.scheduledFor} | status=${b.status}`
  ).join('\n');
}
```

Then in `modifyAgent`, `cancelAgent`, `queryAgent`:

```ts
const sysMsg = new SystemMessage(`You are a helpful AI orchestrator [...modifying/canceling/answering...].
The user's active bookings:
${bookingsSummary(bookings)}

Use resolveBookingTarget with the user's phrasing to pick the right one. [...rest of branch-specific instructions...]`);
```

The empty-bookings guard at the top of each branch agent (line 163, 189, 215) stays as-is.

## Bug 2: Branch agents don't pause when the target is ambiguous

Test G needs the graph to pause and ask "which booking?" when `resolveBookingTarget` returns `{ bookingId: '' }`. Right now nothing pauses — the agent loop just runs to END, the FE sees the stream close, and there's nothing to resume.

### Fix

After the LLM responds in `modifyAgent` / `cancelAgent` / `queryAgent`, check the last tool result in the message history. If the most recent `resolveBookingTarget` returned an empty `bookingId`, emit an `awaiting_user` and `interrupt()` so the session pauses for clarification.

Concretely — add this logic after `modifyModel.invoke(...)` (and same for cancel/query):

```ts
const response = await modifyModel.invoke([sysMsg, ...state.messages]);
// ... existing thought-emission ...

// Detect ambiguous-target case: last tool result was resolveBookingTarget with empty bookingId
const lastTool = [...state.messages].reverse().find(m => m.getType() === 'tool') as ToolMessage | undefined;
if (lastTool && lastTool.name === 'resolveBookingTarget') {
  const parsed = typeof lastTool.content === 'string' ? JSON.parse(lastTool.content) : lastTool.content;
  if (!parsed.bookingId) {
    queue.push({
      type: 'awaiting_user',
      missing: 'service',
      question: response.content && typeof response.content === 'string'
        ? response.content
        : 'Which booking did you mean?',
    });
    interrupt('Ambiguous target');
  }
}

return { messages: [response] };
```

Import `ToolMessage` from `@langchain/core/messages`. `'Ambiguous target'` is just the interrupt label — `GraphInterrupt` is what `runAgent.ts` catches, so the string doesn't matter functionally.

Note: `awaiting_user.missing` is typed as `'location' | 'time' | 'service'` in [events.ts](../../apps/server/src/agent/events.ts). None of those fit "which booking", but `'service'` is the least wrong placeholder for now — see Bug 3 below for the broader question of whether to widen that union. For this prompt, just use `'service'` and we'll revisit `missing` shape separately.

## Bug 3: Catch-all `awaiting_user` fires for closing messages

[graph.ts:152-154](../../apps/server/src/agent/graph.ts#L152-L154) (and the three branch-agent equivalents) push `{ type: 'awaiting_user', missing: 'service', question: response.content }` whenever the LLM responds with content but no tool calls. That misclassifies normal closing messages — "Your booking is confirmed for tomorrow 10 AM" gets sent to the FE as `awaiting_user`, which is wrong on two counts: the agent isn't waiting, and `missing: 'service'` is meaningless there.

### Fix

Delete the catch-all in all four agent nodes (`newBookingAgent`, `modifyAgent`, `cancelAgent`, `queryAgent`). The block to remove looks like:

```ts
if (!response.tool_calls?.length && response.content) {
  queue.push({ type: 'awaiting_user', missing: 'service', question: response.content as string });
}
```

After the deletion, `awaiting_user` is only emitted from places that *know* they're pausing:
- `gate` (missing service/location/time in new-booking)
- empty-bookings guards (in modify/cancel/query)
- the ambiguous-target case from Bug 2

The closing AI message still arrives at the FE via the `thought` event already pushed at lines 148-150 (and equivalents). That's the right surface for closing narration.

## Bug 4: String-match interrupt fallback left in

[runAgent.ts:39](../../apps/server/src/agent/runAgent.ts#L39) still has the third fallback:

```ts
if (err && (err instanceof GraphInterrupt || err.name === 'GraphInterrupt' || err.message === 'Missing fields')) {
```

Drop the `err.message === 'Missing fields'` clause. `GraphInterrupt` (instance or name) is enough — the new branch interrupts use different labels ('Missing bookings', 'Ambiguous target') and the message-string check no longer covers them anyway.

## Bug 5 (cleanup): Dead routing helper

[graph.ts:273-279](../../apps/server/src/agent/graph.ts#L273-L279) defines `routeFromStart` but nothing wires it — `START → classifyIntent` is set via plain `addEdge`. Delete the function.

## Don't

- Don't change `BookingSchema`, `ChatRequestSchema`, or any event types.
- Don't touch `gate` or the new-booking flow's `newBookingAgent` system prompt — only delete the Bug-3 catch-all from `newBookingAgent`.
- Don't add bookings as a `tool` input to `proposeBookingChange` / `proposeBookingCancellation` / `answerBookingQuery` — they already work with just `bookingId` + payload.
- Don't introduce a new `awaiting_user.missing` enum value yet. Use `'service'` as the placeholder for the ambiguous-target case; we'll widen the type in a later pass if needed.

## Done when

1. `npm run typecheck` clean.
2. Re-run smoke tests D, E, F, G from prompt 06.
   - **D (modify)**: `thought` (classifier) → `thought` (resolved booking) → `thought` (proposing change) → `booking_update` with `changes.slot` set. Stream closes cleanly, no spurious `awaiting_user`.
   - **E (cancel)**: `thought`s → `booking_cancel`. No spurious `awaiting_user`.
   - **F (query)**: `thought`s → `booking_query` with 2-3 sentence summary.
   - **G (ambiguous)**: Request 1 → `awaiting_user` ("which booking?"), stream closes. Request 2 with same `sessionId` ("the AC one") → resumes, emits `booking_update`.
3. Existing new-booking tests (from prompts 04 and 05) still pass with no regression. In particular: a successful booking ends with `confirmed` + `reminder_scheduled`, NOT a trailing `awaiting_user`.
4. `resolveBookingTarget` no longer requires `bookings` as a tool argument — only `userPhrase`. The bookings come from session config.
5. `runAgent.ts` no longer references the string `'Missing fields'`.
