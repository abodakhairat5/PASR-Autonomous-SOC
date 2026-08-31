import ollama

from schemas.agent_outputs import (
    AttackAnalyzerOutput,
    ThreatCorrelatorOutput,
    RiskAssessmentOutput,
    DecisionAgentOutput,
    RuleGeneratorOutput,
    ExplanationAgentOutput,
)


MODEL_NAME = "qwen2.5:7b"


def explanation_agent(
    attack_data: AttackAnalyzerOutput,
    correlation_data: ThreatCorrelatorOutput,
    risk_data: RiskAssessmentOutput,
    decision_data: DecisionAgentOutput,
    rule_data: RuleGeneratorOutput,
) -> ExplanationAgentOutput:
    """
    Agent #6 - Explanation Agent

    Explains the reasoning behind the security decision
    in a form understandable to a SOC analyst.
    """

    print("\n[Agent 6 - Explanation Agent] Generating explanation...")

    prompt = f"""
You are the Explanation Agent in an Autonomous SOC.

Your job is to explain WHY the security system reached
its current decision.

Do NOT make a new security decision.

Do NOT change the recommended action.

Use ONLY the information provided below.

ATTACK ANALYSIS:
{attack_data.model_dump_json(indent=2)}

THREAT CORRELATION:
{correlation_data.model_dump_json(indent=2)}

RISK ASSESSMENT:
{risk_data.model_dump_json(indent=2)}

DECISION:
{decision_data.model_dump_json(indent=2)}

GENERATED RULE:
{rule_data.model_dump_json(indent=2)}

Your explanation must:

1. Clearly identify the detected threat.
2. Explain the important evidence.
3. Explain whether previous events were correlated.
4. Explain the assessed severity and impact.
5. Explain why the selected action was reasonable.
6. Explain what rule was generated.
7. Mention uncertainty if present.
8. Do not invent facts.
9. Do not claim that an action was executed.
10. Distinguish between a RECOMMENDED rule and an EXECUTED rule.
11. Return ONLY valid JSON.

Required JSON:

{{
    "explanation": "Detailed but concise explanation",
    "key_evidence": [],
    "risk_factors": [],
    "decision_summary": "Short decision summary",
    "analyst_recommendation": "What the analyst should verify or monitor"
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
        result = ExplanationAgentOutput.model_validate_json(
            raw_response
        )

    except Exception as exc:
        raise ValueError(
            f"Explanation Agent returned invalid output: {exc}\n"
            f"Raw response: {raw_response}"
        )

    print("[Agent 6 - Explanation Agent] Explanation completed.")
    print(f"    ├─ Decision Summary : {result.decision_summary}")
    print(f"    ├─ Evidence Count   : {len(result.key_evidence)}")
    print(f"    └─ Recommendation   : {result.analyst_recommendation}")

    return result
