Hey — last server prompt. The submission rubric requires a README that documents system architecture, APIs/tools used, and assumptions/limitations. The current `apps/server/README.md` is the early stub from when we were planning a Python BE; needs a full rewrite covering what we actually built.

This is the server-specific README (not the project root README — I'll handle that separately). Target audience: a hackathon grader who has 5 minutes, plus a developer who needs to understand the agent design well enough to extend it.

## Required sections

Write these in order. Keep it scannable — use tables and short paragraphs over long prose. Code fences for commands. Markdown links to actual files in the repo.

### 1. Overview (2-3 sentences)

What this server is. Mention: agentic backend, Node + LangGraph + Gemini, stateless re: bookings, SSE-streamed agent trace. Don't repeat the marketing pitch from PROJECT.md — assume the reader has seen it.

### 2. Stack

A small table:

| Layer | Tech | Why |
|-------|------|-----|
| Runtime | Node 20 + TypeScript (strict) | ... |
| HTTP | Express 4 | ... |
| Agent | `@langchain/langgraph` | state-graph orchestration with tool binding, branch-specific agents, multi-turn interrupt/resume |
| LLM | Gemini 2.0 Flash via `@langchain/google-genai` | free-tier, multilingual (Urdu / Roman Urdu / English) |
| Validation | Zod | request and tool-input schemas |

Fill in the "Why" cells with one short reason each.

### 3. Project layout

A `tree`-style listing of `apps/server/src/`, with a one-line purpose per file. Auto-generate by reading the actual directory. Don't list `node_modules`, `dist`, or `.env`.

### 4. Local development

Setup steps as PowerShell commands. Be precise — don't omit `npm install` or env-var creation. Include:

```powershell
cd apps\server
copy .env.example .env
# then edit .env to fill GEMINI_API_KEY
npm install
npm run dev
```

Then a small block on what `npm run typecheck`, `npm run build`, `npm start` do.

### 5. API

Two endpoints — table format:

| Method | Path     | Body | Response |
|--------|----------|------|----------|
| GET    | `/health`| —    | `{ success, message, data: { status: 'ok' } }` |
| POST   | `/chat`  | see below | SSE stream of `AgentEvent` |

Then a sub-section "POST /chat — request body" with the actual shape (read [src/schemas/chat.ts](src/schemas/chat.ts) and [src/schemas/booking.ts](src/schemas/booking.ts) for the authoritative shape):

```ts
{
  message: string,            // user input, any language; trimmed; 1-2000 chars
  sessionId?: string,         // FE-generated UUID, one per chat thread
  defaultLocation?: string,   // sector from FE settings, e.g. 'G-13'
  bookings?: Booking[],       // FE's local bookings, sent every request
}
```

And "POST /chat — event stream" listing every `AgentEvent` type with shape + when it fires. Read [src/agent/events.ts](src/agent/events.ts) for the authoritative list. The vocabulary now includes both new-booking events (`understanding`, `searching`, `ranking`, `recommendation`, `awaiting_user`, `booking`, `confirmed`, `reminder_scheduled`) and the modify/cancel/query intents (`booking_update`, `booking_cancel`, `booking_query`), plus `thought` interleaved across all flows.

### 6. Agent architecture

This is the meat of the doc. Show the graph as a text diagram (block characters) matching the actual wiring in [src/agent/graph.ts](src/agent/graph.ts):

```
                       START
                         │
                         ▼
                  classify_intent
                         │
   ┌─────────────────────┼─────────────────────┬─────────────────────┐
   ▼                     ▼                     ▼                     ▼
new_booking         modify_booking        cancel_booking        query_booking
   │                     │                     │                     │
   ▼                     ▼                     ▼                     ▼
intent_extraction   modifyAgent ─┐       cancelAgent ─┐         queryAgent ─┐
   │                     │       │             │       │              │      │
   ▼                     ▼       │             ▼       │              ▼      │
 gate ──── awaiting_user tools ──┘           tools ────┘            tools ───┘
   │             │
   ▼             ▼
newBookingAgent ↔ tools
   │
   ▼
  END
```

Then explain each node in 1-2 sentences: `classify_intent` (Gemini structured-output routing to one of 4 flows), `intent_extraction` (service/location/time extraction for new bookings), `gate` (interrupts if any required field is missing), the four branch agent nodes, and the shared `tools` node (uses `routeAfterTools` to return to the calling branch's agent).

Then a "Tools" sub-section as a table, one row per tool, columns `Tool | Branch | Input | Output | Events emitted`. Read [src/agent/tools.ts](src/agent/tools.ts) for the authoritative list. The current set is:

- `searchProviders`, `rankByDistance`, `checkAvailability`, `confirmBooking`, `scheduleReminder` — new-booking
- `resolveBookingTarget` — shared across modify/cancel/query (reads bookings from session config, not args)
- `proposeBookingChange` — modify
- `proposeBookingCancellation` — cancel
- `answerBookingQuery` — query

Then a "Multi-turn (`awaiting_user`) flow" sub-section explaining: FE generates `sessionId`, BE keeps graph state per session via `MemorySaver`, sessions evict after 1h, request without `sessionId` is one-shot, interrupt/resume via `GraphInterrupt`. Two cases that trigger an interrupt:

1. `gate` detects missing service/location/time on a new booking.
2. `resolveBookingTarget` returns empty `bookingId` (ambiguous or no match) in modify/cancel/query.

### 7. State / persistence model

A short, explicit section explaining the stateless-re:-bookings design:
- The server does **not** persist bookings.
- The FE owns bookings in AsyncStorage.
- The FE sends its bookings on every `/chat` request as context — they're injected into `RunnableConfig.configurable.bookings` so tools and agent nodes can read them.
- The agent emits `booking_update` / `booking_cancel` / `booking_query` as *intents*; the FE validates and applies.
- The server only persists in-flight conversational state (LangGraph checkpoints per session) and evicts on idle.

This is unusual and rubric-relevant ("clean architecture" lives in the 10% technical impl bucket). Call out why: keeps the demo deployable and reproducible, no DB to provision, FE remains the source of truth.

### 8. Environment variables

Table:

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `PORT` | yes | — | HTTP port. Server exits if missing or invalid. |
| `TZ` | recommended | host default | Schedule math uses local time; set to `Asia/Karachi` for correct Pakistan timestamps. |
| `GEMINI_API_KEY` | yes | — | Google AI Studio key. Server exits on import if missing. |
| `GEMINI_MODEL_NAME` | yes | — | e.g. `gemini-2.0-flash`. Server exits on import if missing. |

### 9. Multilingual support

One paragraph: Gemini handles Urdu, Roman Urdu, English, and mixed natively — no translation layer. `awaiting_user` questions are currently English-only — known limitation.

### 10. Assumptions & limitations

Bullet list. Be honest. Include at minimum:
- Provider dataset is a curated 15-provider mock for Islamabad sectors only. No real Maps API integration.
- Reminder scheduling is an emitted intent; the FE schedules the actual local notification — no real push / SMS.
- Booking IDs are server-generated UUIDs; the server does not persist them. Trust boundary is at the FE.
- No authentication. Stub user is implicit (a single anonymous session).
- Sessions evict after 1 hour idle; multi-turn flows resume within that window.
- No rate limiting. In production, would need quota guards on the `/chat` endpoint (Gemini quota is the choke point).
- Conversation history is per-session only — there is no cross-session memory.
- `awaiting_user` clarifications are English-only.
- Timezone is hardcoded to `Asia/Karachi`. Multi-region would require a `sector → tz` lookup.
- `resolveBookingTarget` serializes the entire bookings payload (including all fields the FE sends) into a Gemini prompt for disambiguation. Acceptable for the mock dataset; would need redaction if real PII is added.
- Reminder offset is hardcoded to `'1 hour before'` in `scheduleReminder`. No user configurability yet.

### 11. How Antigravity is used

One paragraph, plain language. The substantive truth: Google Antigravity was used as the AI coding assistant that wrote the agent code (graph, tools, route handlers) from prescriptive prompts authored by the human developer. It is not a runtime orchestrator; the runtime is LangGraph + Gemini. Antigravity's role was the build-time assistant for feature implementation.

Link to `docs/antigravity-prompts/` for the actual prompt history that drove development.

## Voice / style

- Plain technical English. No marketing language ("powerful", "robust", "seamless").
- Active voice, present tense.
- Tables over prose where structured.
- Short paragraphs. No paragraph longer than 4 sentences.
- Link to actual files in the repo (e.g. `[events.ts](src/agent/events.ts)`).
- No emojis.

## Don't

- Don't write a project-overview README — that lives at the repo root and is out of scope for this prompt. This README is server-specific.
- Don't include the full text of `events.ts`, `tools.ts`, `graph.ts`, etc. Reference them by path; the reader can open the file.
- Don't invent capabilities. If a feature isn't in the code, it doesn't belong in the README.
- Don't include a "Future work" / "Roadmap" section. The Assumptions & Limitations section is enough.
- Don't include badges, banners, or logos.
- Don't document tools or events that don't exist. The authoritative lists are in [src/agent/tools.ts](src/agent/tools.ts) and [src/agent/events.ts](src/agent/events.ts) — match them.

## Done when

1. `apps/server/README.md` is fully rewritten covering sections 1-11 above.
2. Every file referenced in the README exists at the cited path (no stale links).
3. The "Tools" and "Events" tables match the actual code (no documented tools/events that don't exist; no missing ones).
4. The graph diagram matches the wiring in [src/agent/graph.ts](src/agent/graph.ts) (four branches, shared `tools` node, `routeAfterTools` returns to the right agent).
5. `npm run typecheck` and `npm run dev` still work (no accidental code changes).
6. Markdown renders cleanly in GitHub's preview (no broken tables, broken code fences, or unclosed links).
