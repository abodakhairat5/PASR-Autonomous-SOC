import json
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from schemas.agent_outputs import RuleGeneratorOutput
from .models import RuntimeRule, RuntimeRuleStatus
from .configuration import configuration_service

DB_NAME = "soc_threats.db"


class RuntimeEngine:
    def __init__(self):
        self.rules = {}
        self.active_rules = {}

        # Load persisted rules from SQLite
        self._load_rules()

    # ============================================================
    # Create / Propose
    # ============================================================

    def propose_rule(self, rule_result: RuleGeneratorOutput) -> RuntimeRule:
        runtime_rule = RuntimeRule(
            rule_id=f"rule-{uuid4().hex[:8]}",
            rule_type=rule_result.rule_type,
            target_ip=rule_result.target_ip,
            protocol=rule_result.protocol,
            direction=rule_result.direction,
            parameters=rule_result.parameters,
            rule_description=rule_result.rule_description,
            requires_approval=rule_result.requires_approval,
            status=RuntimeRuleStatus.PROPOSED,
            created_at=self._timestamp(),
        )

        self._save_rule(runtime_rule)

        return runtime_rule

    # ============================================================
    # Validate
    # ============================================================

    def validate_rule(self, rule: RuntimeRule) -> RuntimeRule:
        if not rule.rule_type:
            return self._reject(rule, "Rule type is missing.")

        if not rule.direction:
            return self._reject(rule, "Rule direction is missing.")

        if rule.requires_approval:
            rule.status = RuntimeRuleStatus.PENDING_APPROVAL
        else:
            rule.status = RuntimeRuleStatus.VALIDATED

        self._save_rule(rule)

        return rule

    # ============================================================
    # Approve
    # ============================================================

    def approve_rule(self, rule_id: str) -> RuntimeRule:
        rule = self.rules.get(rule_id)

        if rule is None:
            raise ValueError(
                f"Runtime rule '{rule_id}' was not found."
            )

        if rule.status != RuntimeRuleStatus.PENDING_APPROVAL:
            raise ValueError(
                f"Rule cannot be approved from status '{rule.status}'."
            )

        rule.status = RuntimeRuleStatus.VALIDATED

        self._save_rule(rule)

        return rule

    # ============================================================
    # Apply
    # ============================================================
    def apply_rule(self, rule: RuntimeRule) -> RuntimeRule:
        if rule.status == RuntimeRuleStatus.PENDING_APPROVAL:
            raise ValueError(
                "Rule requires human approval before activation."
            )

        if rule.status != RuntimeRuleStatus.VALIDATED:
            raise ValueError(
                f"Rule cannot be activated from status '{rule.status}'."
            )

        # Generate proxy/runtime configuration
        config = configuration_service.generate_config(rule)

        # Validate generated configuration before activation
        if not configuration_service.validate_config(config):
            raise ValueError(
                f"Generated configuration for rule '{rule.rule_id}' is invalid."
            )

        # Activate only after successful configuration validation
        rule.status = RuntimeRuleStatus.ACTIVE
        rule.applied_at = self._timestamp()

        self._save_rule(rule)

        self.active_rules[rule.rule_id] = rule

        return rule

    # ============================================================
    # Rollback
    # ============================================================

    def rollback_rule(self, rule_id: str) -> RuntimeRule:
        rule = self.active_rules.get(rule_id)

        if rule is None:
            raise ValueError(
                f"Active runtime rule '{rule_id}' was not found."
            )

        rule.status = RuntimeRuleStatus.ROLLED_BACK
        rule.rolled_back_at = self._timestamp()

        self._save_rule(rule)

        del self.active_rules[rule_id]

        return rule

    # ============================================================
    # Reject
    # ============================================================

    def _reject(self, rule: RuntimeRule, reason: str) -> RuntimeRule:
        rule.status = RuntimeRuleStatus.REJECTED
        rule.rejection_reason = reason

        self._save_rule(rule)

        return rule

    # ============================================================
    # Database Persistence
    # ============================================================

    def _save_rule(self, rule: RuntimeRule):
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT OR REPLACE INTO runtime_rules (
                rule_id,
                rule_type,
                target_ip,
                protocol,
                direction,
                parameters,
                rule_description,
                requires_approval,
                status,
                created_at,
                applied_at,
                rolled_back_at,
                rejection_reason
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rule.rule_id,
                rule.rule_type,
                rule.target_ip,
                rule.protocol,
                rule.direction,
                json.dumps(rule.parameters),
                rule.rule_description,
                rule.requires_approval,
                rule.status.value,
                rule.created_at,
                rule.applied_at,
                rule.rolled_back_at,
                rule.rejection_reason,
            ),
        )

        conn.commit()
        conn.close()

        # Keep in-memory cache synchronized
        self.rules[rule.rule_id] = rule

        if rule.status == RuntimeRuleStatus.ACTIVE:
            self.active_rules[rule.rule_id] = rule
        else:
            self.active_rules.pop(rule.rule_id, None)

    # ============================================================
    # Load Rules From Database
    # ============================================================

    def _load_rules(self):
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                rule_id,
                rule_type,
                target_ip,
                protocol,
                direction,
                parameters,
                rule_description,
                requires_approval,
                status,
                created_at,
                applied_at,
                rolled_back_at,
                rejection_reason
            FROM runtime_rules
            """
        )

        rows = cursor.fetchall()
        conn.close()

        for row in rows:
            rule = RuntimeRule(
                rule_id=row[0],
                rule_type=row[1],
                target_ip=row[2],
                protocol=row[3],
                direction=row[4],
                parameters=json.loads(row[5]) if row[5] else {},
                rule_description=row[6],
                requires_approval=bool(row[7]),
                status=RuntimeRuleStatus(row[8]),
                created_at=row[9],
                applied_at=row[10],
                rolled_back_at=row[11],
                rejection_reason=row[12],
            )

            self.rules[rule.rule_id] = rule

            if rule.status == RuntimeRuleStatus.ACTIVE:
                self.active_rules[rule.rule_id] = rule

    # ============================================================
    # Timestamp
    # ============================================================

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).isoformat()