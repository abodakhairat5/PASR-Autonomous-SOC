import json
import sqlite3
import urllib.request
from datetime import datetime
from typing import Any


DB_NAME = "soc_threats.db"


def _ensure_schema():
    """
    Idempotently add the `details` column to threat_logs and create the
    simulated-action log table.

    The `details` column stores the full JSON pipeline result (attack,
    correlation, risk, decision, rule, explanation, knowledge, guardrail)
    so the UI can surface rich detail for historical incidents. Existing
    rows simply have NULL until the next analysis persists details.
    """
    conn = sqlite3.connect(DB_NAME)
    try:
        cur = conn.cursor()
        cols = [row[1] for row in cur.execute("PRAGMA table_info(threat_logs)")]
        if "details" not in cols:
            cur.execute(
                "ALTER TABLE threat_logs ADD COLUMN details TEXT"
            )
            conn.commit()

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS simulated_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id INTEGER,
                action TEXT,
                outcome TEXT,
                recorded_at TEXT DEFAULT (datetime('now', 'localtime'))
            )
            """
        )
        conn.commit()
    except Exception:
        # Migration is best-effort and non-destructive.
        pass
    finally:
        conn.close()


# Ensure the schema is up to date when the module loads.
_ensure_schema()


def get_connection():
    """
    Create and return a connection to the SOC SQLite database.
    """
    return sqlite3.connect(DB_NAME)


def _row_to_incident(row: sqlite3.Row) -> dict[str, Any]:
    """
    Convert a sqlite3.Row into a dict, parsing the `details` JSON column
    into a nested dict (falling back to None when absent or invalid).
    """
    item = dict(row)
    details_raw = item.pop("details", None)
    if details_raw:
        try:
            item["details"] = json.loads(details_raw)
        except (ValueError, TypeError):
            item["details"] = None
    else:
        item["details"] = None
    return item


def get_events_by_source_ip(source_ip: str, limit: int = 20) -> list[dict[str, Any]]:
    """
    Retrieve historical security events associated with a specific source IP.

    This function is used by the Threat Correlator Agent to compare
    the current event against previously observed activity.
    """

    if not source_ip or source_ip == "Unknown":
        return []

    conn = get_connection()
    conn.row_factory = sqlite3.Row

    try:
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                id,
                timestamp,
                source_ip,
                attack_type,
                severity,
                action_taken,
                guardrail_approved,
                reason,
                details
            FROM threat_logs
            WHERE source_ip = ?
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (source_ip, limit),
        )

        rows = cursor.fetchall()

        return [_row_to_incident(row) for row in rows]

    finally:
        conn.close()

def get_knowledge_by_source_ip(
    source_ip: str,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """
    Retrieve previously learned Knowledge Agent outputs for a source IP.

    Knowledge is stored inside the persisted pipeline details and is used
    only as historical evidence for future correlation.
    It does NOT act as an executable security policy.
    """

    if not source_ip or source_ip == "Unknown":
        return []

    conn = get_connection()
    conn.row_factory = sqlite3.Row

    try:
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                id,
                timestamp,
                source_ip,
                attack_type,
                severity,
                action_taken,
                guardrail_approved,
                reason,
                details
            FROM threat_logs
            WHERE source_ip = ?
              AND details IS NOT NULL
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
            """,
            (source_ip, limit),
        )

        rows = cursor.fetchall()

        knowledge_items = []

        for row in rows:
            event = _row_to_incident(row)
            details = event.get("details") or {}
            knowledge = details.get("knowledge")

            if not knowledge:
                continue

            knowledge_items.append(
                {
                    "event_id": event.get("id"),
                    "timestamp": event.get("timestamp"),
                    "source_ip": event.get("source_ip"),
                    "attack_type": event.get("attack_type"),
                    "severity": event.get("severity"),
                    "validated_action": knowledge.get("validated_action"),
                    "validation_status": knowledge.get("validation_status"),
                    "confidence": knowledge.get("confidence"),
                    "lesson": knowledge.get("lesson"),
                    "reusable_pattern": knowledge.get("reusable_pattern"),
                }
            )

        return knowledge_items

    finally:
        conn.close()

def get_recent_events(limit: int = 10) -> list[dict[str, Any]]:
    """
    Retrieve the most recent SOC security events.
    """

    conn = get_connection()
    conn.row_factory = sqlite3.Row

    try:
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                id,
                timestamp,
                source_ip,
                attack_type,
                severity,
                action_taken,
                guardrail_approved,
                reason,
                details
            FROM threat_logs
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (limit,),
        )

        rows = cursor.fetchall()

        return [_row_to_incident(row) for row in rows]

    finally:
        conn.close()


def save_event(
    source_ip: str,
    attack_type: str,
    severity: str,
    action_taken: str,
    guardrail_approved: bool,
    reason: str,
    details: dict | None = None,
) -> None:
    """
    Save a validated SOC incident into the knowledge/memory store.

    `details` may contain the full pipeline JSON result (attack, correlation,
    risk, decision, rule, explanation, knowledge, guardrail) which is stored
    so the dashboard can display rich historical context.
    """

    conn = get_connection()

    try:
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO threat_logs (
                source_ip,
                attack_type,
                severity,
                action_taken,
                guardrail_approved,
                reason,
                details
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_ip,
                attack_type,
                severity,
                action_taken,
                int(guardrail_approved),
                reason,
                json.dumps(details) if details else None,
            ),
        )

        conn.commit()

    finally:
        conn.close()


def memory_summary() -> dict[str, int]:
    """
    Return a summary of stored SOC events.
    """

    conn = get_connection()

    try:
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM threat_logs")
        total_events = cursor.fetchone()[0]

        cursor.execute(
            """
            SELECT COUNT(*)
            FROM threat_logs
            WHERE guardrail_approved = 1
            """
        )
        approved_events = cursor.fetchone()[0]

        cursor.execute(
            """
            SELECT COUNT(*)
            FROM threat_logs
            WHERE guardrail_approved = 0
            """
        )
        blocked_events = cursor.fetchone()[0]

        return {
            "total_events": total_events,
            "approved_events": approved_events,
            "blocked_events": blocked_events,
        }

    finally:
        conn.close()


def get_all_events(limit: int = 500) -> list[dict[str, Any]]:
    """
    Retrieve all SOC security events from the database,
    most recent first.
    """

    conn = get_connection()
    conn.row_factory = sqlite3.Row

    try:
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                id,
                timestamp,
                source_ip,
                attack_type,
                severity,
                action_taken,
                guardrail_approved,
                reason,
                details
            FROM threat_logs
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        )

        rows = cursor.fetchall()

        return [_row_to_incident(row) for row in rows]

    finally:
        conn.close()


def get_event_by_id(event_id: int) -> dict[str, Any] | None:
    """
    Return a single SOC event by its database id, or None when missing.
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row

    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                id,
                timestamp,
                source_ip,
                attack_type,
                severity,
                action_taken,
                guardrail_approved,
                reason,
                details
            FROM threat_logs
            WHERE id = ?
            """,
            (event_id,),
        )
        row = cursor.fetchone()
        return _row_to_incident(row) if row else None

    finally:
        conn.close()


def get_event_stats() -> dict[str, Any]:
    """
    Compute dashboard statistics from the actual threat database.
    """

    conn = get_connection()

    try:
        cursor = conn.cursor()

        def count(query: str, params: tuple = ()) -> int:
            cursor.execute(query, params)
            return cursor.fetchone()[0]

        total_events = count("SELECT COUNT(*) FROM threat_logs")

        blocked_events = count(
            "SELECT COUNT(*) FROM threat_logs WHERE action_taken = 'BLOCK'"
        )

        alert_events = count(
            "SELECT COUNT(*) FROM threat_logs WHERE action_taken IN ('ALERT', 'ALERT_HUMAN_ANALYST')"
        )

        human_alerts = count(
            "SELECT COUNT(*) FROM threat_logs WHERE action_taken = 'ALERT_HUMAN_ANALYST'"
        )

        critical_events = count(
            "SELECT COUNT(*) FROM threat_logs WHERE severity IN ('HIGH', 'CRITICAL')"
        )

        approved_events = count(
            "SELECT COUNT(*) FROM threat_logs WHERE guardrail_approved = 1"
        )

        rejected_events = count(
            "SELECT COUNT(*) FROM threat_logs WHERE guardrail_approved = 0"
        )

        # Human-analyst alerts are, by design, pending operator review until
        # a human acts. Exposed as pending_review for the dashboard.
        pending_review = human_alerts

        # Attack type breakdown
        cursor.execute(
            """
            SELECT attack_type, COUNT(*)
            FROM threat_logs
            GROUP BY attack_type
            ORDER BY COUNT(*) DESC
            """
        )
        attack_types = {
            row[0]: row[1] for row in cursor.fetchall()
        }

        # Severity breakdown
        cursor.execute(
            """
            SELECT severity, COUNT(*)
            FROM threat_logs
            GROUP BY severity
            ORDER BY COUNT(*) DESC
            """
        )
        severity_breakdown = {
            row[0]: row[1] for row in cursor.fetchall()
        }

        # Action breakdown
        cursor.execute(
            """
            SELECT action_taken, COUNT(*)
            FROM threat_logs
            GROUP BY action_taken
            ORDER BY COUNT(*) DESC
            """
        )
        action_breakdown = {
            row[0]: row[1] for row in cursor.fetchall()
        }

        return {
            "total_events": total_events,
            "blocked_events": blocked_events,
            "alerts": alert_events,
            "human_alerts": human_alerts,
            "pending_review": pending_review,
            "critical_events": critical_events,
            "high_critical": critical_events,
            "approved_events": approved_events,
            "rejected_events": rejected_events,
            "attack_types": attack_types,
            "severities": severity_breakdown,
            "actions": action_breakdown,
        }

    finally:
        conn.close()


def get_dashboard_data(limit: int = 500) -> dict[str, Any]:
    """
    Build the complete payload required to render the SOC dashboard
    in a single request.
    """

    events = get_all_events(limit=limit)
    stats = get_event_stats()

    return {
        "status": "success",
        "stats": stats,
        "incidents": events[:10],
        "recent_events": events[:10],
        "incident_count": stats["total_events"],
    }


# ============================================================
# Response Actions
# ============================================================

def get_response_actions(limit: int = 200) -> list[dict[str, Any]]:
    """
    Return the security actions PASR took, enriched with the fields the
    frontend displays. Values are read from real event data; fields that
    are only known from the pipeline (recommended action / priority) come
    from the persisted details when available, otherwise they are omitted
    (never fabricated).
    """
    actions = []
    for event in get_all_events(limit=limit):
        details = event.get("details") or {}

        decision = details.get("decision") or {}
        rule = details.get("rule") or {}
        risk = details.get("risk") or {}
        attack = details.get("attack") or {}

        action = {
            "id": event.get("id"),
            "timestamp": event.get("timestamp"),
            "source_ip": event.get("source_ip"),
            "target_ip": event.get("source_ip"),
            "attack_type": event.get("attack_type"),
            "severity": event.get("severity"),
            "final_action": event.get("action_taken"),
            "guardrail_approved": bool(event.get("guardrail_approved")),
            "reason": event.get("reason"),
        }

        # Only add pipeline-known fields when actually present.
        recommended_action = decision.get("recommended_action")
        if recommended_action:
            action["recommended_action"] = recommended_action

        priority = decision.get("priority")
        if priority:
            action["priority"] = priority

        technique = attack.get("technique_id") or details.get(
            "knowledge", {}
        ).get("event_type")
        if attack.get("technique_id"):
            action["technique_id"] = attack["technique_id"]

        if risk.get("risk_score") is not None:
            action["risk_score"] = risk["risk_score"]

        if rule.get("rule_description"):
            action["rule_description"] = rule["rule_description"]

        actions.append(action)

    return actions


# ============================================================
# Simulated response actions (safe SOC demo)
# ============================================================

def record_simulated_action(incident_id: int, action: str) -> dict[str, Any]:
    """
    Record a SAFE simulated execution of a response action.

    This does NOT touch any real network/firewall state — it simply logs
    that the operator "executed" the action inside the simulation so the
    SOC demo can track simulated responses end to end.
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO simulated_actions (incident_id, action, outcome)
            VALUES (?, ?, 'SIMULATED')
            """,
            (incident_id, action),
        )
        conn.commit()
        row = cursor.execute(
            "SELECT * FROM simulated_actions WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return dict(row)

    finally:
        conn.close()


def get_simulated_actions(limit: int = 50) -> list[dict[str, Any]]:
    """
    Return the recorded simulated action executions joined with the
    originating incident, most recent first.
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                s.id,
                s.incident_id,
                s.action,
                s.outcome,
                s.recorded_at,
                t.source_ip,
                t.attack_type,
                t.severity,
                t.action_taken AS final_action
            FROM simulated_actions s
            LEFT JOIN threat_logs t ON t.id = s.incident_id
            ORDER BY s.id DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]

    finally:
        conn.close()


# ============================================================
# AI Agents metadata
# ============================================================

AGENT_DEFINITIONS = [
    {
        "key": "attack",
        "stage": 1,
        "name": "Attack Analyzer",
        "description": (
            "Detects and classifies incoming security events, extracting the "
            "source IP, attack type and MITRE ATT&CK technique."
        ),
    },
    {
        "key": "correlation",
        "stage": 2,
        "name": "Threat Correlator",
        "description": (
            "Correlates the current event against historical activity for the "
            "same source IP to surface recurring patterns."
        ),
    },
    {
        "key": "risk",
        "stage": 3,
        "name": "Risk Assessment",
        "description": (
            "Calculates severity, impact and an overall risk score from 0-100."
        ),
    },
    {
        "key": "decision",
        "stage": 4,
        "name": "Decision Agent",
        "description": (
            "Selects the autonomous response action (BLOCK, ALERT, THROTTLE) "
            "with a priority and confidence score."
        ),
    },
    {
        "key": "rule",
        "stage": 5,
        "name": "Rule Generator",
        "description": (
            "Generates a runtime security rule describing the enforcement "
            "action, target, protocol and direction."
        ),
    },
    {
        "key": "explanation",
        "stage": 6,
        "name": "Explanation Agent",
        "description": (
            "Produces an analyst-readable explanation of the decision with "
            "key evidence and recommendations."
        ),
    },
    {
        "key": "knowledge",
        "stage": 7,
        "name": "Knowledge Agent",
        "description": (
            "Stores validated security knowledge and reusable patterns for "
            "future correlation."
        ),
    },
    {
        "key": "guardrail",
        "stage": 8,
        "name": "Guardrails",
        "description": (
            "Final safety layer validating the AI action against critical "
            "infrastructure protection and high-risk policies."
        ),
    },
]


def _describe_stage(key: str, details: dict) -> str | None:
    """
    Build a short, real description of one pipeline stage from the persisted
    details of the most recent analyzed incident. Returns None when the stage
    has no stored output (nothing is fabricated).
    """
    if not details:
        return None

    if key == "attack":
        a = details.get("attack") or {}
        parts = [p for p in [a.get("technique_id"), a.get("summary")] if p]
        return " / ".join(parts) if parts else None

    if key == "correlation":
        c = details.get("correlation") or {}
        parts = [p for p in [c.get("correlation_status"), c.get("pattern")] if p]
        return " / ".join(parts) if parts else None

    if key == "risk":
        r = details.get("risk") or {}
        score = r.get("risk_score")
        parts = []
        if score is not None:
            parts.append(f"score {score}")
        for p in [r.get("severity"), r.get("impact"), r.get("summary")]:
            if p:
                parts.append(p)
        return " / ".join(parts) if parts else None

    if key == "decision":
        d = details.get("decision") or {}
        parts = []
        for p in [d.get("recommended_action"), d.get("priority"), d.get("reasoning")]:
            if p:
                parts.append(p)
        return " / ".join(parts) if parts else None

    if key == "rule":
        r = details.get("rule") or {}
        parts = [p for p in [r.get("rule_type"), r.get("rule_description")] if p]
        return " / ".join(parts) if parts else None

    if key == "explanation":
        e = details.get("explanation") or {}
        return e.get("decision_summary") or e.get("explanation") or None

    if key == "knowledge":
        k = details.get("knowledge") or {}
        parts = []
        for p in [k.get("validated_action"), k.get("validation_status"), k.get("lesson")]:
            if p:
                parts.append(p)
        return " / ".join(parts) if parts else None

    if key == "guardrail":
        g = details.get("guardrail") or {}
        parts = []
        if g.get("approved") is not None:
            parts.append("approved" if g.get("approved") else "rejected")
        for p in [g.get("override_action"), g.get("reason")]:
            if p:
                parts.append(p)
        return " / ".join(parts) if parts else None

    return None


def get_agents(backend_online: bool = True) -> list[dict[str, Any]]:
    """
    Return the PASR 8-stage pipeline agents.

    Individual agent "health" cannot be measured independently — the agents
    only run when the full pipeline executes. Instead, each agent's status is
    the real pipeline-level availability derived from live backend, database
    and Ollama checks:

        - 'Operational' : backend + database + AI runtime all reachable
        - 'Degraded'    : backend reachable but a required dependency is down
        - 'Offline'     : backend itself is unreachable

    `last_execution` and `last_output` are derived from the most recent
    incident that persists full pipeline details — real data, never
    fabricated. Both are null when no detailed analysis has been stored.
    """
    health = get_pipeline_health(backend_online=backend_online)

    status_map = {
        "operational": "Operational",
        "degraded": "Degraded",
        "offline": "Offline",
    }
    status = status_map.get(health["status"], "Unavailable")

    latest_details = None
    latest_timestamp = None

    leader = get_recent_events(limit=1)
    if leader:
        candidate = leader[0]
        if candidate.get("details"):
            latest_details = candidate["details"]
            latest_timestamp = candidate.get("timestamp")

    agents = []
    for definition in AGENT_DEFINITIONS:
        agents.append(
            {
                "key": definition["key"],
                "stage": definition["stage"],
                "name": definition["name"],
                "description": definition["description"],
                "status": status,
                "last_execution": latest_timestamp,
                "last_output": _describe_stage(definition["key"], latest_details),
            }
        )
    return agents


# ============================================================
# Infrastructure status
# ============================================================

def _now() -> str:
    """
    Current local time in the same format the SQLite database uses for its
    `timestamp` values ('datetime('now','localtime')').
    """
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _check_database() -> bool:
    """
    Perform a real availability check against the SQLite threat database.
    """
    try:
        conn = get_connection()
        conn.execute("SELECT 1 FROM threat_logs LIMIT 1")
        conn.close()
        return True
    except Exception:
        return False


def _check_ollama() -> tuple[bool, list[str]]:
    """
    Perform a real reachability check against the local Ollama API and
    return (ok, list_of_loaded_models). Uses a short timeout so the health
    endpoint stays fast.
    """
    try:
        req = urllib.request.Request("http://127.0.0.1:11434/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        models = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
        return True, models
    except Exception:
        return False, []


def get_pipeline_health(backend_online: bool = True) -> dict[str, Any]:
    """
    Compute the real pipeline-level availability from live system checks:
    backend reachability, SQLite database availability, and the Ollama model
    runtime. Returns a status of 'operational', 'degraded' or 'offline'.
    """
    db_ok = _check_database()
    ollama_ok, _ = _check_ollama()

    if not backend_online:
        status = "offline"
    elif db_ok and ollama_ok:
        status = "operational"
    else:
        status = "degraded"

    return {
        "status": status,
        "database": "available" if db_ok else "unavailable",
        "ai": "online" if ollama_ok else "offline",
    }


def get_infrastructure(backend_online: bool = True) -> dict[str, Any]:
    """
    Return consolidated infrastructure status derived from real system
    checks: backend reachability, SQLite database availability, and a live
    Ollama / Qwen model probe.
    """
    db_ok = _check_database()

    ollama_ok, ollama_models = _check_ollama()

    api_status = "online" if backend_online else "offline"
    db_status = "available" if db_ok else "unavailable"

    if not backend_online:
        pipeline_status = "offline"
    elif db_ok and ollama_ok:
        pipeline_status = "operational"
    else:
        pipeline_status = "degraded"

    return {
        "status": "success",
        "checked_at": _now(),
        "api": {
            "name": "PASR API",
            "status": api_status,
            "detail": "FastAPI service on port 8000" if backend_online
            else "FastAPI service unreachable",
        },
        "database": {
            "name": "Threat Database",
            "status": db_status,
            "detail": "SQLite soc_threats.db"
            if db_ok
            else "Cannot verify database",
        },
        "ollama": {
            "name": "Ollama / Qwen",
            "status": "online" if ollama_ok else "offline",
            "detail": "Models: " + ", ".join(ollama_models)
            if ollama_ok
            else "Ollama unreachable on port 11434",
        },
        "pipeline": {
            "name": "AI Pipeline",
            "status": pipeline_status,
            "detail": "8-stage multi-agent pipeline (qwen2.5:7b via Ollama)",
        },
        "guardrails": {
            "name": "Guardrails",
            "status": "active" if backend_online and db_ok else "unknown",
            "detail": "Critical infrastructure & high-risk action policies enforced",
        },
        "endpoints": {
            "api": "http://127.0.0.1:8000",
            "frontend": "http://localhost:5174",
        },
    }