from agents.attack_analyzer import attack_analyzer_agent
from agents.threat_correlator import threat_correlator_agent
from agents.risk_assessment import risk_assessment_agent
from agents.decision_agent import decision_agent
from agents.rule_generator import rule_generator_agent
from agents.explanation_agent import explanation_agent
from agents.knowledge_agent import knowledge_agent

from guardrails import validate_action
from memory.memory import get_events_by_source_ip, save_event


def run_soc_pipeline(raw_log: str):
    print("=" * 70)
    print("[PASR] Autonomous SOC Pipeline Started")
    print("=" * 70)

    # ============================================================
    # Agent 1 - Attack Analyzer
    # ============================================================
    attack_result = attack_analyzer_agent(raw_log)

    print("\n[Pipeline] Agent 1 - Attack Analyzer completed.")
    print(f"    Attack Type : {attack_result.attack_type}")
    print(f"    Source IP   : {attack_result.source_ip}")
    print(f"    Technique   : {attack_result.technique_id}")
    print(f"    Confidence  : {attack_result.confidence}")

    source_ip = attack_result.source_ip

    # ============================================================
    # Memory - Retrieve historical events
    # ============================================================
    try:
        history = get_events_by_source_ip(source_ip)
    except Exception:
        history = []

    print("\n[Memory] Historical events retrieved.")
    print(f"    Source IP   : {source_ip}")
    print(f"    Events      : {len(history)}")

    # ============================================================
    # Agent 2 - Threat Correlator
    # ============================================================
    correlation_result = threat_correlator_agent(
        attack_result,
        history
    )

    print("\n[Pipeline] Agent 2 - Threat Correlator completed.")
    print(f"    Status      : {correlation_result.correlation_status}")
    print(f"    Related     : {correlation_result.related_event_count}")
    print(f"    Confidence  : {correlation_result.confidence}")

    # ============================================================
    # Agent 3 - Risk Assessment
    # ============================================================
    risk_result = risk_assessment_agent(
        attack_result,
        correlation_result
    )

    print("\n[Pipeline] Agent 3 - Risk Assessment completed.")
    print(f"    Severity    : {risk_result.severity}")
    print(f"    Impact      : {risk_result.impact}")
    print(f"    Risk Score  : {risk_result.risk_score}")
    print(f"    Confidence  : {risk_result.confidence}")

    # ============================================================
    # Agent 4 - Decision Agent
    # ============================================================
    decision_result = decision_agent(
        attack_result,
        correlation_result,
        risk_result
    )

    print("\n[Pipeline] Agent 4 - Decision Agent completed.")
    print(f"    Action      : {decision_result.recommended_action}")
    print(f"    Priority    : {decision_result.priority}")
    print(f"    Target      : {decision_result.target}")
    print(f"    Confidence  : {decision_result.decision_confidence}")

    # ============================================================
    # Agent 5 - Rule Generator
    # ============================================================
    rule_result = rule_generator_agent(
        attack_result,
        risk_result,
        decision_result
    )

    print("\n[Pipeline] Agent 5 - Rule Generator completed.")
    print(f"    Rule Type   : {rule_result.rule_type}")
    print(f"    Target IP   : {rule_result.target_ip}")
    print(f"    Protocol    : {rule_result.protocol}")
    print(f"    Direction   : {rule_result.direction}")
    print(f"    Approval    : {rule_result.requires_approval}")

    # ============================================================
    # Agent 6 - Explanation Agent
    # ============================================================
    explanation_result = explanation_agent(
        attack_result,
        correlation_result,
        risk_result,
        decision_result,
        rule_result
    )

    print("\n[Pipeline] Agent 6 - Explanation Agent completed.")
    print(f"    Evidence    : {len(explanation_result.key_evidence)}")
    print(f"    Decision    : {explanation_result.decision_summary}")

    # ============================================================
    # Agent 7 - Knowledge Agent
    # ============================================================
    knowledge_result = knowledge_agent(
        attack_result,
        correlation_result,
        risk_result,
        decision_result,
        rule_result,
        explanation_result
    )

    print("\n[Pipeline] Agent 7 - Knowledge Agent completed.")
    print(f"    Knowledge ID: {knowledge_result.knowledge_id}")
    print(f"    Event Type  : {knowledge_result.event_type}")
    print(f"    Action      : {knowledge_result.validated_action}")
    print(f"    Status      : {knowledge_result.validation_status}")
    print(f"    Confidence  : {knowledge_result.confidence}")

    # ============================================================
    # Guardrails - Validate final AI decision
    # ============================================================
    print("\n[Guardrails] Validating AI decision...")

    proposed_action = decision_result.recommended_action

    guardrail_result = validate_action(
        proposed_action,
        source_ip
    )

    print(f"    Proposed Action : {proposed_action}")
    print(f"    Target          : {source_ip}")
    print(f"    Approved        : {guardrail_result['approved']}")
    print(f"    Final Action    : {guardrail_result['override_action']}")
    print(f"    Reason          : {guardrail_result['reason']}")

    # ============================================================
    # Save event to Memory
    # ============================================================
    try:
        save_event(
            source_ip=source_ip,
            attack_type=attack_result.attack_type,
            severity=risk_result.severity,
            action_taken=guardrail_result["override_action"],
            guardrail_approved=guardrail_result["approved"],
            reason=guardrail_result["reason"]
        )

        print("\n[Memory] Event saved successfully.")

    except Exception as e:
        print(f"\n[Memory] Warning: Could not save event: {e}")

    # ============================================================
    # Final Result
    # ============================================================
    final_action = guardrail_result["override_action"]

    print("\n" + "=" * 70)
    print("[PASR] Autonomous SOC Pipeline Completed")
    print("=" * 70)

    return {
        # Agent 1
        "attack": attack_result,

        # Agent 2
        "correlation": correlation_result,

        # Agent 3
        "risk": risk_result,

        # Agent 4
        "decision": decision_result,

        # Agent 5
        "rule": rule_result,

        # Agent 6
        "explanation": explanation_result,

        # Agent 7
        "knowledge": knowledge_result,

        # Guardrails
        "guardrail": guardrail_result,

        # Final action
        "final_action": final_action
    }