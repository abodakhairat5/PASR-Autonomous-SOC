import json
import os
import urllib.request
from typing import Any


# ============================================================
# MITRE ATT&CK official Enterprise data
# ============================================================

MITRE_ATTACK_URL = (
    "https://raw.githubusercontent.com/mitre-attack/"
    "attack-stix-data/master/enterprise-attack/"
    "enterprise-attack.json"
)

CACHE_FILE = os.path.join(
    os.path.dirname(__file__),
    "mitre_attack_cache.json",
)


# ============================================================
# Local semantic mapping
# ============================================================
#
# The AI identifies the security event.
# This mapping tells the service which MITRE technique concept
# to search for in the official MITRE dataset.
#
# IMPORTANT:
# We do NOT directly trust an AI-generated technique ID.
# The final ID comes from MITRE's official STIX data.
# ============================================================

ATTACK_TYPE_TO_MITRE_NAME = {
    # Network
    "BRUTE_FORCE": "Brute Force",
    "PORT_SCAN": "Network Service Scanning",
    "SYN_FLOOD": "Network Denial of Service",

    # Web / Pentest
    "SQL_INJECTION": "Exploit Public-Facing Application",
    "IDOR": "Exploitation of Remote Services",
    "XSS": "Content Injection",
    "BROKEN_ACCESS_CONTROL": "Exploitation for Privilege Escalation",
    "SSRF": "Server-Side Request Forgery",
    "RCE": "Command and Scripting Interpreter",
    "AUTHENTICATION_BYPASS": "Valid Accounts",
    "PATH_TRAVERSAL": "Exploitation for Client Execution",
}


# ============================================================
# Official fallback IDs
# ============================================================
#
# These are ONLY fallback values if the official dataset cannot
# be downloaded. Normal operation resolves them from MITRE data.
# ============================================================

FALLBACK_TECHNIQUES = {
    "Brute Force": {
        "id": "T1110",
        "name": "Brute Force",
    },
    "Exploit Public-Facing Application": {
        "id": "T1190",
        "name": "Exploit Public-Facing Application",
    },
    "Network Service Scanning": {
        "id": "T1046",
        "name": "Network Service Scanning",
    },
    "Network Denial of Service": {
        "id": "T1498",
        "name": "Network Denial of Service",
    },
    "Content Injection": {
        "id": "T1659",
        "name": "Content Injection",
    },
    "Server-Side Request Forgery": {
        "id": "T1190",
        "name": "Exploit Public-Facing Application",
    },
    "Valid Accounts": {
        "id": "T1078",
        "name": "Valid Accounts",
    },
    "Exploitation of Remote Services": {
        "id": "T1210",
        "name": "Exploitation of Remote Services",
    },
    "Command and Scripting Interpreter": {
        "id": "T1059",
        "name": "Command and Scripting Interpreter",
    },
    "Exploitation for Client Execution": {
        "id": "T1203",
        "name": "Exploitation for Client Execution",
    },
    "Exploitation for Privilege Escalation": {
        "id": "T1068",
        "name": "Exploitation for Privilege Escalation",
    },
}


# ============================================================
# Download MITRE data
# ============================================================

def _download_mitre_data() -> dict[str, Any]:
    """
    Download the official MITRE ATT&CK Enterprise STIX dataset.

    The result is cached locally so the SOC does not need to hit
    the MITRE source on every single event.
    """

    request = urllib.request.Request(
        MITRE_ATTACK_URL,
        headers={
            "User-Agent": "PASR-Autonomous-SOC/1.0"
        },
    )

    with urllib.request.urlopen(request, timeout=15) as response:
        data = response.read()

    parsed = json.loads(data.decode("utf-8"))

    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(parsed, f, ensure_ascii=False)

    return parsed


# ============================================================
# Load MITRE data
# ============================================================

def _load_mitre_data() -> dict[str, Any]:
    """
    Load MITRE data from cache first.

    If cache does not exist, download official MITRE data.
    """

    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            pass

    return _download_mitre_data()


# ============================================================
# Search technique
# ============================================================

def find_technique_by_name(
    technique_name: str,
) -> dict[str, Any] | None:
    """
    Search the official MITRE ATT&CK Enterprise dataset by
    technique name.

    Returns:

    {
        "technique_id": "T1190",
        "technique_name": "Exploit Public-Facing Application",
        "url": "https://attack.mitre.org/techniques/T1190/"
    }
    """

    try:
        data = _load_mitre_data()
    except Exception as exc:
        print(
            f"[MITRE] Could not load official ATT&CK data: {exc}"
        )
        return None

    objects = data.get("objects", [])

    wanted = technique_name.strip().lower()

    for obj in objects:

        if obj.get("type") != "attack-pattern":
            continue

        name = obj.get("name", "").strip()

        if name.lower() != wanted:
            continue

        external_references = obj.get(
            "external_references",
            [],
        )

        technique_id = None

        for reference in external_references:

            source_name = reference.get("source_name")

            external_id = reference.get(
                "external_id"
            )

            if (
                source_name == "mitre-attack"
                and external_id
                and external_id.startswith("T")
            ):
                technique_id = external_id
                break

        if not technique_id:
            continue

        return {
            "technique_id": technique_id,
            "technique_name": name,
            "url": (
                f"https://attack.mitre.org/techniques/"
                f"{technique_id}/"
            ),
        }

    return None


# ============================================================
# Resolve attack type → MITRE
# ============================================================

def resolve_mitre_technique(
    attack_type: str,
) -> dict[str, Any] | None:
    """
    Resolve an internal PASR attack type to an official
    MITRE ATT&CK technique.

    The returned technique ID is obtained from the official
    MITRE ATT&CK dataset whenever available.
    """

    if not attack_type:
        return None

    normalized = attack_type.strip().upper()

    technique_name = ATTACK_TYPE_TO_MITRE_NAME.get(
        normalized
    )

    if not technique_name:
        return None

    # --------------------------------------------------------
    # First: official MITRE dataset
    # --------------------------------------------------------

    result = find_technique_by_name(
        technique_name
    )

    if result:
        return result

    # --------------------------------------------------------
    # Second: safe fallback
    # --------------------------------------------------------

    fallback = FALLBACK_TECHNIQUES.get(
        technique_name
    )

    if not fallback:
        return None

    return {
        "technique_id": fallback["id"],
        "technique_name": fallback["name"],
        "url": (
            f"https://attack.mitre.org/techniques/"
            f"{fallback['id']}/"
        ),
    }


# ============================================================
# Public helper
# ============================================================

def get_mitre_mapping(
    attack_type: str,
) -> dict[str, Any] | None:
    """
    Public API used by the Attack Analyzer.
    """

    result = resolve_mitre_technique(
        attack_type
    )

    if result:
        print(
            "[MITRE] Mapping completed."
        )
        print(
            f"    ├─ Attack Type : {attack_type}"
        )
        print(
            f"    ├─ Technique   : "
            f"{result['technique_id']}"
        )
        print(
            f"    ├─ Name        : "
            f"{result['technique_name']}"
        )
        print(
            f"    └─ URL         : "
            f"{result['url']}"
        )
    else:
        print(
            f"[MITRE] No technique mapping found "
            f"for: {attack_type}"
        )

    return result