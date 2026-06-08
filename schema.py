"""Validated PRD artifact. The tool calls write into these models — this IS the
structured extraction layer (no separate transcript->JSON pipeline).

`to_markdown()` exports a full PRD shaped like a real product spec (Introduction,
Objectives, Stakeholders, Use Cases, Aspects, Technical Notes, Compliance, Open
Questions, Milestones). `static/index.html::buildMarkdown()` mirrors it byte-for-byte
(verify.mjs asserts they never drift)."""
from datetime import date
from enum import Enum
from typing import Literal
from pydantic import BaseModel, Field


class Stage(str, Enum):
    GATHERING_INTENT = "Gathering_Core_Intent"
    DATA_MODELS = "Defining_Data_Models"
    INTEGRATIONS = "Mapping_Integrations"
    COMPLIANCE = "Validating_Compliance"


class Requirement(BaseModel):
    id: str
    title: str
    detail: str = ""
    priority: Literal["must", "should", "could"] = "must"
    category: str = "Functionality"   # groups requirements into numbered "Aspects"


class Field_(BaseModel):
    name: str
    type: str                 # "text" | "money" | "timestamp" | "file" | "fk:Patient" ...
    pii: bool = False


class DataModel(BaseModel):
    name: str                 # e.g. "MedicalBill"
    fields: list[Field_] = Field(default_factory=list)
    rls_policy: str | None = None   # Wayco / Supabase RLS talking point


class Integration(BaseModel):
    name: str                 # "Stripe", "Twilio", "Fax API"
    purpose: str = ""


class ComplianceGate(BaseModel):
    name: str                 # "HIPAA encryption gate"
    trigger: str              # what the user said that triggered it
    accepted: bool = False


class Stakeholder(BaseModel):
    role: str                 # "Target group", "Regulatory instances", "Senior Management"
    description: str = ""


class UseCase(BaseModel):
    persona: str              # "Jenna — 33yo executive"
    story: str = ""           # the narrative user story


class Milestone(BaseModel):
    name: str                 # "Design freeze", "Planned release"
    date: str = ""            # free-form ("Q4 2026", "10/28/2026")


class PRD(BaseModel):
    project_name: str = "MedLegal Intake"
    version: str = "0.1"
    created: str = Field(default_factory=lambda: date.today().isoformat())
    stage: Stage = Stage.GATHERING_INTENT
    introduction: str = ""    # Introduction section (background / context)
    objectives: str = ""      # Objectives section (goals / targets / market)
    requirements: list[Requirement] = Field(default_factory=list)
    data_models: list[DataModel] = Field(default_factory=list)
    integrations: list[Integration] = Field(default_factory=list)
    compliance: list[ComplianceGate] = Field(default_factory=list)
    stakeholders: list[Stakeholder] = Field(default_factory=list)
    use_cases: list[UseCase] = Field(default_factory=list)
    milestones: list[Milestone] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)

    def to_markdown(self) -> str:
        """Export a full PRD-shaped artifact (Notion-friendly markdown), laid out like a
        real product spec. Mirrored exactly by static/index.html::buildMarkdown()."""
        P = self.project_name
        L = [
            "# Product Requirements Document",
            "",
            f"**{P}**",
            "",
            f"_Spectra · Prepared by Naina (PRD architect) · {self.created} · Version {self.version}_",
            "",
            "## Introduction",
            self.introduction or "_Background and context to be captured._",
            "",
            "## Objectives",
            self.objectives or "_Goals, targets, and market positioning to be captured._",
            "",
            "## Stakeholders",
        ]
        if self.stakeholders:
            for s in self.stakeholders:
                L.append(f"- **{s.role}.** {s.description}" if s.description
                         else f"- **{s.role}.**")
        else:
            L.append("_No stakeholders captured yet._")

        L += ["", "## Use Cases", ""]
        if self.use_cases:
            for n, u in enumerate(self.use_cases, 1):
                L.append(f"### User Story #{n}: {u.persona}")
                L.append(u.story or "_…_")
                L.append("")
        else:
            L += ["_No use cases captured yet._", ""]

        L += ["## Aspects", ""]
        if self.requirements:
            cats: list[str] = []
            for r in self.requirements:
                if r.category not in cats:
                    cats.append(r.category)
            for ci, cat in enumerate(cats, 1):
                L.append(f"### {ci}. {cat}")
                items = [r for r in self.requirements if r.category == cat]
                for ri, r in enumerate(items, 1):
                    line = f"{ci}.{ri} {r.title}"
                    if r.detail:
                        line += f" — {r.detail}"
                    line += f" `[{r.priority.upper()}]`"
                    L.append(line)
                L.append("")
        else:
            L += ["_No requirements captured yet._", ""]

        L += ["## Technical Notes", "", "### Data models"]
        if not self.data_models:
            L.append("_None captured yet._")
        for m in self.data_models:
            rls = f"  _(RLS: {m.rls_policy})_" if m.rls_policy else ""
            L.append(f"- **{m.name}**{rls}")
            for f in m.fields:
                pii = " ⚠️ PII" if f.pii else ""
                L.append(f"    - `{f.name}`: {f.type}{pii}")
        L += ["", "### Integrations"]
        if not self.integrations:
            L.append("_None captured yet._")
        for i in self.integrations:
            L.append(f"- **{i.name}**" + (f" — {i.purpose}" if i.purpose else ""))

        L += ["", "## Compliance & Regulations"]
        if self.compliance:
            for c in self.compliance:
                status = "✅ accepted" if c.accepted else "⏳ pending"
                L.append(f"- **{c.name}** ({status}) — triggered by _{c.trigger}_.")
        else:
            L.append("_No compliance gates flagged yet._")

        L += ["", "## Open Questions"]
        if self.open_questions:
            for q in self.open_questions:
                L.append(f"- {q}")
        else:
            L.append("_No open questions captured yet._")

        L += ["", "## Milestones"]
        if self.milestones:
            for m in self.milestones:
                L.append(f"- **{m.name}** — {m.date}" if m.date
                         else f"- **{m.name}** — _TBD_")
        else:
            L.append("_No milestones captured yet._")
        L.append("")
        return "\n".join(L)
