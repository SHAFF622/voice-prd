# Voice-to-Workflow PRD Generator

A non-technical founder talks; an AI voice agent builds a **validated PRD** live while
running an underlying workflow state machine. The voice tool calls ARE the structured
extraction — readable PRD blocks animate into a Command Center, a procedural Three.js core
reacts to the voice, and the whole session is durable in SQLite (kill the server mid-call,
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

## 2. Expose the webhook with ngrok

```bash
ngrok http 8000
```
Copy the `https://…ngrok…app` URL. Your webhook is that URL + `/vapi/webhook`.

---

## 3. Create the Vapi assistant

In the Vapi dashboard:

1. **Assistant → Model**: pick a fast model. System prompt:

   > You are a PRD architect interviewing a founder about a software idea. As they describe
   > it, immediately call tools to record each piece: `add_requirement`, `add_data_model`,
   > `add_integration`. The MOMENT they mention medical, financial, or personal data, call
   > `flag_compliance` and ask if they want the gate added. Keep every spoken reply to ONE
   > short sentence and confirm what you added (e.g. "Got it, adding a billing validation
   > step."). The dashboard shows the detail — don't read JSON aloud.

2. **Assistant → Tools (Functions)**: add the four custom tools below. Set the **Server URL**
   (assistant-level or per-tool) to your ngrok webhook so Vapi POSTs tool calls to it.

<details><summary>Tool definitions (paste each)</summary>

```jsonc
// add_requirement
{ "type":"function","function":{
  "name":"add_requirement",
  "description":"Record a product requirement the user describes.",
  "parameters":{"type":"object","properties":{
    "title":{"type":"string"},
    "detail":{"type":"string"},
    "priority":{"type":"string","enum":["must","should","could"]}
  },"required":["title"]}}}

// add_data_model
{ "type":"function","function":{
  "name":"add_data_model",
  "description":"Record a data model / table the system needs.",
  "parameters":{"type":"object","properties":{
    "name":{"type":"string"},
    "fields":{"type":"array","items":{"type":"string"},
      "description":"each as 'name:type', e.g. 'amount:money'"},
    "rls_policy":{"type":"string","description":"row-level security rule if sensitive"}
  },"required":["name"]}}}

// add_integration
{ "type":"function","function":{
  "name":"add_integration",
  "description":"Record a third-party integration (Stripe, Twilio, fax, email...).",
  "parameters":{"type":"object","properties":{
    "name":{"type":"string"},"purpose":{"type":"string"}
  },"required":["name"]}}}

// flag_compliance
{ "type":"function","function":{
  "name":"flag_compliance",
  "description":"Flag a compliance gate when regulated data (medical/financial/PII) is mentioned.",
  "parameters":{"type":"object","properties":{
    "name":{"type":"string"},"trigger":{"type":"string"},
    "accepted":{"type":"boolean"}
  },"required":["name","trigger"]}}}
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
  client-side markdown export/copy + Vapi wiring
- `static/scene.js` — procedural Three.js humanoid + GSAP reactions (head/jaw/voice-orb track volume)
