# Spectra — Voice-to-PRD Generator

**Spectra** turns talk into a spec. A non-technical founder talks; an AI voice agent builds a
**validated PRD** live while running an underlying workflow state machine. The voice tool calls
ARE the structured extraction — PRD blocks fill a live dashboard, a studio-lit 3D avatar
lip-syncs to the voice, and the whole session is durable in SQLite (kill the server mid-call,
restart, reload → state resumes).

> The one sentence the demo proves: **"Voice + an agent that maintains structured state
> turns a founder's rambling into a validated PRD artifact in real time."**

```
Vapi web call ──tool call──> POST /vapi/webhook ──> mutate PRD ──> SQLite ──> WebSocket ──> dashboard
```

---

## 1. Run the backend (2 min)

```bash
cd ~/voice-prd
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m uvicorn main:app --reload --port 8000
```

Open **http://localhost:8000/?s=demo**. (The `?s=` is the session id — keep it `demo`.)

Smoke-test with no voice needed:
```bash
curl -s -X POST localhost:8000/vapi/webhook -H 'Content-Type: application/json' \
 -d '{"message":{"type":"tool-calls","call":{"id":"demo"},
      "toolCallList":[{"id":"1","function":{"name":"add_requirement",
      "arguments":{"title":"Bill upload"}}}]}}'
```
A card should pop into the open browser tab. `GET /export/demo.md` returns the artifact.

---

## 2. Give Vapi a reachable webhook URL

The Vapi assistant POSTs tool calls to a **Server URL**. It must be a public HTTPS URL that's
up whenever you take a call — pick **one** of:

### Option A — Deploy to Render (recommended: stable URL, no local server) ⭐
A fixed URL that never changes, so the webhook can't go stale (the #1 cause of "the call
captured nothing / dropped mid-sentence"). `render.yaml` + `runtime.txt` are included.

1. Push this repo to GitHub.
2. Render → **New + → Blueprint** → pick the repo (it reads `render.yaml`).
3. Set env vars: `VAPI_PUBLIC_KEY`, `VAPI_ASSISTANT_ID` (and optional `RPM_AVATAR_URL`).
   The server serves these to the browser via `/config.js`, so no keys are committed.
   Add `ANTHROPIC_API_KEY` to enable **Generate PRD** (extracts the whole PRD from the call
   transcript with Claude — a config-proof fallback when live tool calls don't fire).
4. Deploy → copy the live URL, e.g. `https://spectra.onrender.com`.

- **Dashboard:** `https://<app>.onrender.com/?s=demo`
- **Vapi tool Server URL:** `https://<app>.onrender.com/vapi/webhook?s=demo`
  (the `?s=demo` routes every tool call into the `demo` session deterministically).
- **Health check:** open `https://<app>.onrender.com/debug` — shows the active session and
  per-session item counts, so you can confirm Vapi is actually writing.

Free-tier caveats: the service **spins down after ~15 min idle** (~50s cold start — open the
URL once right before a live demo), and SQLite is **ephemeral** (state resets on redeploy; add
a Render persistent disk or a hosted DB later if you need durability across deploys). Railway
works the same way with `startCommand: uvicorn main:app --host 0.0.0.0 --port $PORT` and stays
warm if you want no cold starts.

### Option B — ngrok (local dev only)
```bash
ngrok http 8000
```
Copy the `https://…ngrok…app` URL; your webhook is that URL + `/vapi/webhook?s=demo`.
⚠️ ngrok's free URL **changes every restart** — if you forget to update the Vapi Server URL,
calls silently capture nothing and may drop. Re-paste it each session, or use Option A.

---

## 3. Create the Vapi assistant

In the Vapi dashboard:

1. **Assistant → Model**: pick a fast model (temperature ~0.5). Paste the block below as the
   **whole** system prompt, and set the **First message** field to its last line. Do NOT paste
   the demo script (§4) or any tool code into the prompt — if the prompt contains literal
   `add_requirement(...)`-style code, the model reads it out loud ("to equals add requirement,
   title…"). Describe tools in words; let Vapi's Functions do the calling.

   ```
   # Identity
   You are Naina, a warm, sharp product manager at Spectra. You interview a founder by voice
   and turn what they say into a structured Product Requirements Document in real time. You
   sound human — natural spoken English, short sentences, one thought at a time. You're
   curious and encouraging, never robotic.

   # Your job
   Through a relaxed conversation, draw out everything a good PRD needs and quietly record
   each piece as you go. A live dashboard and an exportable spec hold all the detail — you
   never read it back. Cover these, roughly in order, but follow the founder's lead:

   1. Big picture — what they're building and the goal. Record this as the product overview:
      a one or two sentence introduction plus the objectives/targets.
   2. Who it's for — target users, buyers, and anyone with a stake (regulators, ops, support).
      Record each as a stakeholder.
   3. A real example — walk through one or two concrete users and what they do with it.
      Record each as a use-case story with the person's name.
   4. Features — anything the product must, should, or could do. Record each as a requirement,
      give it a category (Functionality, Design, UX, Performance, Regulations…) and a priority
      of must, should, or could.
   5. Data — what information the system stores. Record each as a data model with its fields;
      note row-level security if the data is sensitive.
   6. Integrations — any outside service (Stripe, Twilio, email, fax, maps…). Record each as
      an integration with its purpose.
   7. Compliance — the moment they mention medical, financial, or personal data, flag a
      compliance gate, briefly say why, and ask if they want it added; if they agree, mark it
      accepted.
   8. Timeline — any dates, phases, or launch targets. Record each as a milestone.
   9. Unknowns — anything they're unsure about or want to revisit. Record each as an open
      question.

   # How you talk
   - One short, natural sentence at a time. Ask ONE question, then listen.
   - After you capture something, give a quick human confirmation — "Got it, adding bill
     upload." — then move on.
   - If they jump around, follow them; fill gaps later with a gentle nudge ("Any sensitive
     data involved?", "What's your rough timeline?", "Anything still up in the air?").
   - If they ask you a question, just answer it in one sentence.

   # Hard rules
   - NEVER say tool names, function names, parameter names, JSON, braces, or any code out
     loud. Record everything silently in the background — the founder only hears natural talk.
   - Never narrate the recording itself; just confirm the idea in plain words.
   - Only record something when the founder actually states it; don't invent details.
   - Keep it moving and friendly — this is a chat, not an interrogation.
   - When the spec feels complete, tell them they can export it as a PRD whenever they're ready.

   # First message
   "Hi, I'm Naina — I'll turn your idea into a product spec as we talk. So, what are you
   building, and who's it for?"
   ```

2. **Assistant → Tools (Functions)**: add the nine custom tools below — these map 1:1 to the
   PRD sections in the export. Set the **Server URL** (assistant-level or per-tool) to your
   reachable webhook from §2, **including the session**, e.g.
   `https://<app>.onrender.com/vapi/webhook?s=demo` (or the ngrok equivalent). If this URL is
   wrong/stale, tool calls capture nothing and the call can drop mid-sentence — check
   `/debug` to confirm writes are landing.

<details><summary>Tool definitions (paste each)</summary>

```jsonc
// set_overview  -> Introduction + Objectives (+ optional project_name)
{ "type":"function","function":{
  "name":"set_overview",
  "description":"Set the product overview: a short introduction and the objectives. Call once you understand the idea; call again to refine.",
  "parameters":{"type":"object","properties":{
    "introduction":{"type":"string","description":"1-3 sentence background/context"},
    "objectives":{"type":"string","description":"goals, targets, market positioning"},
    "project_name":{"type":"string","description":"product name, if stated"}
  },"required":[]}}}

// add_stakeholder  -> Stakeholders
{ "type":"function","function":{
  "name":"add_stakeholder",
  "description":"Record a stakeholder or target audience (e.g. 'Target group', 'Regulatory instances').",
  "parameters":{"type":"object","properties":{
    "role":{"type":"string"},"description":{"type":"string"}
  },"required":["role"]}}}

// add_use_case  -> Use Cases (persona user stories)
{ "type":"function","function":{
  "name":"add_use_case",
  "description":"Record an example user / use-case story the founder describes.",
  "parameters":{"type":"object","properties":{
    "persona":{"type":"string","description":"who, e.g. 'Maria, a patient'"},
    "story":{"type":"string","description":"the narrative of what they do"}
  },"required":["persona"]}}}

// add_requirement  -> Aspects (grouped by category)
{ "type":"function","function":{
  "name":"add_requirement",
  "description":"Record a product requirement the user describes.",
  "parameters":{"type":"object","properties":{
    "title":{"type":"string"},
    "detail":{"type":"string"},
    "priority":{"type":"string","enum":["must","should","could"]},
    "category":{"type":"string","description":"groups it, e.g. Functionality, Design, UX, Regulations"}
  },"required":["title"]}}}

// add_data_model  -> Technical Notes / Data models
{ "type":"function","function":{
  "name":"add_data_model",
  "description":"Record a data model / table the system needs.",
  "parameters":{"type":"object","properties":{
    "name":{"type":"string"},
    "fields":{"type":"array","items":{"type":"string"},
      "description":"each as 'name:type', e.g. 'amount:money'"},
    "rls_policy":{"type":"string","description":"row-level security rule if sensitive"}
  },"required":["name"]}}}

// add_integration  -> Technical Notes / Integrations
{ "type":"function","function":{
  "name":"add_integration",
  "description":"Record a third-party integration (Stripe, Twilio, fax, email...).",
  "parameters":{"type":"object","properties":{
    "name":{"type":"string"},"purpose":{"type":"string"}
  },"required":["name"]}}}

// flag_compliance  -> Compliance & Regulations
{ "type":"function","function":{
  "name":"flag_compliance",
  "description":"Flag a compliance gate when regulated data (medical/financial/PII) is mentioned.",
  "parameters":{"type":"object","properties":{
    "name":{"type":"string"},"trigger":{"type":"string"},
    "accepted":{"type":"boolean"}
  },"required":["name","trigger"]}}}

// add_milestone  -> Milestones
{ "type":"function","function":{
  "name":"add_milestone",
  "description":"Record a milestone or target date/phase.",
  "parameters":{"type":"object","properties":{
    "name":{"type":"string"},"date":{"type":"string","description":"free-form, e.g. 'Q4 2026'"}
  },"required":["name"]}}}

// add_open_question  -> Open Questions
{ "type":"function","function":{
  "name":"add_open_question",
  "description":"Record an unresolved question or decision to revisit.",
  "parameters":{"type":"object","properties":{
    "question":{"type":"string"}
  },"required":["question"]}}}
```
</details>

3. Put your **Public Key** and **Assistant ID** in a **gitignored** `static/config.js`
   (so keys never hit the public repo):
   ```bash
   cp static/config.example.js static/config.js
   # then edit static/config.js:
   #   window.VAPI_PUBLIC_KEY   = "pk_...";
   #   window.VAPI_ASSISTANT_ID = "your-assistant-id";
   ```
   `index.html` reads `window.VAPI_*` at runtime; the server returns empty JS if
   `config.js` is absent, so fresh clones get no 404 and still run the fallback panel.
   Use the **Public** key (client-side); never put the Private key in the browser.

### Vapi web SDK — how it's loaded (verified)
`@vapi-ai/web` is an **ESM module**, so `index.html` imports it via jsDelivr `+esm` and
exposes it as `window.Vapi`:
```html
<script type="module">
  import Vapi from "https://cdn.jsdelivr.net/npm/@vapi-ai/web@latest/+esm";
  window.Vapi = Vapi;
</script>
```
Then `new Vapi(PUBLIC_KEY)` + `vapi.start(ASSISTANT_ID)` and the events `call-start`,
`call-end`, `speech-start`, `speech-end`, `volume-level`, `message` (confirmed against the
Vapi docs). The module load + `typeof window.Vapi === "object"` are verified by `verify.mjs`.
**Still do the live mic test** (hear the agent + mic dot turns red) before wiring the script —
that's the one thing only a real call with your keys can prove. This is your H0–1.5 gate.

### Headless self-check
`node verify.mjs` drives real Chrome (via `puppeteer-core` + your installed Google Chrome),
runs the full fallback script through the UI, asserts the cards render + WebGL is live + no
console errors, and writes `verify.png`. Run it after any frontend change:
```bash
./.venv/bin/python -m uvicorn main:app --port 8000 &   # server must be up
node verify.mjs && open verify.png
```

The webhook payload parsing (`parse_tool_calls` in `main.py`) is already defensive about
`toolCallList` vs `toolCalls` and string-vs-object arguments — but eyeball one real payload
in the uvicorn logs and adjust if Vapi's shape changed.

---

## 4. Demo script — MedLegal (the Wayco easter egg)

Say these lines; each deterministically drives a tool. Rehearse verbatim.

| You say | Expect on screen |
|---|---|
| "I need an app where **patients upload their medical bills**." | `MedicalBill` data model + a "Bill upload" requirement; agent flags **HIPAA gate** → say **"yes"** → ✅ |
| "We need to **extract the price** from each bill." | "Price extraction" requirement |
| "If a bill is **over $500, alert a lawyer**." | requirement (MUST) + a notification **integration** |
| "Add **row-level security** so a patient only sees their own bills." | RLS note on `MedicalBill` (the Wayco/Postgres beat) |
| *(click **Export .md**)* | clean PRD downloads; *(say)* "and it pastes straight into Notion" |
| *(refresh the page)* | everything resumes from SQLite — **the durability beat** |

Closing line: *"That's voice maintaining durable, structured workflow state — not a chat wrapper."*

> Re-mentioning a data model (the RLS line) **updates** it instead of duplicating —
> `add_data_model` upserts by name.

### Plan C — type-to-trigger fallback (if the mic dies on stage)
Press the **`` ` ``** (backtick) key or click **⌨ fallback** (bottom-left) to open a hidden
panel with one button per script line, plus **▶ Run full MedLegal script**. These post to the
**same `/vapi/webhook`**, so the dashboard and 3D core react identically — you can narrate
over a keyboard-driven run if voice fails and the backup video isn't enough. The panel is
unobtrusive and off by default, so it won't show during a clean voice demo.

---

## 5. Rehearse + backup (do NOT skip — H5.5–6.5)

- [ ] `curl` to **reset** between takes: `curl -X POST localhost:8000/api/reset/demo`
- [ ] Run the full script **5–10×** until it's muscle memory.
- [ ] **Record a clean screen+audio capture of a perfect run.** Conference wifi/mic failure
      is the #1 demo killer — if anything dies live, you play the video and narrate.
- [ ] Have the browser already open to `?s=demo`, server + ngrok already running, mic permission
      granted, volume up, notifications silenced.

---

## What's intentionally NOT here (scope discipline)
Blender/GLTF (post-hackathon ionous upgrade) · Twilio · Temporal · live Notion API · auth ·
a second transcript→JSON pipeline. The 3D is procedural; the durability is a 30-line SQLite
mirror (`state.py`); the structured extraction is the tool calls themselves.

## Files
- `schema.py` — Pydantic PRD models + `to_markdown()`
- `state.py` — in-memory cache + SQLite mirror (the durability story)
- `main.py` — FastAPI: `/vapi/webhook`, `/ws/{sid}`, `/export/{sid}.md`, `/api/reset/{sid}`
- `static/index.html` — transcript rail + "N captured" counter + recording visual +
  client-side markdown export/copy + formatted PDF export (print-to-PDF) + **Generate PRD**
  (transcript → PRD via Claude) + Vapi wiring
- `static/scene.js` — loads a realistic Ready Player Me GLB avatar (`static/avatar.glb`),
  studio-lit, that idles/blinks and lip-syncs to Vapi volume; swap via `RPM_AVATAR_URL` in `config.js`
