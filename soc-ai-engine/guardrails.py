# ============================================================
# PASR Autonomous SOC - Security Guardrails
# ============================================================

CRITICAL_INFRASTRUCTURE_IPS = {
    "192.168.1.1",   # Gateway
    "192.168.1.10",  # SDN Controller
    "10.0.0.1",      # Core DNS
}

HIGH_RISK_ACTIONS = {
    "SHUTDOWN_INTERFACE",
    "REBOOT_FIREWALL",
    "ISOLATE_NETWORK",
}


def validate_action(proposed_action: str, target_ip: str) -> dict:
    """
    Validate an AI-proposed security action before execution.

    The Guardrails Engine is the final safety layer between
    AI recommendations and executable actions.
    """

    action = (proposed_action or "").strip().upper()
    ip = (target_ip or "").strip()

    # ========================================================
    # Guardrail 1 - Critical Infrastructure Protection
    # ========================================================

    if ip in CRITICAL_INFRASTRUCTURE_IPS and action in {
        "BLOCK",
        "BLOCK_IP",
    }:
        return {
            "approved": False,
            "reason": (
                f"CRITICAL GUARDRAIL TRIGGERED: "
                f"Cannot block critical infrastructure IP {ip}."
            ),
            "override_action": "ALERT_HUMAN_ANALYST",
        }

    # ========================================================
    # Guardrail 2 - High Risk Actions
    # ========================================================

    if action in HIGH_RISK_ACTIONS:
        return {
            "approved": False,
            "reason": (
                f"High risk action '{action}' "
                f"requires Human Approval."
            ),
            "override_action": "PENDING_HUMAN_APPROVAL",
        }

    # ========================================================
    # Guardrail 3 - Unknown / Invalid Action
    # ========================================================

    allowed_actions = {
        "BLOCK",
        "BLOCK_IP",
        "THROTTLE",
        "ALERT",
        "ALERT_HUMAN_ANALYST",
        "INVESTIGATE",
        "IGNORE",
    }

    if action not in allowed_actions:
        return {
            "approved": False,
            "reason": (
                f"Unknown or unsupported action '{action}'. "
                f"Execution is denied by default."
            ),
            "override_action": "ALERT_HUMAN_ANALYST",
        }

    # ========================================================
    # Guardrail Passed
    # ========================================================

    return {
        "approved": True,
        "reason": "Action passed security guardrails.",
        "override_action": action,
    }