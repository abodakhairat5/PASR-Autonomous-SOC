import sqlite3
from typing import Any


DB_NAME = "soc_threats.db"


def get_connection():
    """
    Create and return a connection to the SOC SQLite database.
    """
    return sqlite3.connect(DB_NAME)


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
                timestamp,
                source_ip,
                attack_type,
                severity,
                action_taken,
                guardrail_approved,
                reason
            FROM threat_logs
            WHERE source_ip = ?
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (source_ip, limit),
        )

        rows = cursor.fetchall()

        return [dict(row) for row in rows]

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
                timestamp,
                source_ip,
                attack_type,
                severity,
                action_taken,
                guardrail_approved,
                reason
            FROM threat_logs
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (limit,),
        )

        rows = cursor.fetchall()

        return [dict(row) for row in rows]

    finally:
        conn.close()


def save_event(
    source_ip: str,
    attack_type: str,
    severity: str,
    action_taken: str,
    guardrail_approved: bool,
    reason: str,
) -> None:
    """
    Save a validated SOC incident into the knowledge/memory store.
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
                reason
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                source_ip,
                attack_type,
                severity,
                action_taken,
                int(guardrail_approved),
                reason,
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