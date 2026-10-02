from typing import List, Optional

from pydantic import BaseModel, Field


# ============================================================
# Agent 1 - Attack Analyzer
# ============================================================

class AttackAnalyzerOutput(BaseModel):
    """
    Output contract for Agent #1: Attack Analyzer.

    Supports:
    - Network security events
    - Pentest security findings
    """

    event_type: str = Field(
        default="NETWORK",
        description="NETWORK or PENTEST"
    )

    source_ip: Optional[str] = Field(
        default=None,
        description="Actual source IP when available"
    )

    finding_id: Optional[str] = Field(
        default=None,
        description="Pentest finding ID when applicable"
    )

    target_url: Optional[str] = Field(
        default=None,
        description="Target URL for a pentest finding"
    )

    attack_type: str = Field(
        description=(
            "Detected attack or vulnerability type, e.g. "
            "SYN_FLOOD, PORT_SCAN, BRUTE_FORCE, "
            "SQL_INJECTION, IDOR, XSS, SSRF, RCE, "
            "BROKEN_ACCESS_CONTROL, AUTHENTICATION_BYPASS, "
            "PATH_TRAVERSAL, NORMAL, OTHER"
        )
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
        description="Concrete evidence extracted from the event"
    )

    summary: str = Field(
        description=(
            "Short explanation of the detected attack "
            "or vulnerability"
        )
    )


# ============================================================
# Agent 2 - Threat Correlator
# ============================================================

class ThreatCorrelatorOutput(BaseModel):
    """
    Output contract for Agent #2: Threat Correlator.

    Supports both:
    - Network event correlation
    - Pentest finding correlation
    """

    related_event_count: int = Field(
        ge=0,
        description="Number of related historical/current events"
    )

    correlation_status: str = Field(
        description=(
            "RELATED / NO_MATCH / SUSPICIOUS_PATTERN"
        )
    )

    related_ips: List[str] = Field(
        default_factory=list,
        description=(
            "IPs associated with correlated events"
        )
    )

    related_attack_types: List[str] = Field(
        default_factory=list,
        description=(
            "Attack or vulnerability types seen "
            "in correlated events"
        )
    )

    pattern: str = Field(
        description=(
            "Short description of the correlated pattern"
        )
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in the correlation"
    )


# ============================================================
# Agent 3 - Risk Assessment
# ============================================================

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
        description=(
            "Factors that influenced the risk assessment"
        )
    )

    summary: str = Field(
        description="Short explanation of the assessed risk"
    )


# ============================================================
# Agent 4 - Decision Agent
# ============================================================

class DecisionAgentOutput(BaseModel):
    """
    Output contract for Agent #4: Decision Agent.
    """

    recommended_action: str = Field(
        description=(
            "ALERT / BLOCK / THROTTLE / ISOLATE"
        )
    )

    decision_confidence: float = Field(
        ge=0.0,
        le=1.0,
        description=(
            "Confidence in the recommended action"
        )
    )

    priority: str = Field(
        description="LOW / MEDIUM / HIGH / CRITICAL"
    )

    target: Optional[str] = Field(
        default=None,
        description=(
            "Target IP, URL, or security asset"
        )
    )

    reasoning: str = Field(
        description=(
            "Why this action was selected"
        )
    )


# ============================================================
# Agent 5 - Rule Generator
# ============================================================

class RuleGeneratorOutput(BaseModel):
    """
    Output contract for Agent #5: Rule Generator.
    """

    rule_type: str = Field(
        description=(
            "BLOCK / THROTTLE / ISOLATE / ALERT / NONE"
        )
    )

    target_ip: Optional[str] = Field(
        default=None,
        description=(
            "Target source IP for network rules"
        )
    )

    protocol: Optional[str] = Field(
        default=None,
        description=(
            "Network protocol such as TCP, UDP, ICMP, ANY"
        )
    )

    direction: str = Field(
        description=(
            "INBOUND / OUTBOUND / BOTH / ANY"
        )
    )

    parameters: dict = Field(
        default_factory=dict,
        description=(
            "Rule-specific parameters, including pentest "
            "finding metadata when applicable"
        )
    )

    rule_description: str = Field(
        description=(
            "Human-readable description of the runtime rule"
        )
    )

    requires_approval: bool = Field(
        description=(
            "Whether human approval is required before execution"
        )
    )


# ============================================================
# Agent 6 - Explanation Agent
# ============================================================

class ExplanationAgentOutput(BaseModel):
    """
    Output contract for Agent #6: Explanation Agent.
    """

    explanation: str = Field(
        description=(
            "Clear explanation of why the security "
            "decision was made"
        )
    )

    key_evidence: List[str] = Field(
        default_factory=list,
        description=(
            "Important evidence supporting the decision"
        )
    )

    risk_factors: List[str] = Field(
        default_factory=list,
        description=(
            "Main factors contributing to the assessed risk"
        )
    )

    decision_summary: str = Field(
        description=(
            "Short summary of the final decision"
        )
    )

    analyst_recommendation: str = Field(
        description=(
            "What the SOC analyst should know or verify"
        )
    )


# ============================================================
# Agent 7 - Knowledge Agent
# ============================================================

class KnowledgeAgentOutput(BaseModel):
    """
    Output contract for Agent #7: Knowledge Agent.
    """

    knowledge_id: str = Field(
        description=(
            "Unique identifier for the stored knowledge"
        )
    )

    event_type: str = Field(
        description="NETWORK or PENTEST"
    )

    source_ip: Optional[str] = Field(
        default=None,
        description=(
            "Source IP associated with the event"
        )
    )

    validated_action: str = Field(
        description=(
            "Final validated security action"
        )
    )

    validation_status: str = Field(
        description=(
            "APPROVED / OVERRIDDEN / REJECTED / PENDING"
        )
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description=(
            "Confidence in the stored knowledge"
        )
    )

    lesson: str = Field(
        description=(
            "Knowledge or lesson learned from the event"
        )
    )

    reusable_pattern: str = Field(
        description=(
            "Pattern that can be useful for future incidents"
        )
    )