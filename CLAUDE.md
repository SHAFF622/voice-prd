# CLAUDE.md — Spectra (Voice-to-PRD Generator)

Context for AI agents working in this repo. Read `README.md` for the full runbook.

## What this is
A non-technical founder talks to a voice agent (Vapi); the agent calls tools that build a
**validated PRD** live. The voice tool calls ARE the structured extraction — no separate
transcript→JSON pipeline. State is durable in SQLite, streamed to a browser dashboard
over WebSocket, with a procedural Three.js core that reacts to speech.

```
Vapi web call --tool call--> POST /vapi/webhook --> mutate PRD --> SQLite --> WS --> dashboard
```

## Architecture rules (do not violate)
- **One source of truth**: the PRD object in `state.py`. Tool handlers in `main.py` mutate it,
  `state.save()` mirrors to SQLite, `broadcast()` pushes to all sockets.
- **Tool handlers are dumb + instant**: mutate, return a one-line string, never block on I/O.
  `broadcast()` runs as a background task so the agent's speech is never delayed.
- **All capture tools upsert by title/name** (`add_requirement`, `add_data_model`,
  `add_integration`, `flag_compliance`, `add_stakeholder`, `add_use_case`, `add_milestone`) —
  re-mentioning something updates it (the RLS beat; a gate flipping to accepted), never
  duplicates. `set_overview` sets the intro/objectives strings.
- **Provider-agnostic backend**: `/vapi/webhook` is just HTTP. Swapping Vapi for another voice
  provider is a frontend/config change only.
- **Frontend must degrade gracefully**: `scene.js` feature-detects WebGL and installs a no-op
  `window.SCENE` if unavailable so the dashboard always works. Keep all `SCENE` calls guarded.

## Files
- `schema.py` — Pydantic PRD models + `to_markdown()`
- `state.py` — in-memory cache + SQLite mirror (the durability story)
- `main.py` — FastAPI: `/vapi/webhook`, `/ws/{sid}`, `/export/{sid}.md`, `/api/reset/{sid}`,
  `/generate/{sid}` (config-proof fallback: browser POSTs the captured transcript, one OpenAI
  `gpt-4o` structured-output call builds the whole PRD; needs `OPENAI_API_KEY`, degrades to a
  clean 400/502 without it)
- `static/index.html` — transcript rail, "N captured" counter, recording visual, client-side
  markdown export/copy + formatted **PDF export** (`buildPrdHtml` → print-to-PDF), Vapi wiring,
  type-to-trigger Plan C fallback panel (backtick toggles it)
- `static/scene.js` — loads a realistic Ready Player Me GLB avatar (GLTFLoader), studio-lit,
  that idles/blinks and lip-syncs to Vapi volume (ARKit `jawOpen`/viseme morphs). Avatar is
  `static/avatar.glb`, overridable via `window.RPM_AVATAR_URL` in `config.js`.
- `verify.mjs` — headless Chrome self-check (see below)

## Vapi notes (verified, but APIs drift — re-check if it breaks)
- `@vapi-ai/web` is **ESM**. Loaded via `https://cdn.jsdelivr.net/npm/@vapi-ai/web@latest/+esm`
  and exposed as `window.Vapi`. Use `new Vapi(KEY)` + `vapi.start(ASSISTANT_ID)`.
- Events used: `call-start`, `call-end`, `speech-start`, `speech-end`, `volume-level`, `message`.

## Run & verify
```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m uvicorn main:app --reload --port 8000   # http://localhost:8000/?s=demo
npm install                                                   # puppeteer-core (dev only)
npm run verify && open verify.png                             # headless render + behavior check
```
`verify.mjs` runs the full fallback script through the real UI and asserts: cards render,
WebGL context live, `window.SCENE` present, zero console errors. Run it after any frontend change.

## Scope discipline (intentionally NOT here)
Blender/GLTF (the 3D is procedural), Twilio, Temporal, live Notion API, auth. Don't add these
without a reason. NOTE: the live Vapi tool calls are still the primary structured-extraction
path; `/generate` is an explicit **fallback** for when those tool calls don't reach the server
(misconfig, demo conditions) — not a replacement. Keep the tool-call path the default.
