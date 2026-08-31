import json
import ollama

from schemas.agent_outputs import (
    AttackAnalyzerOutput,
    ThreatCorrelatorOutput,
    RiskAssessmentOutput,
    DecisionAgentOutput,
)


MODEL_NAME = "qwen2.5:7b"


def decision_agent(
    attack_data: AttackAnalyzerOutput,
    correlation_data: ThreatCorrelatorOutput,
    risk_data: RiskAssessmentOutput,
) -> DecisionAgentOutput:
    """
    Agent #4 - Decision Agent

    Converts attack, correlation, and risk information
    into a recommended security response.
    """

    print("\n[Agent 4 - Decision Agent] Selecting response...")

    prompt = f"""
You are the Decision Agent in an Autonomous SOC.

CURRENT ATTACK ANALYSIS:
{attack_data.model_dump_json(indent=2)}

THREAT CORRELATION:
{correlation_data.model_dump_json(indent=2)}

RISK ASSESSMENT:
{risk_data.model_dump_json(indent=2)}

Select the most appropriate defensive response.

Allowed actions:
- ALERT
- BLOCK
- THROTTLE
- ISOLATE

Decision guidelines:

1. ALERT:
   Use when the threat needs analyst attention but automatic
   containment is not sufficiently justified.

2. BLOCK:
   Use when there is strong evidence of malicious activity
   and blocking the source IP is appropriate.

3. THROTTLE:
   Use when traffic should be rate-limited instead of completely blocked.

4. ISOLATE:
   Use only for serious threats where isolating an affected
   asset is justified by the available evidence.

Important rules:
- Consider severity, impact, risk score, confidence, and correlation.
- Repeated malicious activity increases the justification for containment.
- Do not invent affected assets.
- Do not claim an IP is malicious without evidence.
- Prefer the least disruptive effective action.
- Return ONLY valid JSON.

Required JSON:

{{
    "recommended_action": "ALERT / BLOCK / THROTTLE / ISOLATE",
    "decision_confidence": 0.0,
    "priority": "LOW / MEDIUM / HIGH / CRITICAL",
    "target": "Target IP or null",
    "reasoning": "Short explanation"
}}
"""

    response = ollama.chat(
        model=MODEL_NAME,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        format="json",
    )

    raw_response = response["message"]["content"]

    try:
        data = json.loads(raw_response)

        result = DecisionAgentOutput.model_validate(data)

    except Exception as exc:
        raise ValueError(
            f"Decision Agent returned invalid output: {exc}\n"
            f"Raw response: {raw_response}"
        )

    print("[Agent 4 - Decision Agent] Decision completed.")
    print(f"    ├─ Action     : {result.recommended_action}")
    print(f"    ├─ Priority   : {result.priority}")
    print(f"    ├─ Target     : {result.target}")
    print(f"    └─ Confidence : {result.decision_confidence}")

    return result