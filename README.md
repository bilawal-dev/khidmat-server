# Khidmat — Server

Agentic backend for the Khidmat AI service orchestrator. Takes a natural-language request, classifies the user's intent, runs a LangGraph state machine with Gemini-backed tools, and streams the trace back to the mobile client as Server-Sent Events.

Stateless re: bookings — the mobile app is the source of truth. The server emits `booking_update` / `booking_cancel` / `booking_query` events as *intents*; the FE validates and applies them.

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Node 20 + TypeScript (strict) |
| HTTP | Express 4 |
| Agent | `@langchain/langgraph` (state-graph orchestration, multi-turn interrupt/resume) |
| LLM | Gemini 2.0 Flash via `@langchain/google-genai` |
| Validation | Zod |

## Project layout

```
src/
├── agent/
│   ├── config.ts           typed accessors for the RunnableConfig bag
│   ├── eventQueue.ts       producer/consumer queue feeding SSE
│   ├── events.ts           AgentEvent wire contract (mirrors mobile)
│   ├── graph.ts            LangGraph: classify → branch agents → tools
│   ├── prompts.ts          classifier / extraction / flow system prompts
│   ├── runAgent.ts         AsyncGenerator bridging graph events → SSE
│   ├── sessions.ts         in-memory thread state with 1h idle eviction
│   └── tools.ts            9 tools across new-booking / modify / cancel / query
├── config/
│   ├── constants.ts        named tuning knobs (earth radius, reminder lead, TTLs)
│   └── env.ts              validated environment config (fails fast on boot)
├── data/
│   ├── providers.ts        15-entry mock provider catalog (Islamabad)
│   └── sectors.ts          sector → lat/lng + base-sector resolver
├── lib/
│   ├── bookings.ts         booking-list summary for the flow prompts
│   ├── gemini.ts           Gemini client singleton
│   ├── geo.ts              haversine distance (pure, testable)
│   ├── logger.ts           timestamped, levelled [server] logger
│   ├── requestLogger.ts    per-request method/status/duration logging
│   ├── responseHandler.ts  standard JSON response helpers
│   ├── sse.ts              SSE headers + writeEvent / writeError
│   └── time.ts             slot/day parsing helpers (pure, testable)
├── routes/
│   ├── categories.ts       GET /categories (directory overview)
│   ├── chat.ts             POST /chat
│   ├── providers.ts        GET /providers (search/browse directory)
│   ├── sectors.ts          GET /sectors (browse areas covered)
│   └── stats.ts            GET /stats (whole-directory totals)
├── schemas/
│   ├── booking.ts          Booking shape + BOOKING_STATUSES (lockstep with mobile)
│   ├── chat.ts             /chat request shape
│   └── common.ts           shared Zod pieces (ServiceCategoryEnum)
└── index.ts                Express bootstrap + graceful shutdown
```

## Local development

Prerequisites: Node 20, npm, a Gemini API key from [Google AI Studio](https://aistudio.google.com/).

```powershell
cp .env.example .env
# Edit .env — set GEMINI_API_KEY
npm install
npm run dev
```

Server starts on `http://localhost:5000` by default.

### Scripts

| Script | What |
|--------|------|
| `npm run dev` | `tsx watch` — auto-reloads on change |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | `node:test` unit suite (geo, time, sectors, bookings, constants, sse, responseHandler, parseList, parsePort, prompts, logger) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled `dist/index.js` |

## Environment variables

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `PORT` | yes | — | HTTP port. Server exits if missing or invalid. |
| `TZ` | recommended | host default | Schedule math uses local time; set to `Asia/Karachi` for correct Pakistan timestamps. |
| `GEMINI_API_KEY` | yes | — | Google AI Studio key. |
| `GEMINI_MODEL_NAME` | yes | — | e.g. `gemini-2.0-flash`. |
| `CORS_ORIGINS` | no | all origins | Comma-separated CORS allowlist. Unset = permissive. |

All required vars are validated once on boot in [src/config/env.ts](src/config/env.ts); the server fails fast with a clear message if any is missing or invalid.

## API

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ success: true, message: 'Health Check Passed', data: { status: 'ok', uptimeSeconds } }` |
| GET | `/stats` | — | `{ success, message, data: { totalProviders, totalCategories, sectorsCovered, avgRating, cheapestFrom } }` |
| GET | `/sectors` | — | `{ success, message, data: { count, sectors } }` — per-sector provider count, coords, categories |
| GET | `/categories` | — | `{ success, message, data: { count, categories } }` — per-category count, mean rating, entry price |
| GET | `/providers` | — | `{ success, message, data: { count, providers } }` — see below |
| GET | `/providers/:id` | — | `{ success, message, data: { provider } }` (404 when unknown) |
| GET | `/providers/:id/similar` | — | `{ success, message, data: { count, providers } }` — same-category nearby alternatives (404 when unknown) |
| GET | `/providers/:id/slots` | — | `{ success, message, data: { count, slots } }` — slots as `{ display, normalized, minutes }`, time-sorted (404 when unknown) |
| POST | `/chat` | see below | SSE stream of `AgentEvent` |

### `GET /providers` query parameters

All optional; filters are ANDed.

| Param | Values | Effect |
|-------|--------|--------|
| `category` | `ac` \| `plumber` \| `electrician` \| `tutor` \| `beautician` | Restrict to one service category. |
| `q` | free text | Case-insensitive match against provider name, category, and sector. |
| `near` | sector, e.g. `G-13` | Annotate each result with `distanceKm` and default ordering to nearest-first. |
| `maxPrice` | number | Keep only providers whose lowest tier is at or below this ceiling. |
| `availableAt` | time, e.g. `2pm`, `14:00` | Keep only providers offering a slot at that time (format-tolerant). |
| `minRating` | 0–5 | Keep only providers rated at or above this. |
| `minExperience` | ≥ 0 | Keep only providers with at least this many years of experience. |
| `sortBy` | `distance` \| `rating` \| `experience` \| `price` | Ordering (defaults to `distance` when `near` is set, else `rating`). |
| `limit` | 1–50 | Page size. |
| `offset` | ≥ 0 | Items to skip (for paging). Response includes `total`, `offset`, and `hasMore`. |

### `POST /chat` request body

```ts
{
  message: string,            // user input, any language; 1-2000 chars
  sessionId?: string,         // FE-generated UUID per chat thread
  defaultLocation?: string,   // sector from FE settings, e.g. 'G-13'
  bookings?: Booking[],       // FE's persisted bookings, sent every request
}
```

Booking shape: [src/schemas/booking.ts](src/schemas/booking.ts).

### `POST /chat` event stream

All events declared in [src/agent/events.ts](src/agent/events.ts).

| Event | When |
|-------|------|
| `thought` | Agent narration, interleaved across all flows |
| `understanding` | Extracted service / location / time for a new booking |
| `searching` | Looking up providers by category and sector |
| `ranking` | Scoring candidates by haversine distance and rating |
| `recommendation` | Top pick with reasoning + suggested slot |
| `awaiting_user` | Pause and ask; resend with same `sessionId` to resume |
| `booking` | Selecting provider + slot |
| `confirmed` | Booking ID generated |
| `reminder_scheduled` | Reminder offset set |
| `booking_update` | Intent: mutate an existing booking |
| `booking_cancel` | Intent: cancel an existing booking |
| `booking_query` | Intent: answer a question about an existing booking |

## Agent architecture

`classify_intent` (Gemini structured-output) routes each request into one of four branches:

- **new_booking** → `intent_extraction` → `gate` (interrupts if service/location/time missing) → `newBookingAgent` ↔ `tools`
- **modify_booking** → `modifyAgent` ↔ `tools`
- **cancel_booking** → `cancelAgent` ↔ `tools`
- **query_booking** → `queryAgent` ↔ `tools`

Each branch has its own bound toolset and system prompt. The shared `tools` node executes the call and `routeAfterTools` returns to the calling branch's agent.

### Tools

Defined in [src/agent/tools.ts](src/agent/tools.ts).

| Tool | Branch | Emits |
|------|--------|-------|
| `searchProviders` | new | `searching` |
| `rankByDistance` | new | `ranking` |
| `checkAvailability` | new | — |
| `confirmBooking` | new | `recommendation`, `booking`, `confirmed` |
| `scheduleReminder` | new | `reminder_scheduled` |
| `resolveBookingTarget` | modify, cancel, query | — |
| `proposeBookingChange` | modify | `booking_update` |
| `proposeBookingCancellation` | cancel | `booking_cancel` |
| `answerBookingQuery` | query | `booking_query` |

### Multi-turn

Sessions are keyed by `sessionId` and held in memory by LangGraph's `MemorySaver`, evicted after 1 hour idle. The graph pauses (via `GraphInterrupt`) in two cases:

1. `gate` detects missing fields on a new booking.
2. `resolveBookingTarget` returns an empty `bookingId` (ambiguous or no match) in modify / cancel / query.

In both cases the FE receives `awaiting_user` and resumes by re-posting with the same `sessionId`.

## State / persistence

The server **does not persist bookings**. The FE owns them in AsyncStorage and sends the array on every `/chat` request. The array is injected into `RunnableConfig.configurable.bookings` so tools and agent nodes can read it. The agent emits booking mutations as intents; the FE validates and applies them.

Only in-flight conversational state (LangGraph checkpoints per session) is persisted, and that's in-memory and idle-evicted. No database required.

## Multilingual

Gemini handles Urdu, Roman Urdu, English, and mixed-language inputs natively. `awaiting_user` clarifications are English-only — known limitation.

## Limitations

- 15-entry mock provider catalog for Islamabad sectors only. No real Maps API integration.
- Reminders are emitted as intents; the FE schedules the local notification. No push/SMS infra.
- No authentication; single anonymous session.
- No rate limiting. Gemini quota is the choke point.
- Sessions evict after 1h idle; multi-turn flows resume within that window only.
- Timezone hardcoded to `Asia/Karachi`. Multi-region would need a `sector → tz` lookup.
- `resolveBookingTarget` serializes the full bookings payload into a Gemini prompt for disambiguation. Acceptable for mock data; would need redaction if real PII were added.
- Reminder offset is hardcoded to `1 hour before`.

## How Antigravity was used

Google Antigravity was the AI coding assistant that wrote the agent code (graph, tools, route handlers, schemas) from prescriptive prompts authored by the developer. Build-time only — Antigravity is not part of the runtime; the runtime is LangGraph + Gemini. Prompt history: [docs/antigravity-prompts/](docs/antigravity-prompts/).
