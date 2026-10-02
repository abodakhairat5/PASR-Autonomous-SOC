import json
import ollama
import re

from schemas.agent_outputs import AttackAnalyzerOutput
from services.mitre_attack import get_mitre_mapping

MODEL_NAME = "qwen2.5:7b"


def attack_analyzer_agent(raw_log: str) -> AttackAnalyzerOutput:
    """
    Agent #1 - Attack Analyzer

    Supports:
    - Network security events
    - Pentest security findings

    Extracts:
    - Event type
    - Source IP when available
    - Pentest finding ID when available
    - Pentest target URL when available
    - Attack / vulnerability type
    - MITRE ATT&CK technique when applicable
    - Confidence
    - Indicators
    - Summary
    """

    print("\n[Agent 1 - Attack Analyzer] Analyzing security event...")

    prompt = f"""
You are the Attack Analyzer Agent in an Autonomous Security Operations Center (SOC).

Analyze the following security event:

============================================================
SECURITY EVENT
============================================================

{raw_log}

============================================================
EVENT TYPE
============================================================

Classify the event as exactly one of:

- NETWORK
- PENTEST

NETWORK events represent network/security activity.

PENTEST events represent security findings produced by
a penetration testing or security testing workflow.

A PENTEST event may contain:

- Finding ID
- Confirmed Finding
- Vulnerability title
- Target URL
- Severity
- Impact
- Evidence

============================================================
NETWORK ATTACK TYPES
============================================================

For NETWORK events, use one of:

- SYN_FLOOD
- PORT_SCAN
- BRUTE_FORCE
- NORMAL
- OTHER

============================================================
PENTEST VULNERABILITY TYPES
============================================================

For PENTEST events, use one of:

- SQL_INJECTION
- IDOR
- XSS
- BROKEN_ACCESS_CONTROL
- SSRF
- RCE
- AUTHENTICATION_BYPASS
- PATH_TRAVERSAL
- OTHER

============================================================
ANALYSIS RULES
============================================================

1. Determine the event_type from the supplied event.

2. Extract source_ip only when an actual IP address is explicitly
   present in the event.

3. NEVER use any of the following as source_ip:

   - "pentest"
   - "unknown"
   - a URL
   - a hostname
   - a finding ID
   - a vulnerability name

4. If the event is PENTEST and no real source IP exists,
   source_ip MUST be null.

5. If the event contains a Pentest Finding ID, extract it exactly
   into finding_id.

6. If the event contains a target URL, extract it exactly
   into target_url.

7. For NETWORK events:

   finding_id MUST be null.
   target_url MUST be null.

8. Identify the attack or vulnerability type using ONLY evidence
   contained in the supplied event.

9. Do NOT invent an attack, vulnerability, IP, URL, finding ID,
   technique, indicator, or evidence.

10. Provide a MITRE ATT&CK technique ID only when the supplied
    evidence is sufficient.

11. If there is insufficient evidence for a MITRE technique,
    technique_id MUST be null.

12. Confidence must be a number between 0.0 and 1.0.

13. Indicators must contain concrete evidence directly supported
    by the supplied event.

14. The summary must briefly explain the classification and must
    not introduce information that is not present in the event.

15. Return ONLY valid JSON.

============================================================
IMPORTANT PENTEST RULE
============================================================

A confirmed PENTEST vulnerability is NOT automatically a network
attack.

For example:

SQL Injection
IDOR
XSS
Broken Access Control

must be represented as a PENTEST vulnerability.

Do not convert a Pentest finding into SYN_FLOOD, PORT_SCAN,
BRUTE_FORCE, or another network attack unless the supplied event
actually contains evidence for that network attack.

============================================================
REQUIRED JSON STRUCTURE
============================================================

{{
    "event_type": "NETWORK or PENTEST",
    "source_ip": "actual source IP or null",
    "finding_id": "Pentest finding ID or null",
    "target_url": "Target URL or null",
    "attack_type": "attack or vulnerability type",
    "technique_id": "MITRE ATT&CK technique ID or null",
    "confidence": 0.0,
    "indicators": [],
    "summary": "Short explanation based only on supplied evidence"
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

        result = AttackAnalyzerOutput.model_validate(data)

    except Exception as exc:
        raise ValueError(
            f"Attack Analyzer returned invalid output: {exc}\n"
            f"Raw response: {raw_response}"
        )

    # ============================================================
    # Deterministic Source IP Extraction
    # ============================================================

    ip_matches = re.findall(
        r"\b(?:\d{1,3}\.){3}\d{1,3}\b",
        raw_log
    )

    if ip_matches:
        result.source_ip = ip_matches[0]


    # ============================================================
    # MITRE ATT&CK authoritative mapping
    # ============================================================

    mitre = get_mitre_mapping(result.attack_type)

    if mitre:
        result.technique_id = mitre["technique_id"]

        print(
            f"[Agent 1 - Attack Analyzer] "
            f"MITRE mapping: "
            f"{mitre['technique_id']} - "
            f"{mitre['technique_name']}"
        )
    else:
        result.technique_id = None


    print("[Agent 1 - Attack Analyzer] Analysis completed.")
    print(f"    ├─ Event Type  : {result.event_type}")
    print(f"    ├─ Finding ID  : {result.finding_id}")
    print(f"    ├─ Target URL  : {result.target_url}")
    print(f"    ├─ Attack Type : {result.attack_type}")
    print(f"    ├─ Source IP   : {result.source_ip}")
    print(f"    └─ Technique   : {result.technique_id}")

    return result