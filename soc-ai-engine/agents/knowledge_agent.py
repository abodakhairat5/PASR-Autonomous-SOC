import json
import uuid
import ollama

from schemas.agent_outputs import (
    AttackAnalyzerOutput,
    ThreatCorrelatorOutput,
    RiskAssessmentOutput,
    DecisionAgentOutput,
    RuleGeneratorOutput,
    ExplanationAgentOutput,
    KnowledgeAgentOutput,
)


MODEL_NAME = "qwen2.5:7b"


def knowledge_agent(
    attack_data: AttackAnalyzerOutput,
    correlation_data: ThreatCorrelatorOutput,
    risk_data: RiskAssessmentOutput,
    decision_data: DecisionAgentOutput,
    rule_data: RuleGeneratorOutput,
    explanation_data: ExplanationAgentOutput,
    guardrail_data: dict,
    runtime_data: dict,
) -> KnowledgeAgentOutput:
    """
    Agent #7 - Knowledge Agent

    Builds reusable security knowledge from the complete
    incident lifecycle.

    This agent does NOT execute actions.
    It records the actual final outcome produced by
    Guardrails and Runtime Engine.
    """

    print("\n[Agent 7 - Knowledge Agent] Building knowledge...")

    knowledge_id = f"KNOW-{uuid.uuid4().hex[:8].upper()}"

    final_action = guardrail_data.get(
        "override_action",
        decision_data.recommended_action
    )

    guardrail_approved = guardrail_data.get(
        "approved",
        False
    )

    runtime_status = runtime_data.get(
        "status",
        "UNKNOWN"
    )

    # ---------------------------------------------------------
    # Determine the authoritative validation status
    # ---------------------------------------------------------

    if not guardrail_approved:
        validation_status = "REJECTED"

    elif runtime_status == "ACTIVE":
        validation_status = "APPROVED"

    elif runtime_status == "PENDING_APPROVAL":
        validation_status = "PENDING"

    elif runtime_status == "REJECTED":
        validation_status = "REJECTED"

    else:
        validation_status = "PENDING"

    prompt = f"""
You are the Knowledge Agent in an Autonomous SOC.

Your job is to extract reusable knowledge from a COMPLETED
security incident lifecycle.

Do NOT create a new decision.

Do NOT execute any action.

Do NOT change the final action.

The Guardrails and Runtime Engine results are authoritative.

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

EXPLANATION:
{explanation_data.model_dump_json(indent=2)}

GUARDRAILS RESULT:
{json.dumps(guardrail_data, indent=2)}

RUNTIME RESULT:
{json.dumps(runtime_data, indent=2)}

AUTHORITATIVE FINAL ACTION:
{final_action}

AUTHORITATIVE VALIDATION STATUS:
{validation_status}

Extract reusable security knowledge.

Requirements:

1. event_type:
   Use the detected attack type.

2. source_ip:
   Use the source IP from the attack analysis.

3. validated_action:
   MUST use the AUTHORITATIVE FINAL ACTION.
   Do NOT replace it with the original AI recommendation.

4. validation_status:
   MUST use the AUTHORITATIVE VALIDATION STATUS.
   Do NOT invent another status.

5. confidence:
   Use the strongest relevant confidence from the
   provided analysis.

6. lesson:
   Explain what this incident teaches the SOC.

7. reusable_pattern:
   Describe a pattern that can help future threat correlation.

Important:

- Do not invent facts.
- Do not claim an action was executed unless Runtime Result
  confirms it.
- Guardrails override AI recommendations when they reject them.
- Runtime status is authoritative for execution state.
- Return ONLY valid JSON.

Required JSON:

{{
    "event_type": "Attack type",
    "source_ip": "IP or null",
    "validated_action": "{final_action}",
    "validation_status": "{validation_status}",
    "confidence": 0.0,
    "lesson": "Reusable security lesson",
    "reusable_pattern": "Pattern useful for future correlation"
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

        # -----------------------------------------------------
        # Force authoritative system values.
        # The LLM must NOT override these.
        # -----------------------------------------------------

        data["knowledge_id"] = knowledge_id
        data["validated_action"] = final_action
        data["validation_status"] = validation_status

        result = KnowledgeAgentOutput.model_validate(data)

    except Exception as exc:
        raise ValueError(
            f"Knowledge Agent returned invalid output: {exc}\n"
            f"Raw response: {raw_response}"
        )

    print("[Agent 7 - Knowledge Agent] Knowledge generation completed.")
    print(f"    ├─ Knowledge ID : {result.knowledge_id}")
    print(f"    ├─ Event Type   : {result.event_type}")
    print(f"    ├─ Action       : {result.validated_action}")
    print(f"    ├─ Status       : {result.validation_status}")
    print(f"    └─ Confidence   : {result.confidence}")

    return result