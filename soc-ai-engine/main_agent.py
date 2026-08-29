from agents import triage_agent, threat_analysis_agent
from guardrails import validate_action

def run_soc_pipeline(raw_log: str):
    print("=" * 50)
    print(f"[+] New Incoming Log: {raw_log}")
    
    # 1. Triage Phase
    triage_result = triage_agent(raw_log)
    print(f"    ├─ IP: {triage_result.get('source_ip')} | Severity: {triage_result.get('severity')}")
    
    if triage_result.get("is_false_positive"):
        print("[!] Dropped: False Positive Detected.")
        return

    # 2. Threat Analysis Phase
    analysis_result = threat_analysis_agent(triage_result)
    proposed_action = analysis_result.get("recommended_action")
    source_ip = triage_result.get("source_ip")
    
    print(f"    ├─ AI Recommendation: {proposed_action}")
    
    # 3. Guardrail & Decision Verification
    guardrail_result = validate_action(proposed_action, source_ip)
    
    print(f"[3. Guardrail Engine Result]: Approved={guardrail_result['approved']}")
    print(f"    └─ Final Executable Action: {guardrail_result['override_action']}")
    print(f"    └─ Reason: {guardrail_result['reason']}")
    print("=" * 50)

if __name__ == "__main__":
    run_soc_pipeline("Warning: High rate of TCP SYN packets received from 192.168.1.105 (10,000 pps)")