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
) -> ThreatCorrelatorOutput:
    """
    Agent #2 - Threat Correlator

    Correlates the current attack analysis with
    previous/current security events.
    """

    print("\n[Agent 2 - Threat Correlator] Correlating events...")

    events_json = json.dumps(
        historical_events,
        indent=2,
        default=str,
    )

    prompt = f"""
You are the Threat Correlator Agent in an Autonomous SOC.

You receive:

CURRENT ATTACK ANALYSIS:
{attack_data.model_dump_json(indent=2)}

HISTORICAL / CURRENT SECURITY EVENTS:
{events_json}

Your task is to determine whether the current event is related
to previous or current security events.

Correlation should consider:
- Source IP
- Attack type
- MITRE ATT&CK technique
- Repeated activity
- Similar indicators
- Temporal or behavioral patterns

Important rules:
1. Use ONLY the supplied events.
2. Do not invent historical events.
3. If there are no related events, return NO_MATCH.
4. If repeated or suspicious behavior exists, return SUSPICIOUS_PATTERN.
5. If clearly related events exist, return RELATED.
6. Confidence must be between 0.0 and 1.0.
7. Return ONLY valid JSON.

Required JSON:

{{
    "related_event_count": 0,
    "correlation_status": "RELATED / NO_MATCH / SUSPICIOUS_PATTERN",
    "related_ips": [],
    "related_attack_types": [],
    "pattern": "Short explanation",
    "confidence": 0.0
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

        result = ThreatCorrelatorOutput.model_validate(data)

    except Exception as exc:
        raise ValueError(
            f"Threat Correlator returned invalid output: {exc}\n"
            f"Raw response: {raw_response}"
        )

    print("[Agent 2 - Threat Correlator] Correlation completed.")
    print(f"    ├─ Status       : {result.correlation_status}")
    print(f"    ├─ Related      : {result.related_event_count}")
    print(f"    ├─ Related IPs  : {result.related_ips}")
    print(f"    └─ Confidence   : {result.confidence}")

    return result