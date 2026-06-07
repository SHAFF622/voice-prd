"""FastAPI backend for the Voice-to-Workflow PRD Generator.

Flow:  Vapi web call --(tool call)--> POST /vapi/webhook --> mutate PRD --> save to
SQLite --> broadcast over WebSocket --> browser Command Center updates live.

Tool handlers are dumb + instant: mutate state, return a one-line confirmation, fire
the broadcast as a background task so we never block the agent's speech on a DB write.

NOTE (AGENTS.md ethos: APIs drift): the Vapi server `tool-calls` payload shape and the
expected `{"results":[{"toolCallId","result"}]}` response are confirmed against current
Vapi docs at build time. If the shape differs, adjust `parse_tool_calls` / `vapi_webhook`.
"""
import asyncio
import json
import os
import uuid

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

import state
from schema import (PRD, Requirement, DataModel, Field_, Integration,
                    ComplianceGate, Stage)

app = FastAPI(title="Voice PRD")

# session_id -> set of connected dashboard sockets
_sockets: dict[str, set[WebSocket]] = {}

# The dashboard session voice tool calls should write to. Vapi tags tool calls with its
# own call UUID, but the browser/export use a fixed session (default "demo"), so we route
# voice writes to whichever dashboard is currently open instead of the Vapi call id.
_active_session: str = "demo"


async def broadcast(session_id: str) -> None:
    prd = state.get(session_id)
    payload = prd.model_dump_json()
    dead = set()
    for ws in _sockets.get(session_id, set()):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    if dead:
        _sockets[session_id] -= dead


# ------------------------------------------------------------------ tools
# Each tool mutates the PRD and advances the stage. Keep them trivial.

def add_requirement(prd: PRD, title: str, detail: str = "", priority: str = "must") -> str:
    prd.stage = Stage.GATHERING_INTENT
    pri = priority if priority in ("must", "should", "could") else "must"
    # Upsert by title so re-stating a requirement updates it instead of duplicating.
    existing = next((r for r in prd.requirements if r.title.lower() == title.lower()), None)
    if existing:
        if detail:
            existing.detail = detail
        existing.priority = pri
        return f"Updated requirement: {title}"
    prd.requirements.append(
        Requirement(id=str(uuid.uuid4())[:8], title=title, detail=detail, priority=pri))
    return f"Added requirement: {title}"


def add_data_model(prd: PRD, name: str, fields: list | None = None,
                   rls_policy: str | None = None) -> str:
    parsed = []
    for f in (fields or []):
        if isinstance(f, str):                       # tolerate "name:type" strings
            n, _, t = f.partition(":")
            parsed.append(Field_(name=n.strip(), type=(t.strip() or "text")))
        else:
            parsed.append(Field_(**f))
    prd.stage = Stage.DATA_MODELS
    # Upsert by name: re-mentioning a model (e.g. "add RLS to MedicalBill") updates it
    # instead of creating a duplicate — supports the RLS beat in both voice and fallback.
    existing = next((m for m in prd.data_models if m.name.lower() == name.lower()), None)
    if existing:
        have = {f.name.lower() for f in existing.fields}
        existing.fields += [f for f in parsed if f.name.lower() not in have]
        if rls_policy:
            existing.rls_policy = rls_policy
        return f"Updated data model: {name}"
    prd.data_models.append(DataModel(name=name, fields=parsed, rls_policy=rls_policy))
    return f"Added data model: {name}"


def add_integration(prd: PRD, name: str, purpose: str = "") -> str:
    prd.stage = Stage.INTEGRATIONS
    # Upsert by name so re-mentioning an integration updates it instead of duplicating.
    existing = next((i for i in prd.integrations if i.name.lower() == name.lower()), None)
    if existing:
        if purpose:
            existing.purpose = purpose
        return f"Updated integration: {name}"
    prd.integrations.append(Integration(name=name, purpose=purpose))
    return f"Mapped integration: {name}"


def flag_compliance(prd: PRD, name: str, trigger: str, accepted: bool = False) -> str:
    prd.stage = Stage.COMPLIANCE
    # Upsert by name so re-flagging a gate (e.g. founder later accepts it) updates it.
    existing = next((c for c in prd.compliance if c.name.lower() == name.lower()), None)
    if existing:
        if trigger:
            existing.trigger = trigger
        existing.accepted = bool(accepted)
        return f"Updated compliance gate: {name}"
    prd.compliance.append(ComplianceGate(name=name, trigger=trigger, accepted=bool(accepted)))
    return f"Flagged compliance gate: {name}"


TOOLS = {f.__name__: f for f in
         (add_requirement, add_data_model, add_integration, flag_compliance)}


# ------------------------------------------------------------------ vapi webhook
def parse_tool_calls(body: dict):
    """Return (session_id, [(call_id, fn_name, args_dict), ...]) from a Vapi payload."""
    msg = body.get("message", body)
    session_id = (msg.get("call") or {}).get("id") or body.get("session_id") or "demo"
    raw = msg.get("toolCallList") or msg.get("toolCalls") or []
    calls = []
    for c in raw:
        fn = c.get("function", c)
        name = fn.get("name")
        args = fn.get("arguments", {})
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {}
        calls.append((c.get("id") or fn.get("id") or str(uuid.uuid4()), name, args))
    return session_id, calls


@app.post("/vapi/webhook")
async def vapi_webhook(req: Request):
    body = await req.json()
    msg = body.get("message", {})
    mtype = msg.get("type")

    # We only act on tool calls. Acknowledge everything else so Vapi stays happy.
    if mtype not in ("tool-calls", "function-call", None) and "toolCallList" not in msg:
        return JSONResponse({})

    _, calls = parse_tool_calls(body)
    if not calls:
        return JSONResponse({})

    # Write to the open dashboard session, not Vapi's call id, so voice + UI + export agree.
    session_id = _active_session
    prd = state.get(session_id)
    results = []
    for call_id, name, args in calls:
        handler = TOOLS.get(name)
        if handler is None:
            results.append({"toolCallId": call_id, "result": f"unknown tool: {name}"})
            continue
        try:
            result = handler(prd, **args)
        except Exception as e:               # never 500 mid-demo; report inline
            result = f"error in {name}: {e}"
        results.append({"toolCallId": call_id, "result": result})

    state.save(session_id, prd)
    asyncio.create_task(broadcast(session_id))   # don't block the spoken response
    return JSONResponse({"results": results})


# ------------------------------------------------------------------ websocket
@app.websocket("/ws/{session_id}")
async def ws(websocket: WebSocket, session_id: str):
    global _active_session
    await websocket.accept()
    _active_session = session_id          # voice tool calls now route to this dashboard
    _sockets.setdefault(session_id, set()).add(websocket)
    # Send full state on connect -> live "resume" when the page (re)loads.
    await websocket.send_text(state.get(session_id).model_dump_json())
    try:
        while True:
            await websocket.receive_text()       # keepalive; we don't expect client msgs
    except WebSocketDisconnect:
        pass
    finally:
        _sockets.get(session_id, set()).discard(websocket)


# ------------------------------------------------------------------ export / utils
@app.get("/export/{session_id}.md")
async def export_md(session_id: str):
    md = state.get(session_id).to_markdown()
    return PlainTextResponse(md, headers={
        "Content-Disposition": f'attachment; filename="{session_id}-prd.md"'})


@app.get("/api/prd/{session_id}")
async def api_prd(session_id: str):
    return JSONResponse(json.loads(state.get(session_id).model_dump_json()))


@app.post("/api/reset/{session_id}")
async def api_reset(session_id: str):
    state.reset(session_id)
    await broadcast(session_id)
    return JSONResponse({"ok": True})


@app.get("/config.js")
async def config_js():
    """Serve gitignored static/config.js if present, else empty JS (no 404 on fresh
    clones). Keeps Vapi keys out of git: edit static/config.js locally."""
    path = os.path.join("static", "config.js")
    if os.path.exists(path):
        return FileResponse(path, media_type="application/javascript")
    return PlainTextResponse("/* no static/config.js — using placeholders */",
                             media_type="application/javascript")


# Static dashboard last so it doesn't shadow the API routes above.
app.mount("/", StaticFiles(directory="static", html=True), name="static")
