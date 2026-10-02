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

    Supports:
    - NETWORK events
    - PENTEST findings
    """

    print("\n[Agent 4 - Decision Agent] Selecting response...")
    # =========================================================
    # Pentest events
    # =========================================================
    if attack_data.event_type == "PENTEST":

        print("[Agent 4 - Decision Agent] Pentest finding detected.")

        result = DecisionAgentOutput(
            recommended_action="ALERT",
            decision_confidence=1.0,
            priority=(
                "CRITICAL"
                if risk_data.severity.upper() == "CRITICAL"
                else risk_data.severity.upper()
            ),
            target=attack_data.target_url,
            reasoning=(
                f"Confirmed pentest finding "
                f"{attack_data.finding_id or attack_data.attack_type} "
                f"was received for target "
                f"{attack_data.target_url or 'unknown target'}. "
                f"No source IP is available, so the appropriate response "
                f"is to alert the SOC analyst for investigation and remediation."
            ),
        )

        print("[Agent 4 - Decision Agent] Pentest decision generated.")
        print(f"    ├─ Action     : {result.recommended_action}")
        print(f"    ├─ Priority   : {result.priority}")
        print(f"    ├─ Target     : {result.target}")
        print(f"    └─ Confidence : {result.decision_confidence}")

        return result

    prompt = f"""
You are the Decision Agent in an Autonomous SOC.

CURRENT ATTACK ANALYSIS:
{attack_data.model_dump_json(indent=2)}

THREAT CORRELATION:
{correlation_data.model_dump_json(indent=2)}

RISK ASSESSMENT:
{risk_data.model_dump_json(indent=2)}

============================================================
EVENT TYPE
============================================================

The event can be:

- NETWORK
- PENTEST

NETWORK events represent live network/security activity.

PENTEST events represent confirmed security findings against
an application or asset.

============================================================
ALLOWED ACTIONS
============================================================

- ALERT
- BLOCK
- THROTTLE
- ISOLATE

============================================================
NETWORK DECISION GUIDELINES
============================================================

For NETWORK events:

1. ALERT:
   Use when the threat needs analyst attention but automatic
   containment is not sufficiently justified.

2. BLOCK:
   Use when there is strong evidence of malicious activity
   and blocking the source IP is appropriate.

3. THROTTLE:
   Use when traffic should be rate-limited instead of
   completely blocked.

4. ISOLATE:
   Use only for serious threats where isolating an affected
   asset is justified by the available evidence.

============================================================
PENTEST DECISION GUIDELINES
============================================================

For PENTEST events:

1. Treat the finding as a confirmed vulnerability assessment.

2. Do NOT assume that a web vulnerability should result in
   blocking the target application or target URL.

3. Do NOT invent a source IP.

4. For most application vulnerabilities, ALERT is appropriate
   when the SOC needs analyst/security-team attention.

5. BLOCK, THROTTLE, or ISOLATE should only be selected if
   the supplied evidence explicitly justifies such an action.

6. The target should identify the affected asset when it is
   available from the event data.

7. Do not invent an affected asset.

============================================================
GENERAL RULES
============================================================

- Consider severity, impact, risk score, confidence, and correlation.
- Repeated malicious activity increases justification for containment.
- Do not invent affected assets.
- Do not claim an IP is malicious without evidence.
- Prefer the least disruptive effective action.
- Previous knowledge is evidence, not authorization.
- Guardrails have final authority over the decision.
- Return ONLY valid JSON.

============================================================
TARGET RULE
============================================================

For NETWORK:

target = source IP when an actual source IP exists.

For PENTEST:

target = affected asset only when it is explicitly available
in the supplied attack analysis.

Otherwise:

target = null.

============================================================
REQUIRED JSON
============================================================

{{
    "recommended_action": "ALERT / BLOCK / THROTTLE / ISOLATE",
    "decision_confidence": 0.0,
    "priority": "LOW / MEDIUM / HIGH / CRITICAL",
    "target": "Target asset or IP or null",
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