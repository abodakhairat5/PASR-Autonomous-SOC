from .configuration import configuration_service
from .models import RuntimeRule


class DeploymentService:

    def deploy(self, rule: RuntimeRule) -> dict:
        config = configuration_service.generate_config(rule)

        if not configuration_service.validate_config(config):
            raise ValueError(
                f"Invalid configuration for rule '{rule.rule_id}'."
            )

        return {
            "rule_id": rule.rule_id,
            "status": "DEPLOYED",
            "config": config,
            "message": "Runtime configuration deployed successfully.",
        }


deployment_service = DeploymentService()