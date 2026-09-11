from typing import List

from schemas.agent_outputs import RuleGeneratorOutput
from .engine import RuntimeEngine
from .models import RuntimeRule, RuntimeRuleStatus


class RuntimeManager:
    def __init__(self):
        self.engine = RuntimeEngine()

    def create_rule(self, rule_result: RuleGeneratorOutput) -> RuntimeRule:
        return self.engine.propose_rule(rule_result)

    def validate_rule(self, rule_id: str) -> RuntimeRule:
        rule = self._get_rule(rule_id)
        return self.engine.validate_rule(rule)

    def approve_rule(self, rule_id: str) -> RuntimeRule:
        return self.engine.approve_rule(rule_id)

    def apply_rule(self, rule_id: str) -> RuntimeRule:
        rule = self._get_rule(rule_id)
        return self.engine.apply_rule(rule)

    def rollback_rule(self, rule_id: str) -> RuntimeRule:
        return self.engine.rollback_rule(rule_id)

    def get_rule(self, rule_id: str) -> RuntimeRule:
        return self._get_rule(rule_id)

    def get_all_rules(self) -> List[RuntimeRule]:
        return list(self.engine.rules.values())

    def get_active_rules(self) -> List[RuntimeRule]:
        return list(self.engine.active_rules.values())

    def get_rules_by_status(
        self,
        status: RuntimeRuleStatus,
    ) -> List[RuntimeRule]:
        return [
            rule
            for rule in self.engine.rules.values()
            if rule.status == status
        ]

    def _get_rule(self, rule_id: str) -> RuntimeRule:
        rule = self.engine.rules.get(rule_id)

        if rule is None:
            raise ValueError(f"Runtime rule not found: {rule_id}")

        return rule


runtime_manager = RuntimeManager()