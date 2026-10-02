from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from agents import triage_agent, threat_analysis_agent
from guardrails import validate_action
from database import init_db, log_incident

# إنشاء/تهيئة قاعدة البيانات عند بدء التشغيل
init_db()

app = FastAPI(title="Autonomous SOC AI Engine API")

class LogPayload(BaseModel):
    raw_log: str

@app.post("/analyze-log")
async def analyze_log(payload: LogPayload):
    try:
        # 1. Triage Phase
        triage_result = triage_agent(payload.raw_log)
        
        if triage_result.get("is_false_positive"):
            return {
                "status": "dropped",
                "reason": "False Positive",
                "triage": triage_result
            }

        # 2. Threat Analysis Phase
        analysis_result = threat_analysis_agent(triage_result)
        proposed_action = analysis_result.get("recommended_action")
        source_ip = triage_result.get("source_ip")

        # 3. Guardrails Engine
        guardrail_result = validate_action(proposed_action, source_ip)

        # 4. Save to Database
        log_incident(
            source_ip=source_ip,
            attack_type=triage_result.get("attack_type", "UNKNOWN"),
            severity=triage_result.get("severity", "UNKNOWN"),
            action_taken=guardrail_result.get("override_action"),
            guardrail_approved=guardrail_result.get("approved"),
            reason=guardrail_result.get("reason")
        )

        return {
            "status": "processed",
            "triage": triage_result,
            "threat_analysis": analysis_result,
            "guardrail_decision": guardrail_result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))