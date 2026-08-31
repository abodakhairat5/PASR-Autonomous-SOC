import json
import ollama

from schemas.agent_outputs import AttackAnalyzerOutput


MODEL_NAME = "qwen2.5:7b"


def attack_analyzer_agent(raw_log: str) -> AttackAnalyzerOutput:
    """
    Agent #1 - Attack Analyzer

    Analyzes a raw security event and identifies:
    - Source IP
    - Attack type
    - MITRE ATT&CK technique
    - Confidence
    - Indicators
    - Summary
    """

    print("\n[Agent 1 - Attack Analyzer] Analyzing security event...")

    prompt = f"""
You are the Attack Analyzer Agent in an Autonomous Security Operations Center (SOC).

Analyze the following raw security event:

{raw_log}

Your task is to identify the most likely attack type and relevant MITRE ATT&CK technique.

Allowed attack types:
- SYN_FLOOD
- PORT_SCAN
- BRUTE_FORCE
- NORMAL
- OTHER

Rules:
1. Extract the source IP if it exists.
2. Identify the attack type based only on evidence in the event.
3. Provide a MITRE ATT&CK technique ID when you have sufficient evidence.
4. If there is not enough evidence for a technique, return null.
5. Confidence must be between 0.0 and 1.0.
6. List concrete indicators from the event.
7. Do not invent evidence.
8. Return ONLY valid JSON.

Required JSON structure:

{{
    "source_ip": "IP address or null",
    "attack_type": "SYN_FLOOD / PORT_SCAN / BRUTE_FORCE / NORMAL / OTHER",
    "technique_id": "MITRE ATT&CK technique ID or null",
    "confidence": 0.0,
    "indicators": [],
    "summary": "Short explanation"
}}
"""

    response = ollama.chat(
        model=MODEL_NAME,
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ],
        format="json"
    )

    raw_response = response["message"]["content"]

    try:
        data = json.loads(raw_response)
        result = AttackAnalyzerOutput.model_validate(data)

    except Exception as exc:
        raise ValueError(
            f"Attack Analyzer returned invalid output: {exc}\n"
            f"Raw response: {raw_response}"
        )

    print("[Agent 1 - Attack Analyzer] Analysis completed.")
    print(f"    ├─ Attack Type : {result.attack_type}")
    print(f"    ├─ Source IP   : {result.source_ip}")
    print(f"    ├─ Technique   : {result.technique_id}")
    print(f"    └─ Confidence  : {result.confidence}")

    return result