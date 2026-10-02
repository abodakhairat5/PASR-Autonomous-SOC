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


# ============================================================
# FastAPI Application
# ============================================================

app = FastAPI(
    title="PASR Autonomous SOC API",
    description="AI-powered Autonomous Security Operations Center",
    version="1.0.0",
)


# ============================================================
# Request Models
# ============================================================

class LogPayload(BaseModel):
    raw_log: str


class SimulateActionPayload(BaseModel):
    action: str | None = None


# ============================================================
# Helpers
# ============================================================

def _agents_data(backend_online: bool) -> dict:
    agents = get_agents(backend_online=backend_online)
    health = get_pipeline_health(backend_online=backend_online)

    return {
        "count": len(agents),
        "pipeline_status": health["status"],
        "agents": agents,
    }


def _run_analysis(raw_log: str) -> dict:
    """
    Execute the PASR pipeline and return a safe,
    JSON-serializable result.
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

        "runtime": result["runtime"].model_dump(),

        "runtime_status": result["runtime_status"],

        "runtime_rule_id": result["runtime_rule_id"],
    }


def _health_summary() -> dict:
    """
    Build a real infrastructure health summary
    from live system checks.
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


# ============================================================
# Root
# ============================================================

@app.get("/")
async def root():
    return {
        "service": "PASR Autonomous SOC",
        "status": "online",
        "version": "1.0.0",
    }


# ============================================================
# Health
# ============================================================

@app.get("/health")
async def health():

    try:
        return await asyncio.to_thread(_health_summary)

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Health check failed: {str(e)}",
        )


# ============================================================
# Legacy Analyze Endpoint
# ============================================================

@app.post("/analyze-log")
async def analyze_log(payload: LogPayload):

    try:

        return await asyncio.to_thread(
            _run_analysis,
            payload.raw_log,
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"SOC pipeline error: {str(e)}",
        )


# ============================================================
# API Router
# ============================================================

api_router = APIRouter(
    prefix="/api"
)


# ============================================================
# API Health
# ============================================================

@api_router.get("/health")
async def api_health():

    try:

        return await asyncio.to_thread(
            _health_summary
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Health check failed: {str(e)}",
        )


# ============================================================
# API Analyze
# ============================================================

@api_router.post("/analyze-log")
async def api_analyze_log(
    payload: LogPayload
):

    try:

        return await asyncio.to_thread(
            _run_analysis,
            payload.raw_log,
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"SOC pipeline error: {str(e)}",
        )


# ============================================================
# INCIDENTS
# ============================================================

@api_router.get("/incidents/recent")
async def api_incidents_recent(
    limit: int = 20
):

    try:

        limit = max(1, min(limit, 500))

        events = get_recent_events(
            limit=limit
        )

        return {
            "status": "success",
            "count": len(events),
            "incidents": events,
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve recent incidents: "
                f"{str(e)}"
            ),
        )


@api_router.get("/incidents/{source_ip}")
async def api_incidents_by_source(
    source_ip: str,
    limit: int = 50
):

    try:

        limit = max(1, min(limit, 500))

        events = get_events_by_source_ip(
            source_ip,
            limit=limit,
        )

        return {
            "status": "success",
            "count": len(events),
            "source_ip": source_ip,
            "incidents": events,
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve incidents "
                f"for source IP: {str(e)}"
            ),
        )


@api_router.get("/incidents")
async def api_incidents(
    limit: int = 500
):

    """
    Return all recent SOC incidents.

    This endpoint is used by the Dashboard.

    Both NETWORK and PENTEST incidents are returned.
    """

    try:

        # Keep request safe.
        limit = max(1, min(limit, 500))

        events = get_all_events(
            limit=limit
        )

        # --------------------------------------------------------
        # Normalize incidents for the frontend
        # --------------------------------------------------------

        incidents = []

        for event in events:

            if not isinstance(event, dict):
                continue

            incident = dict(event)

            # ----------------------------------------------------
            # Normalize common field names
            # ----------------------------------------------------

            if "id" not in incident:
                if "database_id" in incident:
                    incident["id"] = incident["database_id"]

            if "timestamp" not in incident:
                incident["timestamp"] = (
                    incident.get("created_at")
                    or incident.get("time")
                )

            if "attack_type" not in incident:
                incident["attack_type"] = (
                    incident.get("event_type")
                    or incident.get("type")
                    or "UNKNOWN"
                )

            if "severity" not in incident:
                incident["severity"] = "UNKNOWN"

            if "action_taken" not in incident:
                incident["action_taken"] = (
                    incident.get("action")
                    or incident.get("final_action")
                    or "UNKNOWN"
                )

            if "source_ip" not in incident:
                incident["source_ip"] = None

            # ----------------------------------------------------
            # Detect event type
            # ----------------------------------------------------

            if not incident.get("event_type"):

                details = incident.get("details")

                if isinstance(details, dict):

                    attack_data = details.get(
                        "attack"
                    )

                    if isinstance(
                        attack_data,
                        dict,
                    ):

                        incident["event_type"] = (
                            attack_data.get(
                                "event_type"
                            )
                            or "NETWORK"
                        )

                elif isinstance(details, str):

                    if "PENTEST" in details.upper():

                        incident["event_type"] = "PENTEST"

                    else:

                        incident["event_type"] = "NETWORK"

            if not incident.get("event_type"):
                incident["event_type"] = "NETWORK"

            # ----------------------------------------------------
            # Pentest-specific fields
            # ----------------------------------------------------

            if incident["event_type"] == "PENTEST":

                if "finding_id" not in incident:
                    incident["finding_id"] = None

                if "target_url" not in incident:
                    incident["target_url"] = None

                # Try to extract pentest data from
                # the stored pipeline details.
                details = incident.get("details")

                if isinstance(details, dict):

                    attack_data = details.get(
                        "attack"
                    )

                    if isinstance(
                        attack_data,
                        dict,
                    ):

                        incident["finding_id"] = (
                            attack_data.get(
                                "finding_id"
                            )
                            or incident.get(
                                "finding_id"
                            )
                        )

                        incident["target_url"] = (
                            attack_data.get(
                                "target_url"
                            )
                            or incident.get(
                                "target_url"
                            )
                        )

                        incident["attack_type"] = (
                            attack_data.get(
                                "attack_type"
                            )
                            or incident.get(
                                "attack_type"
                            )
                        )

                # Pentest incidents don't necessarily
                # have a source IP.
                incident["source_ip"] = (
                    incident.get("source_ip")
                )

            # ----------------------------------------------------
            # Add a stable frontend-friendly identifier
            # ----------------------------------------------------

            incident["incident_id"] = incident.get(
                "id"
            )

            incidents.append(
                incident
            )

        return {
            "status": "success",
            "count": len(incidents),
            "incidents": incidents,
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve incidents: "
                f"{str(e)}"
            ),
        )


# ============================================================
# Statistics
# ============================================================

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
            detail=(
                "Could not compute stats: "
                f"{str(e)}"
            ),
        )


# ============================================================
# Dashboard
# ============================================================

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
            detail=(
                "Could not build dashboard: "
                f"{str(e)}"
            ),
        )


# ============================================================
# Response Actions
# ============================================================

@api_router.get("/response-actions")
async def api_response_actions(
    limit: int = 200
):

    try:

        limit = max(1, min(limit, 500))

        actions = get_response_actions(
            limit=limit
        )

        return {
            "status": "success",
            "count": len(actions),
            "actions": actions,
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve response actions: "
                f"{str(e)}"
            ),
        )


# ============================================================
# Agents
# ============================================================

@api_router.get("/agents")
async def api_agents():

    try:

        data = await asyncio.to_thread(
            _agents_data,
            True,
        )

        return {
            "status": "success",
            **data,
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve agents: "
                f"{str(e)}"
            ),
        )


# ============================================================
# Infrastructure
# ============================================================

@api_router.get("/infrastructure")
async def api_infrastructure():

    try:

        infra = await asyncio.to_thread(
            get_infrastructure,
            True,
        )

        return {
            "status": "success",
            **infra,
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve infrastructure "
                f"status: {str(e)}"
            ),
        )


# ============================================================
# Simulated Actions
# ============================================================

@api_router.get("/actions/simulated")
async def api_simulated_actions(
    limit: int = 50
):

    try:

        limit = max(1, min(limit, 500))

        actions = get_simulated_actions(
            limit=limit
        )

        return {
            "status": "success",
            "count": len(actions),
            "actions": actions,
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve simulated actions: "
                f"{str(e)}"
            ),
        )


# ============================================================
# Simulate Response Action
# ============================================================

@api_router.post(
    "/actions/{incident_id}/simulate"
)
async def api_simulate_action(
    incident_id: int,
    payload: SimulateActionPayload | None = None,
):

    """
    Safely simulate a response action.

    This does NOT modify real infrastructure.
    """

    try:

        incident = get_event_by_id(
            incident_id
        )

        if not incident:

            raise HTTPException(
                status_code=404,
                detail=(
                    f"No incident found "
                    f"with id {incident_id}"
                ),
            )

        action = (
            payload.action.strip()
            if payload and payload.action
            else incident.get(
                "action_taken"
            )
        )

        saved = record_simulated_action(
            incident_id,
            action,
        )

        return {
            "status": "success",
            "simulated": True,
            "recorded": saved,
            "note": (
                "Simulated execution recorded — "
                "no real-world network change "
                "was made."
            ),
        }

    except HTTPException:
        raise

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not record simulated action: "
                f"{str(e)}"
            ),
        )


# ============================================================
# API Root
# ============================================================

@api_router.get("")
async def api_root():

    try:

        conn = get_connection()

        conn.execute(
            "SELECT 1 FROM threat_logs LIMIT 1"
        )

        conn.close()

        return {
            "service": "PASR Autonomous SOC API",
            "status": "success",
            "database": "available",
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                f"API service error: {str(e)}"
            ),
        )


# ============================================================
# Runtime Manager
# ============================================================

@api_router.post("/runtime/rules")
async def api_runtime_create_rule(
    payload: RuleGeneratorOutput
):

    try:

        rule = runtime_manager.create_rule(
            payload
        )

        return {
            "status": "success",
            "action": "created",
            "rule": rule.model_dump(),
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not create runtime rule: "
                f"{str(e)}"
            ),
        )


@api_router.get("/runtime/rules")
async def api_runtime_rules():

    try:

        rules = runtime_manager.get_all_rules()

        return {
            "status": "success",
            "count": len(rules),
            "rules": [
                rule.model_dump()
                for rule in rules
            ],
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve runtime rules: "
                f"{str(e)}"
            ),
        )


@api_router.get("/runtime/rules/active")
async def api_runtime_active_rules():

    try:

        rules = runtime_manager.get_active_rules()

        return {
            "status": "success",
            "count": len(rules),
            "rules": [
                rule.model_dump()
                for rule in rules
            ],
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve active runtime "
                f"rules: {str(e)}"
            ),
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
            "rules": [
                rule.model_dump()
                for rule in rules
            ],
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve pending runtime "
                f"rules: {str(e)}"
            ),
        )


@api_router.post(
    "/runtime/rules/{rule_id}/validate"
)
async def api_runtime_validate_rule(
    rule_id: str
):

    try:

        rule = runtime_manager.validate_rule(
            rule_id
        )

        return {
            "status": "success",
            "action": "validated",
            "rule": rule.model_dump(),
        }

    except ValueError as e:

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not validate runtime rule: "
                f"{str(e)}"
            ),
        )


@api_router.get(
    "/runtime/rules/{rule_id}"
)
async def api_runtime_rule(
    rule_id: str
):

    try:

        rule = runtime_manager.get_rule(
            rule_id
        )

        return {
            "status": "success",
            "rule": rule.model_dump(),
        }

    except ValueError as e:

        raise HTTPException(
            status_code=404,
            detail=str(e),
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve runtime rule: "
                f"{str(e)}"
            ),
        )


@api_router.post(
    "/runtime/rules/{rule_id}/approve"
)
async def api_runtime_approve_rule(
    rule_id: str
):

    try:

        rule = runtime_manager.approve_rule(
            rule_id
        )

        return {
            "status": "success",
            "action": "approved",
            "rule": rule.model_dump(),
        }

    except ValueError as e:

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not approve runtime rule: "
                f"{str(e)}"
            ),
        )


@api_router.post(
    "/runtime/rules/{rule_id}/apply"
)
async def api_runtime_apply_rule(
    rule_id: str
):

    try:

        rule = runtime_manager.apply_rule(
            rule_id
        )

        return {
            "status": "success",
            "action": "applied",
            "rule": rule.model_dump(),
        }

    except ValueError as e:

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not apply runtime rule: "
                f"{str(e)}"
            ),
        )


@api_router.post(
    "/runtime/rules/{rule_id}/deploy"
)
async def api_runtime_deploy_rule(
    rule_id: str
):

    try:

        rule = runtime_manager.get_rule(
            rule_id
        )

        if rule.status != RuntimeRuleStatus.ACTIVE:

            raise ValueError(
                "Rule must be ACTIVE before "
                f"deployment. Current status: {rule.status}"
            )

        result = deployment_service.deploy(
            rule
        )

        return {
            "status": "success",
            "action": "deployed",
            "deployment": result,
        }

    except ValueError as e:

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not deploy runtime rule: "
                f"{str(e)}"
            ),
        )


@api_router.post(
    "/runtime/rules/{rule_id}/rollback"
)
async def api_runtime_rollback_rule(
    rule_id: str
):

    try:

        rule = runtime_manager.rollback_rule(
            rule_id
        )

        return {
            "status": "success",
            "action": "rolled_back",
            "rule": rule.model_dump(),
        }

    except ValueError as e:

        raise HTTPException(
            status_code=400,
            detail=str(e),
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not rollback runtime rule: "
                f"{str(e)}"
            ),
        )


# ============================================================
# Mount API Router
# ============================================================

app.include_router(
    api_router
)


# ============================================================
# Legacy Root-Level Incidents Endpoint
# ============================================================

@app.get("/incidents")
async def get_incidents():

    try:

        events = get_recent_events(
            limit=50
        )

        return {
            "status": "success",
            "count": len(events),
            "incidents": events,
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not retrieve incidents: "
                f"{str(e)}"
            ),
        )