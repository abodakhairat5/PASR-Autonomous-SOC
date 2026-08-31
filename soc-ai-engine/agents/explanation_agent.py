from config.llm import get_llm
import json
from typing import Any

from schemas.agent_outputs import (
    AttackAnalyzerOutput,
    ThreatCorrelatorOutput,
    RiskAssessmentOutput,
    DecisionAgentOutput,
    RuleGeneratorOutput,
    ExplanationAgentOutput,
)

from config.llm import get_llm


def _extract_json(raw_response: str) -> dict:
    """
    Extract a JSON object from the LLM response.
    Handles markdown fences and surrounding text.
    """
    text = raw_response.strip()

    if text.startswith("```"):
        lines = text.splitlines()

        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]

        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]

        text = "\n".join(lines).strip()

    start = text.find("{")
    end = text.rfind("}")

    if start == -1 or end == -1 or end <= start:
        raise ValueError("No valid JSON object found in LLM response.")

    json_text = text[start:end + 1]

    return json.loads(json_text)


def _normalize_explanation_output(data: dict) -> dict:
    """
    Normalize malformed LLM output into the schema expected
    by ExplanationAgentOutput.

    Handles cases where the LLM incorrectly returns:

    {
        "explanation": {
            "Detailed but concise explanation": "...",
            "key_evidence": [...],
            ...
        }
    }

    instead of:

    {
        "explanation": "...",
        "key_evidence": [...],
        ...
    }
    """

    if not isinstance(data, dict):
        raise ValueError("Explanation Agent output must be a JSON object.")

    explanation = data.get("explanation")

    # ---------------------------------------------------------
    # Case 1: Correct output
    # ---------------------------------------------------------
    if isinstance(explanation, str):
        normalized = dict(data)

        normalized.setdefault("key_evidence", [])
        normalized.setdefault("risk_factors", [])
        normalized.setdefault("decision_summary", "")
        normalized.setdefault("analyst_recommendation", "")

        return normalized

    # ---------------------------------------------------------
    # Case 2: Qwen nested the entire response inside explanation
    # ---------------------------------------------------------
    if isinstance(explanation, dict):

        nested = explanation

        detailed_explanation = (
            nested.get("Detailed but concise explanation")
            or nested.get("detailed_but_concise_explanation")
            or nested.get("summary")
            or nested.get("text")
            or ""
        )

        normalized = {
            "explanation": detailed_explanation,
            "key_evidence": nested.get(
                "key_evidence",
                data.get("key_evidence", [])
            ),
            "risk_factors": nested.get(
                "risk_factors",
                data.get("risk_factors", [])
            ),
            "decision_summary": nested.get(
                "decision_summary",
                data.get("decision_summary", "")
            ),
            "analyst_recommendation": nested.get(
                "analyst_recommendation",
                data.get("analyst_recommendation", "")
            ),
        }

        return normalized

    # ---------------------------------------------------------
    # Case 3: Missing explanation
    # ---------------------------------------------------------
    normalized = {
        "explanation": str(explanation or ""),
        "key_evidence": data.get("key_evidence", []),
        "risk_factors": data.get("risk_factors", []),
        "decision_summary": data.get("decision_summary", ""),
        "analyst_recommendation": data.get("analyst_recommendation", ""),
    }

    return normalized


def explanation_agent(
    attack: AttackAnalyzerOutput,
    correlation: ThreatCorrelatorOutput,
    risk: RiskAssessmentOutput,
    decision: DecisionAgentOutput,
    rule: RuleGeneratorOutput,
) -> ExplanationAgentOutput:

    print("[Agent 6 - Explanation Agent] Generating explanation...")

    prompt = f"""
You are Agent 6 in an Autonomous Security Operations Center.

Your job is to explain the security decision made by the previous agents.

You MUST return ONLY valid JSON.

IMPORTANT:
- Do NOT wrap the output inside another "explanation" object.
- "explanation" MUST be a STRING.
- Do NOT use markdown.
- Do NOT add commentary outside JSON.

Required JSON structure:

{{
  "explanation": "Detailed but concise explanation of the incident and decision.",
  "key_evidence": [
    "evidence 1",
    "evidence 2"
  ],
  "risk_factors": [
    "risk factor 1",
    "risk factor 2"
  ],
  "decision_summary": "Short summary of the selected action.",
  "analyst_recommendation": "Recommendation for the security analyst."
}}

Attack Analysis:
{attack.model_dump_json(indent=2)}

Threat Correlation:
{correlation.model_dump_json(indent=2)}

Risk Assessment:
{risk.model_dump_json(indent=2)}

Decision:
{decision.model_dump_json(indent=2)}

Runtime Rule:
{rule.model_dump_json(indent=2)}
"""

    try:
        llm = get_llm()

        raw_response = llm.invoke(prompt)

        # -----------------------------------------------------
        # Handle different LLM response formats
        # -----------------------------------------------------
        if hasattr(raw_response, "content"):
            raw_response = raw_response.content

        if not isinstance(raw_response, str):
            raw_response = str(raw_response)

        # -----------------------------------------------------
        # Parse JSON
        # -----------------------------------------------------
        data = _extract_json(raw_response)

        # -----------------------------------------------------
        # Normalize malformed LLM structure
        # -----------------------------------------------------
        data = _normalize_explanation_output(data)

        # -----------------------------------------------------
        # Validate against Pydantic schema
        # -----------------------------------------------------
        result = ExplanationAgentOutput.model_validate(data)

        print("[Agent 6 - Explanation Agent] Explanation completed.")
        print(
            f"    ├─ Decision Summary : "
            f"{result.decision_summary}"
        )
        print(
            f"    ├─ Evidence Count   : "
            f"{len(result.key_evidence)}"
        )
        print(
            f"    └─ Recommendation   : "
            f"{result.analyst_recommendation}"
        )

        return result

    except Exception as exc:
        print(
            "[Agent 6 - Explanation Agent] "
            "ERROR while processing response."
        )

        raise ValueError(
            f"Explanation Agent returned invalid output: {exc}\n"
            f"Raw response: {raw_response if 'raw_response' in locals() else 'N/A'}"
        ) from exc