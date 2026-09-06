from fastapi import APIRouter, FastAPI, HTTPException
from pydantic import BaseModel
import asyncio

from orchestrator.pipeline import run_soc_pipeline
from memory.memory import (
    get_connection,
    get_dashboard_data,
    get_all_events,
    get_event_by_id,
    get_event_stats,
    get_events_by_source_ip,
    get_recent_events,
    get_response_actions,
    get_agents,
    get_infrastructure,
    get_pipeline_health,
    get_simulated_actions,
    record_simulated_action,
)


app = FastAPI(
    title="PASR Autonomous SOC API",
    description="AI-powered Autonomous Security Operations Center",
    version="1.0.0"
)


class LogPayload(BaseModel):
    raw_log: str


def _agents_data(backend_online: bool) -> dict:
    agents = get_agents(backend_online=backend_online)
    health = get_pipeline_health(backend_online=backend_online)
    return {
        "count": len(agents),
        "pipeline_status": health["status"],
        "agents": agents,
    }


class SimulateActionPayload(BaseModel):
    action: str | None = None


def _run_analysis(raw_log: str) -> dict:
    """
    Execute the PASR pipeline and return a safe, serializable result.
    Shared by both the legacy and /api endpoints.
    """
    result = run_soc_pipeline(raw_log)

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


@app.get("/")
async def root():
    return {
        "service": "PASR Autonomous SOC",
        "status": "online",
        "version": "1.0.0"
    }


def _health_summary() -> dict:
    """
    Build a real infrastructure health summary from live system checks.
    """
    infra = get_infrastructure(backend_online=True)

    return {
        "status": "healthy",
        "api": infra["api"]["status"],
        "database": infra["database"]["status"],
        "ai_pipeline": infra["pipeline"]["status"],
        "ai_model": infra["ollama"]["status"],
        "guardrails": infra["guardrails"]["status"],
        "checked_at": infra["checked_at"],
    }

@app.get("/health")
async def health():
    try:
        # Run the (potentially slow) infrastructure checks in a worker
        # thread so the event loop stays responsive to concurrent requests.
        return await asyncio.to_thread(_health_summary)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Health check failed: {str(e)}"
        )


@app.post("/analyze-log")
async def analyze_log(payload: LogPayload):
    try:
        # Run the (CPU/IO heavy, several-minute) pipeline in a worker thread
        # so the event loop keeps serving live health/dashboard/incidents
        # requests while an analysis is in flight.
        return await asyncio.to_thread(_run_analysis, payload.raw_log)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"SOC pipeline error: {str(e)}"
        )


# ============================================================
# API Router mounted under /api
# ============================================================

api_router = APIRouter(prefix="/api")


@api_router.get("/health")
async def api_health():
    """
    Health check exposed under the /api mount so the frontend
    (which routes all /api/* requests through the Vite proxy)
    can verify backend connectivity at /api/health.
    """
    try:
        return await asyncio.to_thread(_health_summary)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Health check failed: {str(e)}"
        )


@api_router.post("/analyze-log")
async def api_analyze_log(payload: LogPayload):
    try:
        # Offload the long-running pipeline to a worker thread so the event
        # loop remains responsive to live polling during analysis.
        return await asyncio.to_thread(_run_analysis, payload.raw_log)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"SOC pipeline error: {str(e)}"
        )


@api_router.get("/incidents/recent")
async def api_incidents_recent(limit: int = 20):
    try:
        events = get_recent_events(limit=limit)

        return {
            "status": "success",
            "count": len(events),
            "incidents": events,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve incidents: {str(e)}"
        )


@api_router.get("/incidents/{source_ip}")
async def api_incidents_by_source(source_ip: str, limit: int = 50):
    try:
        events = get_events_by_source_ip(source_ip, limit=limit)

        return {
            "status": "success",
            "count": len(events),
            "source_ip": source_ip,
            "incidents": events,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve incidents: {str(e)}"
        )


@api_router.get("/incidents")
async def api_incidents(limit: int = 500):
    try:
        events = get_all_events(limit=limit)

        return {
            "status": "success",
            "count": len(events),
            "incidents": events,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve incidents: {str(e)}"
        )


@api_router.get("/stats")
async def api_stats():
    try:
        stats = get_event_stats()

        return {
            "status": "success",
            **stats,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not compute stats: {str(e)}"
        )


@api_router.get("/dashboard")
async def api_dashboard():
    try:
        data = get_dashboard_data()

        return {
            "status": "success",
            **data,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not build dashboard: {str(e)}"
        )


@api_router.get("/response-actions")
async def api_response_actions(limit: int = 200):
    try:
        actions = get_response_actions(limit=limit)

        return {
            "status": "success",
            "count": len(actions),
            "actions": actions,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve response actions: {str(e)}"
        )


@api_router.get("/agents")
async def api_agents():
    try:
        # The route executing means the backend is reachable/online.
        data = await asyncio.to_thread(_agents_data, True)

        return {
            "status": "success",
            **data,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve agents: {str(e)}"
        )


@api_router.get("/infrastructure")
async def api_infrastructure():
    try:
        infra = await asyncio.to_thread(get_infrastructure, True)

        return {
            "status": "success",
            **infra,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve infrastructure status: {str(e)}"
        )


@api_router.get("/actions/simulated")
async def api_simulated_actions(limit: int = 50):
    """
    Return the recorded safe/simulated response-action executions.
    """
    try:
        actions = get_simulated_actions(limit=limit)

        return {
            "status": "success",
            "count": len(actions),
            "actions": actions,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve simulated actions: {str(e)}"
        )


@api_router.post("/actions/{incident_id}/simulate")
async def api_simulate_action(incident_id: int, payload: SimulateActionPayload | None = None):
    """
    Safely "execute" a response action in the simulation.

    This endpoint ONLY logs the simulated execution — it does not touch any
    real firewall, network, or infrastructure state. The originating
    incident is read from the database; the recorded action (from the
    incident unless overridden by the optional payload) is stored.
    """
    try:
        incident = get_event_by_id(incident_id)
        if not incident:
            raise HTTPException(
                status_code=404,
                detail=f"No incident found with id {incident_id}"
            )

        action = payload.action.strip() if payload and payload.action else incident.get("action_taken")

        saved = record_simulated_action(incident_id, action)

        return {
            "status": "success",
            "simulated": True,
            "recorded": saved,
            "note": "Simulated execution recorded — no real-world network change was made.",
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not record simulated action: {str(e)}"
        )


@api_router.get("")
async def api_root():
    try:
        conn = get_connection()
        conn.execute("SELECT 1 FROM threat_logs LIMIT 1")
        conn.close()

        return {
            "service": "PASR Autonomous SOC API",
            "status": "success",
            "database": "available",
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"API service error: {str(e)}"
        )


app.include_router(api_router)


# ============================================================
# Legacy root-level endpoint (kept for backwards compatibility)
# ============================================================

@app.get("/incidents")
async def get_incidents():
    try:
        events = get_recent_events(limit=50)

        return {
            "status": "success",
            "count": len(events),
            "incidents": events
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve incidents: {str(e)}"
        )
