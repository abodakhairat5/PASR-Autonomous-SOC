import json
import ollama

from schemas.agent_outputs import (
    AttackAnalyzerOutput,
    RiskAssessmentOutput,
    DecisionAgentOutput,
    RuleGeneratorOutput,
)


MODEL_NAME = "qwen2.5:7b"


def rule_generator_agent(
    attack_data: AttackAnalyzerOutput,
    risk_data: RiskAssessmentOutput,
    decision_data: DecisionAgentOutput,
) -> RuleGeneratorOutput:
    """
    Agent #5 - Rule Generator

    Converts the approved security decision into
    a structured runtime security rule.

    This agent generates the rule only.
    It does NOT execute the rule.
    """

    print("\n[Agent 5 - Rule Generator] Generating runtime rule...")

    prompt = f"""
You are the Rule Generator Agent in an Autonomous SOC.

Your job is to convert the security decision into a
structured runtime rule.

IMPORTANT:
- Do NOT execute the rule.
- Do NOT change the security decision.
- Do NOT invent information.
- Use ONLY the provided attack, risk, and decision data.
- The rule must be suitable for runtime enforcement.
- Return ONLY valid JSON.

ATTACK ANALYSIS:
{attack_data.model_dump_json(indent=2)}

RISK ASSESSMENT:
{risk_data.model_dump_json(indent=2)}

SECURITY DECISION:
{decision_data.model_dump_json(indent=2)}

Generate a runtime rule.

Allowed rule types:
- BLOCK
- THROTTLE
- ALERT
- ISOLATE
- NONE

Allowed protocols:
- TCP
- UDP
- ICMP
- ANY

Allowed directions:
- INBOUND
- OUTBOUND
- ANY

The JSON MUST use snake_case field names exactly.

Required JSON structure:

{{
    "rule_type": "BLOCK",
    "target_ip": "192.168.1.105",
    "protocol": "TCP",
    "direction": "INBOUND",
    "parameters": {{
        "action": "deny"
    }},
    "rule_description": "Short description of the rule",
    "requires_approval": false
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

    # Extract the actual LLM response BEFORE parsing it
    raw_response = response["message"]["content"]

    try:
        data = json.loads(raw_response)

        # ---------------------------------------------------------
        # Normalize possible camelCase field returned by the LLM
        # ---------------------------------------------------------
        if "requiresApproval" in data and "requires_approval" not in data:
            data["requires_approval"] = data.pop("requiresApproval")

        # ---------------------------------------------------------
        # Normalize possible alternative target field names
        # ---------------------------------------------------------
        if "targetIP" in data and "target_ip" not in data:
            data["target_ip"] = data.pop("targetIP")

        # ---------------------------------------------------------
        # Validate against Pydantic schema
        # ---------------------------------------------------------
        result = RuleGeneratorOutput.model_validate(data)

    except Exception as exc:
        raise ValueError(
            f"Rule Generator returned invalid output: {exc}\n"
            f"Raw response: {raw_response}"
        )

    print("[Agent 5 - Rule Generator] Rule generation completed.")
    print(f"    ├─ Rule Type       : {result.rule_type}")
    print(f"    ├─ Target IP       : {result.target_ip}")
    print(f"    ├─ Protocol        : {result.protocol}")
    print(f"    ├─ Direction       : {result.direction}")
    print(f"    └─ Requires Approval: {result.requires_approval}")

    return result