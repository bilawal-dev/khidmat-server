Hey — prompt 04's skeleton works, but it's a straight-line pipeline pretending to be an agent. The rubric scores **agentic reasoning** (20%) and **matching quality** (20%) on whether there's *visible reasoning and actual tool use*, not labeled state transitions. A grader watching the current trace sees `searching → ranking → recommendation` and reads it as a hardcoded function chain with telemetry. We need a real LangGraph state machine where the LLM holds tools, decides what to call, and narrates its reasoning as it goes. Same FE event contract, totally different internals.

Also adding **multi-turn clarification**: right now `awaiting_user` closes the stream and the conversation dies. With session-aware graph state, the next request with the same `sessionId` resumes from where it stopped.

## What I already changed (don't redo)

- `src/agent/events.ts` — added one new event type: `{ type: 'thought'; text: string }`. This is the agent's internal reasoning, emitted between tool calls. The FE will render these as italicized bubbles later.
- `src/lib/gemini.ts` — `temperature: 0`, reads `GEMINI_MODEL_NAME` from env.
- `src/data/providers.ts` — exports `SERVICE_CATEGORIES` as a `const` tuple; `ServiceCategory` is derived from it. Use `SERVICE_CATEGORIES` everywhere you'd otherwise hardcode the category list.
- `src/routes/chat.ts` — already cancels the generator on client disconnect; you'll need to pass `sessionId` through to `runAgent` (small edit, not a rewrite).

## Architecture — replace `src/agent/runAgent.ts` with a LangGraph

Create these new files:
- **`src/agent/graph.ts`** — the LangGraph definition + compiled graph.
- **`src/agent/tools.ts`** — the tool definitions.
- **`src/agent/sessions.ts`** — `Map<sessionId, { config: RunnableConfig }>` for resume.
- **`src/agent/runAgent.ts`** — rewrite. Still exports `async function* runAgent(input)` yielding `AgentEvent`. The internals now drive the graph and proxy events out.

### Graph flow

```
START
  │
  ▼
intent_extraction   ← gemini.withStructuredOutput, extracts {service, location, time}
  │                   emits: understanding
  │
  ▼
gate                ← if any field missing (after defaultLocation fallback),
  │                   emit awaiting_user, then interrupt() the graph.
  │                   Resume merges the next user message + re-extracts.
  │                   Also validates sector exists in SECTOR_COORDS.
  │
  ▼
agent (loop)        ← LLM with tools bound. Decides which tool to call.
  │                   Emits 'thought' events as it reasons.
  │
  ▼
tool_executor       ← Runs the chosen tool. Tools push their own events into the
  │  ▲                event sink. Loop back to agent until LLM signals done.
  │  │
  └──┘
  │
  ▼
END
```

### Tools — define in `src/agent/tools.ts`

Each tool is `tool({ name, description, schema, func })` from `@langchain/core/tools`. Each tool, on execution, pushes one or more `AgentEvent`s into the event sink (see "Event plumbing" below).

| Tool | Input | Output | Events pushed |
|------|-------|--------|---------------|
| `searchProviders` | `{ category: ServiceCategory, sector: string }` | `Provider[]` | `{ type: 'searching', near: sector, category }` |
| `rankByDistance` | `{ providers: Provider[], fromSector: string }` | `{ provider: Provider, distanceKm: number }[]` | `{ type: 'ranking', candidateCount: N }` |
| `checkAvailability` | `{ providerId: string, dayLabel: string, slotPreference: 'morning'\|'afternoon'\|'evening'\|'any' }` | `{ slot: string, scheduledTimestamp: number } \| null` | (none — internal lookup) |
| `confirmBooking` | `{ providerId, slot, dayLabel, scheduledTimestamp, distanceKm, reasoning }` | `{ bookingId: string }` | `{ type: 'recommendation', provider, distanceKm, reasoning, suggestedSlot: slot, dayLabel, scheduledTimestamp }`, then `{ type: 'booking', provider, slot }`, then `{ type: 'confirmed', bookingId: crypto.randomUUID() }` |
| `scheduleReminder` | `{ bookingId: string, scheduledTimestamp: number }` | `{ at: string, atTimestamp: number }` | `{ type: 'reminder_scheduled', at }` |

Reuse the heuristic time parser + haversine from the current `runAgent.ts` — port them into helpers used by the relevant tools. Don't throw away working code; the LLM doesn't need to do math.

### The reasoning narrative (rubric-critical)

The `confirmBooking` tool takes a `reasoning` string. **The LLM is responsible for generating that string** — a 2-3 sentence narrative comparing the top picks. Example:

> *"Picked Ali AC Services — closest to G-13 at 0.2 km, 4.7★ from 124 reviews. CoolFix is rated similarly (4.5★) but 7 km away in F-10. Khan Cooling is closer than CoolFix but rated 0.4★ lower."*

The agent node's system prompt should explicitly instruct: "Before calling `confirmBooking`, look at the ranked list you got from `rankByDistance` and write a 2-3 sentence reasoning that compares the top pick against the alternatives. Pass that string as the `reasoning` arg."

This is the single biggest scoring lever in the rewrite. Don't skip it.

### `thought` events

Between tool calls, emit the LLM's reasoning as `thought` events. The simplest way: after the agent node produces an AIMessage with `.tool_calls`, inspect `message.content` — if there's text, push it as `{ type: 'thought', text }` before executing the tool.

System prompt should tell the LLM: "Before each tool call, briefly state in 1 sentence what you're about to do and why." This gives natural thought events without weird prompting.

Target: at minimum 2-3 `thought` events per happy-path request. More is fine.

### Event plumbing — how tools yield to SSE

Tools are async functions and can't directly yield to the route handler's SSE stream. Use an event queue.

Pattern:
```ts
// src/agent/eventQueue.ts (new)
export class EventQueue {
  private events: AgentEvent[] = [];
  private resolvers: Array<(e: IteratorResult<AgentEvent>) => void> = [];
  private done = false;

  push(event: AgentEvent) { /* ... */ }
  end() { /* ... */ }
  async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> { /* ... */ }
}
```

`runAgent` creates a queue, passes it into the graph state (or via a closure into the tool factories), spawns graph execution as a side-task, and yields from the queue. When graph finishes or hits `interrupt()`, call `queue.end()`.

There's probably a more idiomatic LangGraph way (custom channels, `streamEvents()`), but the queue pattern is straightforward and explicit. Your call — if you find a cleaner LangGraph-native approach, take it.

### Sessions + multi-turn

- `src/agent/sessions.ts` exports a `Map<string, RunnableConfig>` and helpers `getOrCreateSession(sessionId)` and `evictOldSessions()`.
- The graph is compiled once at module load with a `MemorySaver` checkpointer. Sessions distinguish by `thread_id` in the runnable config: `{ configurable: { thread_id: sessionId } }`.
- **The FE generates `sessionId` client-side** (one UUID per chat thread). BE never assigns IDs. If a request comes without `sessionId`, create a new thread_id and process as a fresh conversation (one-shot, no resume possible). Document this in a code comment so future-you remembers.
- Session eviction: if a session hasn't been touched in 1 hour, drop it. Simple `setInterval` cleanup at module load.

Resume flow:
1. Request arrives with `sessionId: "abc"`, `message: "F-7, tomorrow morning"`.
2. `runAgent` looks up `sessions.get("abc")` — finds existing config.
3. Graph resumes via `graph.invoke({ messages: [...new HumanMessage] }, config)` — LangGraph re-enters the interrupted node with the new input.
4. Events flow out as before.

If `sessionId` is given but no session is in the map (evicted/expired), treat as new session and warn via an SSE `{ type: 'error', message: 'Session expired, starting over' }` before the normal flow.

## What stays the same (contract for the FE)

- All existing `AgentEvent` types remain valid; tools must emit them at the right moments with correct shapes.
- Happy-path event ordering: `thought*` → `understanding` → `thought*` → `searching` → `thought*` → `ranking` → `thought*` → `recommendation` → `booking` → `confirmed` → `reminder_scheduled`.
- `awaiting_user` events still close the stream; resume happens via new request with same `sessionId`.
- `src/agent/events.ts` — `thought` is the only new type. **Don't add more event types in this prompt.** If you think you need one, stop and flag it.
- `src/data/*`, `src/lib/sse.ts`, `src/lib/gemini.ts`, `src/lib/responseHandler.ts`, `src/index.ts`, `src/schemas/chat.ts` — don't touch.

## Don't

- **Don't add tool_call / tool_result event types.** The tools themselves emit human-facing events (`searching`, `ranking`, etc.). The FE doesn't need a parallel tool-call stream.
- **Don't replace the heuristic time parser with another LLM call.** Port it into `checkAvailability`. Heuristics are deterministic and free.
- **Don't store bookings server-side.** `confirmBooking` generates a `bookingId` and emits events; FE persists. Server is stateless re: bookings.
- **Don't add a database, vector store, retry logic, or caching layer.**
- **Don't touch the mobile app** (`apps/mobile/`). The FE's `events.ts` will need to mirror the `thought` addition later — that's a separate FE task.
- **Don't implement `booking_update` / `booking_cancel` / `booking_query`.** Those event types exist as forward declarations; the modify/cancel/query flows are prompt 06.
- **Don't add an intent classifier branching new-booking vs modify vs cancel.** Treat every request as a new-booking flow. Prompt 06 adds the classifier on top.

## Done when

1. `npm run typecheck` clean.
2. `npm run dev` boots on `:8000`, `/health` still works.
3. The 3 smoke tests from prompt 04 still pass with the same overall event ordering (plus `thought` events interleaved):
   - Test A (Roman Urdu, G-13 AC) → recommends Ali AC Services
   - Test B (English, F-7 plumber) → recommends Sajid Plumbing
   - Test C (missing service) → `understanding` + `awaiting_user`, stream closes
4. A new multi-turn test passes:
   - Request 1: `{"message": "I need a plumber", "sessionId": "test-multi-001"}` → `thought`s + `understanding` + `awaiting_user` (missing: location), stream closes.
   - Request 2: `{"message": "F-7, tomorrow morning", "sessionId": "test-multi-001"}` → graph resumes; emits `thought`s + `searching` + `ranking` + `recommendation` (Sajid Plumbing) + `booking` + `confirmed` + `reminder_scheduled`.
5. The `recommendation.reasoning` field is a 2-3 sentence narrative comparing top picks — not the old template `"Closest available, ${rating}★ rating, ${years} years experience"`.
6. At least 2 `thought` events are emitted in the happy-path flow.
7. Every event matches its declared shape in `src/agent/events.ts`. No extra fields, no missing required fields.
8. Stale session (an unknown `sessionId`) doesn't crash — emits an `error` event, then runs as new session.

PowerShell test command (re-use from prompt 04 — `curl.exe -N -X POST ...`).

If `@langchain/langgraph` JS APIs surprise you — `interrupt()`, `MemorySaver`, tool-binding for Gemini, etc. — write what you tried in a brief note at the top of `src/agent/graph.ts` and bail cleanly rather than working around silently. Prefer the LangGraph JS docs over Python-translated patterns; they diverge.
