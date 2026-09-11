from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class RuntimeRuleStatus(str, Enum):
    """
    Lifecycle state of a runtime security rule.
    """

    PROPOSED = "PROPOSED"
    VALIDATED = "VALIDATED"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    ACTIVE = "ACTIVE"
    ROLLED_BACK = "ROLLED_BACK"
    REJECTED = "REJECTED"


class RuntimeRule(BaseModel):
    """
    Internal runtime representation of a security rule.

    This model represents a rule after it enters the Runtime Engine.
    """

    rule_id: str = Field(
        description="Unique identifier for the runtime rule"
    )

    rule_type: str = Field(
        description="BLOCK / THROTTLE / ISOLATE / ALERT"
    )

    target_ip: Optional[str] = Field(
        default=None,
        description="Target IP address"
    )

    protocol: Optional[str] = Field(
        default=None,
        description="Network protocol such as TCP or UDP"
    )

    direction: str = Field(
        description="INBOUND / OUTBOUND / BOTH"
    )

    parameters: Dict[str, Any] = Field(
        default_factory=dict,
        description="Rule-specific runtime parameters"
    )

    rule_description: str = Field(
        description="Human-readable rule description"
    )

    requires_approval: bool = Field(
        description="Whether human approval is required"
    )

    status: RuntimeRuleStatus = Field(
        default=RuntimeRuleStatus.PROPOSED,
        description="Current runtime lifecycle status"
    )

    created_at: Optional[str] = Field(
        default=None,
        description="Rule creation timestamp"
    )

    applied_at: Optional[str] = Field(
        default=None,
        description="Rule activation timestamp"
    )

    rolled_back_at: Optional[str] = Field(
        default=None,
        description="Rule rollback timestamp"
    )

    rejection_reason: Optional[str] = Field(
        default=None,
        description="Reason the rule was rejected"
    )