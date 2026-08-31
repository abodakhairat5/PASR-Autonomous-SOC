import json
import ollama

from schemas.agent_outputs import (
    AttackAnalyzerOutput,
    ThreatCorrelatorOutput,
    RiskAssessmentOutput,
)


MODEL_NAME = "qwen2.5:7b"


def risk_assessment_agent(
    attack_data: AttackAnalyzerOutput,
    correlation_data: ThreatCorrelatorOutput,
) -> RiskAssessmentOutput:
    """
    Agent #3 - Risk Assessment

    Evaluates the severity, impact, confidence,
    and overall risk of the detected threat.
    """

    print("\n[Agent 3 - Risk Assessment] Assessing risk...")

    prompt = f"""
You are the Risk Assessment Agent in an Autonomous SOC.

CURRENT ATTACK ANALYSIS:
{attack_data.model_dump_json(indent=2)}

THREAT CORRELATION:
{correlation_data.model_dump_json(indent=2)}

Assess the security risk using ONLY the provided information.

Evaluate:

1. Severity:
   LOW
   MEDIUM
   HIGH
   CRITICAL

2. Impact:
   LOW
   MEDIUM
   HIGH
   CRITICAL

3. Risk score:
   A number from 0 to 100.

4. Confidence:
   A number from 0.0 to 1.0.

5. Factors:
   List the concrete reasons affecting the risk.

Important rules:
- Repeated attacks from the same source increase risk.
- High-volume network attacks may have significant availability impact.
- Do not invent evidence.
- Do not invent affected assets.
- Do not automatically classify every attack as CRITICAL.
- Base the assessment only on the supplied evidence.
- Return ONLY valid JSON.

Required JSON:

{{
    "severity": "LOW / MEDIUM / HIGH / CRITICAL",
    "impact": "LOW / MEDIUM / HIGH / CRITICAL",
    "risk_score": 0.0,
    "confidence": 0.0,
    "factors": [],
    "summary": "Short explanation of the assessed risk"
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

        result = RiskAssessmentOutput.model_validate(data)

    except Exception as exc:
        raise ValueError(
            f"Risk Assessment returned invalid output: {exc}\n"
            f"Raw response: {raw_response}"
        )

    print("[Agent 3 - Risk Assessment] Assessment completed.")
    print(f"    ├─ Severity   : {result.severity}")
    print(f"    ├─ Impact     : {result.impact}")
    print(f"    ├─ Risk Score : {result.risk_score}")
    print(f"    └─ Confidence : {result.confidence}")

    return result