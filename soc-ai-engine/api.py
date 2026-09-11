from fastapi import APIRouter, FastAPI, HTTPException
from pydantic import BaseModel
import asyncio
from runtime.deployment import deployment_service
from schemas.agent_outputs import RuleGeneratorOutput
from runtime.manager import runtime_manager
from runtime.models import RuntimeRuleStatus
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

# ============================================================
# Runtime Manager API
# ============================================================
@api_router.post("/runtime/rules")
async def api_runtime_create_rule(payload: RuleGeneratorOutput):
    try:
        rule = runtime_manager.create_rule(payload)

        return {
            "status": "success",
            "action": "created",
            "rule": rule.model_dump(),
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not create runtime rule: {str(e)}"
        )
@api_router.get("/runtime/rules")
async def api_runtime_rules():
    try:
        rules = runtime_manager.get_all_rules()

        return {
            "status": "success",
            "count": len(rules),
            "rules": [rule.model_dump() for rule in rules],
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve runtime rules: {str(e)}"
        )


@api_router.get("/runtime/rules/active")
async def api_runtime_active_rules():
    try:
        rules = runtime_manager.get_active_rules()

        return {
            "status": "success",
            "count": len(rules),
            "rules": [rule.model_dump() for rule in rules],
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve active runtime rules: {str(e)}"
        )


@api_router.get("/runtime/rules/pending")
async def api_runtime_pending_rules():
    try:
        rules = runtime_manager.get_rules_by_status(
            RuntimeRuleStatus.PENDING_APPROVAL
        )

        return {
            "status": "success",
            "count": len(rules),
            "rules": [rule.model_dump() for rule in rules],
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve pending runtime rules: {str(e)}"
        )

@api_router.post("/runtime/rules/{rule_id}/validate")
async def api_runtime_validate_rule(rule_id: str):
    try:
        rule = runtime_manager.validate_rule(rule_id)

        return {
            "status": "success",
            "action": "validated",
            "rule": rule.model_dump(),
        }

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e)
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not validate runtime rule: {str(e)}"
        )
@api_router.get("/runtime/rules/{rule_id}")
async def api_runtime_rule(rule_id: str):
    try:
        rule = runtime_manager.get_rule(rule_id)

        return {
            "status": "success",
            "rule": rule.model_dump(),
        }

    except ValueError as e:
        raise HTTPException(
            status_code=404,
            detail=str(e)
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not retrieve runtime rule: {str(e)}"
        )


@api_router.post("/runtime/rules/{rule_id}/approve")
async def api_runtime_approve_rule(rule_id: str):
    try:
        rule = runtime_manager.approve_rule(rule_id)

        return {
            "status": "success",
            "action": "approved",
            "rule": rule.model_dump(),
        }

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e)
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not approve runtime rule: {str(e)}"
        )



@api_router.post("/runtime/rules/{rule_id}/apply")
async def api_runtime_apply_rule(rule_id: str):
    try:
        rule = runtime_manager.apply_rule(rule_id)

        return {
            "status": "success",
            "action": "applied",
            "rule": rule.model_dump(),
        }

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e)
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not apply runtime rule: {str(e)}"
        )

@api_router.post("/runtime/rules/{rule_id}/deploy")
async def api_runtime_deploy_rule(rule_id: str):
    try:
        rule = runtime_manager.get_rule(rule_id)

        if rule.status != RuntimeRuleStatus.ACTIVE:
            raise ValueError(
                f"Rule must be ACTIVE before deployment. Current status: {rule.status}"
            )

        result = deployment_service.deploy(rule)

        return {
            "status": "success",
            "action": "deployed",
            "deployment": result,
        }

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e)
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not deploy runtime rule: {str(e)}"
        )

@api_router.post("/runtime/rules/{rule_id}/rollback")
async def api_runtime_rollback_rule(rule_id: str):
    try:
        rule = runtime_manager.rollback_rule(rule_id)

        return {
            "status": "success",
            "action": "rolled_back",
            "rule": rule.model_dump(),
        }

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e)
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not rollback runtime rule: {str(e)}"
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
