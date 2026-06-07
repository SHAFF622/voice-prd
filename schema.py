"""Validated PRD artifact. The tool calls write into these models — this IS the
structured extraction layer (no separate transcript->JSON pipeline)."""
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


class PRD(BaseModel):
    project_name: str = "MedLegal Intake"
    stage: Stage = Stage.GATHERING_INTENT
    requirements: list[Requirement] = Field(default_factory=list)
    data_models: list[DataModel] = Field(default_factory=list)
    integrations: list[Integration] = Field(default_factory=list)
    compliance: list[ComplianceGate] = Field(default_factory=list)

    def to_markdown(self) -> str:
        """Export artifact. Pastes cleanly into Notion (Notion accepts markdown)."""
        lines = [f"# PRD: {self.project_name}", "",
                 f"_Stage: {self.stage.value.replace('_', ' ')}_", ""]

        lines.append("## Requirements")
        for r in self.requirements:
            lines.append(f"- **[{r.priority.upper()}] {r.title}**"
                         + (f" — {r.detail}" if r.detail else ""))
        lines.append("")

        lines.append("## Data Models")
        for m in self.data_models:
            rls = f"  _(RLS: {m.rls_policy})_" if m.rls_policy else ""
            lines.append(f"- **{m.name}**{rls}")
            for f in m.fields:
                pii = " ⚠️ PII" if f.pii else ""
                lines.append(f"    - `{f.name}`: {f.type}{pii}")
        lines.append("")

        lines.append("## Integrations")
        for i in self.integrations:
            lines.append(f"- **{i.name}**" + (f" — {i.purpose}" if i.purpose else ""))
        lines.append("")

        lines.append("## Compliance Gates")
        for c in self.compliance:
            status = "✅ accepted" if c.accepted else "⏳ pending"
            lines.append(f"- **{c.name}** ({status}) — triggered by: _{c.trigger}_")
        lines.append("")

        return "\n".join(lines)
