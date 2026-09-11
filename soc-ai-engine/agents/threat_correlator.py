import json
import ollama

from schemas.agent_outputs import (
    AttackAnalyzerOutput,
    ThreatCorrelatorOutput,
)


MODEL_NAME = "qwen2.5:7b"


def threat_correlator_agent(
    attack_data: AttackAnalyzerOutput,
    historical_events: list[dict],
    historical_knowledge: list[dict] | None = None,
) -> ThreatCorrelatorOutput:
    """
    Agent #2 - Threat Correlator

    Correlates the current attack analysis with:
    - previous security events
    - previously validated knowledge patterns

    Historical knowledge is treated as evidence/context only.
    It must never override Guardrails or directly authorize an action.
    """

    print("\n[Agent 2 - Threat Correlator] Correlating events...")

    # ------------------------------------------------------------
    # Normalize optional knowledge input
    # ------------------------------------------------------------

    if historical_knowledge is None:
        historical_knowledge = []

    # ------------------------------------------------------------
    # Prepare historical data for the LLM
    # ------------------------------------------------------------

    events_json = json.dumps(
        historical_events,
        indent=2,
        default=str,
    )

    knowledge_json = json.dumps(
        historical_knowledge,
        indent=2,
        default=str,
    )

    # ------------------------------------------------------------
    # Threat Correlation Prompt
    # ------------------------------------------------------------

    prompt = f"""
You are the Threat Correlator Agent in an Autonomous SOC.

Your role is to correlate the current security event with
historical events and previously validated security knowledge.

You receive:

CURRENT ATTACK ANALYSIS:
{attack_data.model_dump_json(indent=2)}

HISTORICAL / CURRENT SECURITY EVENTS:
{events_json}

PREVIOUSLY VALIDATED SECURITY KNOWLEDGE:
{knowledge_json}

Your task is to determine whether the current event is related
to previous or current security activity.

Correlation should consider:

- Source IP
- Attack type
- MITRE ATT&CK technique
- Repeated activity
- Similar indicators
- Temporal patterns
- Behavioral patterns
- Previously observed reusable security patterns
- Previous validated knowledge associated with the source

IMPORTANT RULES:

1. Use ONLY the supplied events and knowledge.

2. Do NOT invent historical events.

3. Previous knowledge is evidence/context only.

4. Previous knowledge must NOT authorize or execute a security action.

5. Previous knowledge must NOT override Guardrails.

6. Do NOT assume that a previous action should automatically
   be repeated for the current event.

7. The current attack analysis is the primary description
   of the current event.

8. Historical events provide evidence about previous behavior.

9. Historical knowledge provides previously validated lessons
   and reusable behavioral patterns.

10. If there are no related historical events and no useful
    knowledge patterns, return NO_MATCH.

11. If repeated or suspicious behavior exists but the relationship
    is not strong enough to be considered clearly related,
    return SUSPICIOUS_PATTERN.

12. If clearly related historical events exist, return RELATED.

13. related_event_count must count related historical EVENTS only.

14. Do NOT count knowledge records as historical events.

15. related_ips must contain ONLY IP addresses that appear
    in the supplied current or historical data.

16. related_attack_types must contain ONLY attack types that
    appear in the supplied current or historical data.

17. Do NOT invent IP addresses, attack types, techniques,
    timestamps, or security events.

18. Confidence must be between 0.0 and 1.0.

19. Return ONLY valid JSON.

20. The correlation result is advisory evidence for later agents.
    It does NOT directly determine the final security action.

Required JSON:

{{
    "related_event_count": 0,
    "correlation_status": "RELATED / NO_MATCH / SUSPICIOUS_PATTERN",
    "related_ips": [],
    "related_attack_types": [],
    "pattern": "Short explanation of the observed correlation",
    "confidence": 0.0
}}
"""

    # ------------------------------------------------------------
    # Call Ollama / Qwen
    # ------------------------------------------------------------

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

    # ------------------------------------------------------------
    # Validate LLM output
    # ------------------------------------------------------------

    try:
        data = json.loads(raw_response)

        result = ThreatCorrelatorOutput.model_validate(data)

    except Exception as exc:
        raise ValueError(
            f"Threat Correlator returned invalid output: {exc}\n"
            f"Raw response: {raw_response}"
        )

    # ------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------

    print("[Agent 2 - Threat Correlator] Correlation completed.")
    print(f"    ├─ Status       : {result.correlation_status}")
    print(f"    ├─ Related      : {result.related_event_count}")
    print(f"    ├─ Related IPs  : {result.related_ips}")
    print(f"    ├─ Attack Types : {result.related_attack_types}")
    print(f"    ├─ Knowledge    : {len(historical_knowledge)}")
    print(f"    └─ Confidence   : {result.confidence}")

    return result