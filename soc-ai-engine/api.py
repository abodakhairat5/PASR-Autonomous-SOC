from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from orchestrator.pipeline import run_soc_pipeline
from memory.memory import get_events_by_source_ip


app = FastAPI(
    title="PASR Autonomous SOC API",
    description="AI-powered Autonomous Security Operations Center",
    version="1.0.0",
)


class LogPayload(BaseModel):
    raw_log: str


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "PASR Autonomous SOC",
    }


@app.post("/analyze-log")
async def analyze_log(payload: LogPayload):
    try:
        result = run_soc_pipeline(payload.raw_log)

        return {
            "status": "processed",

            "final_action": result["final_action"],

            "attack": result["attack"].model_dump(),
            "correlation": result["correlation"].model_dump(),
            "risk": result["risk"].model_dump(),
            "decision": result["decision"].model_dump(),
            "rule": result["rule"].model_dump(),
            "explanation": result["explanation"].model_dump(),
            "knowledge": result["knowledge"].model_dump(),

            "guardrail": result["guardrail"],
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )


@app.get("/incidents/{source_ip}")
async def get_incidents(source_ip: str):
    try:
        events = get_events_by_source_ip(source_ip)

        return {
            "source_ip": source_ip,
            "count": len(events),
            "events": events,
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )