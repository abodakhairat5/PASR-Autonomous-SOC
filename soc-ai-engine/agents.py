import ollama
import json

MODEL_NAME = "qwen2.5:7b"

def triage_agent(raw_log: str) -> dict:
    print("\n[1. Triage Agent]: Processing Raw Log...")
    prompt = f"""
    You are the Triage Agent in a SOC. Analyze this raw log:
    "{raw_log}"
    
    Extract details and assess severity (LOW, MEDIUM, HIGH, CRITICAL).
    Return ONLY valid JSON with no extra text:
    {{
        "source_ip": "extracted IP or Unknown",
        "attack_type": "SYN_FLOOD / PORT_SCAN / BRUTE_FORCE / NORMAL / OTHER",
        "severity": "LOW/MEDIUM/HIGH/CRITICAL",
        "is_false_positive": false,
        "summary": "Short context"
    }}
    """
    res = ollama.chat(model=MODEL_NAME, messages=[{'role': 'user', 'content': prompt}], format="json")
    return json.loads(res['message']['content'])

def threat_analysis_agent(triage_data: dict) -> dict:
    print("[2. Threat Analysis Agent]: Determining Mitigation Strategy...")
    prompt = f"""
    You are the Threat Analysis Agent. Based on triage data: {json.dumps(triage_data)}
    Recommend a specific action from: [BLOCK_IP, IGNORE, SHUTDOWN_INTERFACE, INVESTIGATE].
    
    Return ONLY valid JSON with no extra text:
    {{
        "recommended_action": "ACTION_NAME",
        "confidence_score": 0.95,
        "mitigation_reasoning": "Why this action is needed"
    }}
    """
    res = ollama.chat(model=MODEL_NAME, messages=[{'role': 'user', 'content': prompt}], format="json")
    return json.loads(res['message']['content'])