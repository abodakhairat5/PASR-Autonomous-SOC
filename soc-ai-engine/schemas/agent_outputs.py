from typing import List, Optional
from pydantic import BaseModel, Field
from pydantic import BaseModel, Field
from typing import List, Optional


class AttackAnalyzerOutput(BaseModel):
    """
    Output contract for Agent #1: Attack Analyzer.
    """

    source_ip: Optional[str] = None

    attack_type: str = Field(
        description="Detected attack type, e.g. SYN_FLOOD, PORT_SCAN, BRUTE_FORCE, NORMAL, OTHER"
    )

    technique_id: Optional[str] = Field(
        default=None,
        description="MITRE ATT&CK technique ID when applicable"
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence score between 0 and 1"
    )

    indicators: List[str] = Field(
        default_factory=list,
        description="Evidence extracted from the security event"
    )

    summary: str = Field(
        description="Short explanation of the detected attack"
    )

class ThreatCorrelatorOutput(BaseModel):
    """
    Output contract for Agent #2: Threat Correlator.
    """

    related_event_count: int = Field(
        ge=0,
        description="Number of related historical/current events found"
    )

    correlation_status: str = Field(
        description="RELATED / NO_MATCH / SUSPICIOUS_PATTERN"
    )

    related_ips: List[str] = Field(
        default_factory=list,
        description="IPs associated with correlated events"
    )

    related_attack_types: List[str] = Field(
        default_factory=list,
        description="Attack types seen in correlated events"
    )

    pattern: str = Field(
        description="Short description of the correlated pattern"
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in the correlation"
    )

class RiskAssessmentOutput(BaseModel):
    """
    Output contract for Agent #3: Risk Assessment.
    """

    severity: str = Field(
        description="LOW / MEDIUM / HIGH / CRITICAL"
    )

    impact: str = Field(
        description="LOW / MEDIUM / HIGH / CRITICAL"
    )

    risk_score: float = Field(
        ge=0.0,
        le=100.0,
        description="Overall risk score from 0 to 100"
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in the risk assessment"
    )

    factors: List[str] = Field(
        default_factory=list,
        description="Factors that influenced the risk assessment"
    )

    summary: str = Field(
        description="Short explanation of the assessed risk"
    )

class DecisionAgentOutput(BaseModel):
    """
    Output contract for Agent #4: Decision Agent.
    """

    recommended_action: str = Field(
        description="ALERT / BLOCK / THROTTLE / ISOLATE"
    )

    decision_confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in the recommended action"
    )

    priority: str = Field(
        description="LOW / MEDIUM / HIGH / CRITICAL"
    )

    target: Optional[str] = Field(
        default=None,
        description="Target IP or asset for the action"
    )

    reasoning: str = Field(
        description="Why this action was selected"
    )

class RuleGeneratorOutput(BaseModel):
    """
    Output contract for Agent #5: Rule Generator.
    """

    rule_type: str = Field(
        description="BLOCK / THROTTLE / ISOLATE / ALERT"
    )

    target_ip: Optional[str] = Field(
        default=None,
        description="Target source IP"
    )

    protocol: Optional[str] = Field(
        default=None,
        description="Network protocol such as TCP or UDP"
    )

    direction: str = Field(
        description="INBOUND / OUTBOUND / BOTH"
    )

    parameters: dict = Field(
        default_factory=dict,
        description="Rule-specific parameters"
    )

    rule_description: str = Field(
        description="Human-readable description of the runtime rule"
    )

    requires_approval: bool = Field(
        description="Whether human approval is required before execution"
    )

class ExplanationAgentOutput(BaseModel):
    """
    Output contract for Agent #6: Explanation Agent.
    """

    explanation: str = Field(
        description="Clear explanation of why the security decision was made"
    )

    key_evidence: List[str] = Field(
        default_factory=list,
        description="Important evidence supporting the decision"
    )

    risk_factors: List[str] = Field(
        default_factory=list,
        description="Main factors contributing to the assessed risk"
    )

    decision_summary: str = Field(
        description="Short summary of the final decision"
    )

    analyst_recommendation: str = Field(
        description="What the SOC analyst should know or verify"
    )

class KnowledgeAgentOutput(BaseModel):
    """
    Output contract for Agent #7: Knowledge Agent.
    """

    knowledge_id: str = Field(
        description="Unique identifier for the stored knowledge"
    )

    event_type: str = Field(
        description="Type of security event"
    )

    source_ip: Optional[str] = Field(
        default=None,
        description="Source IP associated with the event"
    )

    validated_action: str = Field(
        description="Final validated security action"
    )

    validation_status: str = Field(
        description="APPROVED / OVERRIDDEN / REJECTED / PENDING"
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in the stored knowledge"
    )

    lesson: str = Field(
        description="Knowledge or lesson learned from the event"
    )

    reusable_pattern: str = Field(
        description="Pattern that can be useful for future incidents"
    )