CRITICAL_INFRASTRUCTURE_IPS = [
    "192.168.1.1",    # Gateway
    "192.168.1.10",   # SDN Controller
    "10.0.0.1"        # Core DNS
]

def validate_action(proposed_action: str, target_ip: str) -> dict:
    if target_ip in CRITICAL_INFRASTRUCTURE_IPS and proposed_action == "BLOCK_IP":
        return {
            "approved": False,
            "reason": f"CRITICAL GUARDRAIL TRIGGERED: Cannot block critical IP {target_ip}!",
            "override_action": "ALERT_HUMAN_ANALYST"
        }
    
    if proposed_action in ["SHUTDOWN_INTERFACE", "REBOOT_FIREWALL"]:
        return {
            "approved": False,
            "reason": f"High risk action '{proposed_action}' requires Human Approval.",
            "override_action": "PENDING_HUMAN_APPROVAL"
        }

    return {
        "approved": True,
        "reason": "Action passed security guardrails.",
        "override_action": proposed_action
    }