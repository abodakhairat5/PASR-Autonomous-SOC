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
                "pentest",
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
def init_validation_tables():
    """
    Create tables required for SOC-side pentest validation.
    Safe to call multiple times.
    """

    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pentest_validations (
                validation_id TEXT PRIMARY KEY,
                finding_id TEXT NOT NULL,
                rule_id TEXT,
                target_url TEXT,
                attack_vector TEXT,
                correlation_id TEXT,
                status TEXT NOT NULL,
                result TEXT,
                evidence TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT
            )
            """
        )

        conn.commit()


def create_validation_request(
    validation_id: str,
    finding_id: str,
    rule_id: str | None,
    target_url: str | None,
    attack_vector: str | None,
    correlation_id: str | None,
):
    """
    Store a new pentest validation request.
    """

    init_validation_tables()

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO pentest_validations (
                validation_id,
                finding_id,
                rule_id,
                target_url,
                attack_vector,
                correlation_id,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                validation_id,
                finding_id,
                rule_id,
                target_url,
                attack_vector,
                correlation_id,
                "REQUESTED",
            ),
        )

        conn.commit()


def update_validation_result(
    validation_id: str,
    result: str,
    evidence: str | None = None,
):
    """
    Store the authoritative result returned by PentesterWorkflow.
    """

    init_validation_tables()

    allowed_results = {
        "BLOCKED",
        "NOT_BLOCKED",
        "ERROR",
    }

    if result not in allowed_results:
        raise ValueError(
            f"result must be one of: {', '.join(sorted(allowed_results))}"
        )

    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE pentest_validations
            SET
                status = ?,
                result = ?,
                evidence = ?,
                completed_at = CURRENT_TIMESTAMP
            WHERE validation_id = ?
            """,
            (
                "COMPLETED",
                result,
                evidence,
                validation_id,
            ),
        )

        conn.commit()

        if cursor.rowcount == 0:
            raise ValueError(
                f"Validation '{validation_id}' was not found."
            )


def get_validation(validation_id: str):
    """
    Retrieve a validation request/result.
    """

    init_validation_tables()

    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT
                validation_id,
                finding_id,
                rule_id,
                target_url,
                attack_vector,
                correlation_id,
                status,
                result,
                evidence,
                created_at,
                completed_at
            FROM pentest_validations
            WHERE validation_id = ?
            """,
            (validation_id,),
        ).fetchone()

    if row is None:
        return None

    return dict(row)


def list_validations(limit: int = 20):
    """
    Return recent pentest validations.
    """

    init_validation_tables()

    limit = max(1, min(limit, 100))

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                validation_id,
                finding_id,
                rule_id,
                target_url,
                attack_vector,
                correlation_id,
                status,
                result,
                evidence,
                created_at,
                completed_at
            FROM pentest_validations
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [dict(row) for row in rows]