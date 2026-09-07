import sqlite3
from pathlib import Path


# The SOC AI engine currently owns the real database.
DB_PATH = (
    Path(__file__).resolve().parent.parent
    / "soc-ai-engine"
    / "soc_threats.db"
)


def get_connection():
    """
    Create a connection to the PASR SOC threat database.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def insert_security_finding(
    finding_id: str,
    title: str,
    severity: str,
    url: str,
    impact: str,
) -> int:
    """
    Store an incoming security finding in the PASR threat database.
    """

    details = (
        f"Finding ID: {finding_id}\n"
        f"Title: {title}\n"
        f"URL: {url}\n"
        f"Impact: {impact}"
    )

    with get_connection() as conn:
        cursor = conn.execute(
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
                "unknown",
                title,
                severity.upper(),
                "RECEIVED",
                False,
                "Security finding received through SOC MCP Server.",
                details,
            ),
        )

        conn.commit()

        return cursor.lastrowid


def _parse_finding(row):
    """
    Convert a database row into a clean security finding object.

    The current database does not have a dedicated finding_id column.
    The finding_id is therefore extracted from the details field.
    """

    details = row["details"] or ""

    finding_id = ""
    url = ""
    impact = ""

    for line in details.splitlines():
        if line.startswith("Finding ID:"):
            finding_id = line.replace("Finding ID:", "", 1).strip()

        elif line.startswith("URL:"):
            url = line.replace("URL:", "", 1).strip()

        elif line.startswith("Impact:"):
            impact = line.replace("Impact:", "", 1).strip()

    return {
        "database_id": row["id"],
        "timestamp": row["timestamp"],
        "finding_id": finding_id,
        "title": row["attack_type"],
        "severity": row["severity"].lower(),
        "url": url,
        "impact": impact,
        "action_taken": row["action_taken"],
        "guardrail_approved": bool(row["guardrail_approved"]),
        "reason": row["reason"],
    }


def get_security_finding(finding_id: str):
    """
    Retrieve a single security finding by finding_id.

    Returns:
        dict if found
        None if not found
    """

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                id,
                timestamp,
                attack_type,
                severity,
                action_taken,
                guardrail_approved,
                reason,
                details
            FROM threat_logs
            ORDER BY id DESC
            """
        ).fetchall()

    for row in rows:
        finding = _parse_finding(row)

        if finding["finding_id"] == finding_id:
            return finding

    return None


def list_security_findings(limit: int = 20):
    """
    Return the most recent security findings.

    The result is ordered from newest to oldest.
    """

    # Keep the limit safe and predictable.
    limit = max(1, min(limit, 100))

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                id,
                timestamp,
                attack_type,
                severity,
                action_taken,
                guardrail_approved,
                reason,
                details
            FROM threat_logs
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [_parse_finding(row) for row in rows]