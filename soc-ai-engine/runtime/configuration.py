from .models import RuntimeRule


class ConfigurationService:

    def generate_config(self, rule: RuntimeRule) -> str:
        if rule.rule_type == "BLOCK":
            return (
                f"# PASR Runtime Rule: {rule.rule_id}\n"
                f"deny {rule.target_ip};\n"
            )

        if rule.rule_type == "THROTTLE":
            return (
                f"# PASR Runtime Rule: {rule.rule_id}\n"
                f"# THROTTLE {rule.target_ip}\n"
            )

        if rule.rule_type == "ISOLATE":
            return (
                f"# PASR Runtime Rule: {rule.rule_id}\n"
                f"# ISOLATE {rule.target_ip}\n"
            )

        if rule.rule_type == "ALERT":
            return (
                f"# PASR Runtime Rule: {rule.rule_id}\n"
                f"# ALERT {rule.target_ip}\n"
            )

        raise ValueError(
            f"Unsupported runtime rule type: {rule.rule_type}"
        )

    def validate_config(self, config: str) -> bool:
        if not config.strip():
            return False

        if "deny None" in config:
            return False

        return True


configuration_service = ConfigurationService()