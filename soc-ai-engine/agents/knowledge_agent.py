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
) -> KnowledgeAgentOutput:
    """
    Agent #7 - Knowledge Agent

    Converts the validated incident information into
    reusable security knowledge.

    This agent does NOT execute security actions.
    """

    print("\n[Agent 7 - Knowledge Agent] Building knowledge...")

    knowledge_id = f"KNOW-{uuid.uuid4().hex[:8].upper()}"

    prompt = f"""
You are the Knowledge Agent in an Autonomous SOC.

Your job is to extract reusable knowledge from a completed
security incident analysis.

Do NOT create a new decision.

Do NOT execute any action.

Do NOT change the existing decision.

Use ONLY the information provided below.

ATTACK ANALYSIS:
{attack_data.model_dump_json(indent=2)}

THREAT CORRELATION:
{correlation_data.model_dump_json(indent=2)}

RISK ASSESSMENT:
{risk_data.model_dump_json(indent=2)}

DECISION:
{decision_data.model_dump_json(indent=2)}

RULE:
{rule_data.model_dump_json(indent=2)}

EXPLANATION:
{explanation_data.model_dump_json(indent=2)}

Extract:

1. Event type.
2. Source IP if available.
3. Final validated/recommended action.
4. Validation status.
5. Confidence.
6. A reusable lesson.
7. A reusable attack pattern that can help future correlation.

Important:

- Do not invent facts.
- Do not claim the rule was actually executed.
- The action is a recommendation unless explicitly validated elsewhere.
- Knowledge should be useful for future security events.
- Return ONLY valid JSON.

Required JSON:

{{
    "event_type": "Attack type",
    "source_ip": "IP or null",
    "validated_action": "Action",
    "validation_status": "APPROVED / OVERRIDDEN / REJECTED / PENDING",
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

        data["knowledge_id"] = knowledge_id

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
