Hey — scaffolded the BE base in `apps/server/` just now. What's already there:

- `package.json` — Node + TypeScript + Express 4 + Zod + `@langchain/google-genai` + `@langchain/langgraph` (we'll use the graph lib in the next prompt, not this one).
- `tsconfig.json` — strict, CommonJS, target ES2022.
- `.env.example` — `PORT=8000`, `GEMINI_API_KEY=`.
- `src/index.ts` — minimal Express bootstrap, `GET /health` returning `{ status: 'ok' }`. That's it.
- `src/data/providers.ts` — 15 providers, ported verbatim from `apps/mobile/lib/mock/providers.ts`. **Do not mutate.**
- `src/data/sectors.ts` — `SECTOR_COORDS` lookup for Islamabad sectors.
- `src/agent/events.ts` — **the wire contract** between server and mobile. The FE's `app/(tabs)/index.tsx` consumes these exact shapes. Don't rename or add fields without flagging it.

Your job for this prompt: wire up `POST /chat` end-to-end so the mobile app can hit it and start receiving events. Just the **happy-path new-booking flow** — straight-line code, single pass. **No LangGraph yet** (next prompt). **No multi-turn resume** (next prompt). **No booking modify/cancel/query** (prompt after that). Smallest possible slice that proves FE↔BE works.

## Build, in this order

**1. `src/lib/sse.ts`** — tiny SSE helper.
- Export `writeEvent(res: Response, event: AgentEvent)` that writes `data: ${JSON.stringify(event)}\n\n`.
- Export `initSSE(res: Response)` that sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, and calls `res.flushHeaders()`.

**2. `src/lib/gemini.ts`** — Gemini client singleton.
- Use `ChatGoogleGenerativeAI` from `@langchain/google-genai`.
- Model: `gemini-2.0-flash` (fast + generous free tier).
- Read `GEMINI_API_KEY` from `process.env`. Throw on import if missing — fail loudly, not lazily.
- Export the instance as `gemini`.

**3. `src/schemas/chat.ts`** — Zod schema for the POST body:
```ts
{
  message: string,            // user input, any language
  sessionId?: string,         // not used this prompt, validate-only
  defaultLocation?: string,   // sector from FE Settings, e.g. 'G-13'
  bookings?: unknown[],       // FE's local bookings; ignore this prompt (loose array OK)
}
```
Export both the Zod schema and the inferred TS type.

**4. `src/agent/runAgent.ts`** — `async function* runAgent(input): AsyncGenerator<AgentEvent>`.

The pipeline:

a. **Intent extraction.** Call `gemini.withStructuredOutput(IntentSchema).invoke([...])` where `IntentSchema` is a Zod schema for `{ service, location, time }`. System prompt should:
   - Tell the model the user message may be Urdu, Roman Urdu, English, or mixed — handle all natively, no translation step.
   - List the 5 valid `service` values from `ServiceCategory`. If none match, return `null`.
   - For `location`: extract any sector mentioned (e.g. "G-13", "F-10"); return `null` if not specified.
   - For `time`: extract any time reference ("kal subah", "tomorrow morning", "tonight", "next Monday at 4pm"); return `null` if not specified.

b. **Yield `understanding`** with the extracted fields. If `location` was null and `defaultLocation` is set, fill it from default and set `usedDefaultLocation: true`.

c. **Gate on required fields.** In priority order:
   - If `service` is null → yield `awaiting_user` (`missing: 'service'`, question: "What service do you need? (AC repair, plumber, electrician, tutor, beautician)") and **return**.
   - If `location` is still null → yield `awaiting_user` (`missing: 'location'`, question asking which sector) and **return**.
   - If `time` is null → yield `awaiting_user` (`missing: 'time'`, question: "When do you need this?") and **return**.
   - (This prompt does NOT handle resume after `awaiting_user` — just close the stream. Next prompt adds resume.)

d. **Yield `searching`** with `near: location, category: service`.

e. **Filter providers** by category. If empty → yield `awaiting_user` with `missing: 'service'` and a "no providers for that category in our dataset, try another" message, then return.

f. **Rank candidates.** For each candidate, compute haversine distance from `SECTOR_COORDS[location]` to `provider.coords`. Sort by `(distance asc, rating desc)`. Yield `ranking` with `candidateCount`.

g. **Resolve schedule.**
   - From the `time` string ("tomorrow morning", "kal subah", "Monday at 4pm"), derive:
     - `dayLabel`: `'Today'`, `'Tomorrow'`, or weekday name like `'Monday'`.
     - `daysOffset`: 0, 1, 2, ...
     - `slotPreference`: morning/afternoon/evening/specific-time-string.
   - This is small enough to do with another Gemini structured call OR a hardcoded heuristic — your call. Heuristic is fine and faster; Gemini is more robust to weird inputs. Pick one.
   - Pick the top provider's first `availableSlot` that loosely matches `slotPreference` (morning = before 12 PM, afternoon = 12–5 PM, evening = after 5 PM). If no match, pick the first slot.
   - Compute `scheduledTimestamp`: `Date.now() + daysOffset * 86400000`, then set hours/minutes from the picked slot.

h. **Yield `recommendation`** with the top provider, distance (km, 1 decimal), a human-readable `reasoning` string ("Closest available, 4.7★ rating, 8 years experience"), `suggestedSlot`, `dayLabel`, `scheduledTimestamp`.

i. **Yield `booking`** (`provider`, `slot`).

j. **Yield `confirmed`** with `bookingId: crypto.randomUUID()`.

k. **Yield `reminder_scheduled`** with `at`: a human-readable string like `"1 hour before"` (the FE schedules the actual local notification — we just declare intent).

**5. `src/routes/chat.ts`** — Express handler:
- Zod-validate the body. On fail: `res.status(400).json({ error: ... })`.
- Call `initSSE(res)`.
- `for await (const event of runAgent(input))` → `writeEvent(res, event)`.
- On any thrown error mid-stream: write one event `{ type: 'error', message: String(err) }` (this is NOT in `AgentEvent` — the FE will treat unknown types as no-ops, which is fine for now), then `res.end()`.
- Handle client disconnect: `req.on('close', () => { /* nothing to clean up yet */ })`.

**6. `src/index.ts`** — mount the route:
```ts
import { chatRouter } from './routes/chat';
app.use('/chat', chatRouter);
```

## Don't

- Don't add LangGraph. It's installed but unused this prompt — leave it alone.
- Don't add session storage / a `Map<sessionId, ...>`. Next prompt.
- Don't implement `booking_update`, `booking_cancel`, `booking_query` events. They exist in `events.ts` as a forward declaration; we'll wire them up in prompt 06.
- Don't add compression middleware — it breaks SSE.
- Don't tighten CORS — `app.use(cors())` is fine for dev.
- Don't write tests.
- Don't touch the FE (`apps/mobile/`). It's already wired to consume these events from its mock; the real swap to `EXPO_PUBLIC_API_BASE_URL` happens in a later integration step, not yours.
- Don't mutate `src/data/providers.ts` or `src/agent/events.ts`. If you genuinely need a field that's missing, stop and flag it instead of adding it silently.

## Done when

1. `npm install` in `apps/server/` runs clean.
2. `npm run typecheck` clean.
3. `npm run dev` boots on `http://localhost:8000` (or whatever `PORT` is set to in `.env`).
4. `Invoke-RestMethod -Uri http://localhost:8000/health` returns `{ status: 'ok' }`.
5. Three smoke tests pass (PowerShell — use `curl.exe` not the `curl` alias, since the alias is `Invoke-WebRequest` which buffers SSE):

   **Test A — Roman Urdu, full intent, default location:**
   ```powershell
   curl.exe -N -X POST http://localhost:8000/chat `
     -H "Content-Type: application/json" `
     -d '{\"message\":\"Mujhe kal subah G-13 mein AC technician chahiye\",\"defaultLocation\":\"G-13\"}'
   ```
   Expected event sequence: `understanding` → `searching` → `ranking` → `recommendation` → `booking` → `confirmed` → `reminder_scheduled`. Recommendation should be `Ali AC Services` (G-13, the closest AC provider).

   **Test B — English, different category and sector:**
   ```powershell
   curl.exe -N -X POST http://localhost:8000/chat `
     -H "Content-Type: application/json" `
     -d '{\"message\":\"I need a plumber tomorrow in F-7\"}'
   ```
   Expected: same sequence, recommendation should be `Sajid Plumbing` (F-7 plumber).

   **Test C — missing service, no default:**
   ```powershell
   curl.exe -N -X POST http://localhost:8000/chat `
     -H "Content-Type: application/json" `
     -d '{\"message\":\"hello, can you help me\"}'
   ```
   Expected: `understanding` → `awaiting_user` (missing: 'service'), then stream closes.

6. Every event in the stream matches one of the shapes in `src/agent/events.ts`. No extra fields, no missing required fields.

If something is genuinely blocking — e.g., the Gemini SDK API doesn't behave how you expect, or `withStructuredOutput` is acting up with this model — write what you tried in a brief note at the top of `src/agent/runAgent.ts` and bail out cleanly rather than silently working around it.
