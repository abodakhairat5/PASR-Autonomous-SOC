from mcp.server.mcpserver import MCPServer

from database import (
    insert_security_finding,
    get_security_finding as db_get_security_finding,
    list_security_findings as db_list_security_findings,
)

from validation import validate_security_finding


mcp = MCPServer("PASR SOC MCP Server")


@mcp.tool()
def health_check() -> str:
    """
    Check whether the PASR SOC MCP Server is operational.
    """

    return "PASR SOC MCP Server is operational"


@mcp.tool()
def submit_security_finding(
    finding_id: str,
    title: str,
    severity: str,
    url: str,
    impact: str,
) -> dict:
    """
    Receive, validate, normalize, and store a confirmed
    security finding from the PentesterFlow MCP client.
    """

    # ---------------------------------------------------------
    # Step 1: Validate and normalize the finding
    # ---------------------------------------------------------

    validation = validate_security_finding(
        finding_id=finding_id,
        title=title,
        severity=severity,
        url=url,
        impact=impact,
    )

    # ---------------------------------------------------------
    # Step 2: Reject invalid findings
    # ---------------------------------------------------------

    if not validation["valid"]:
        return {
            "status": "rejected",
            "database_status": "not_stored",
            "errors": validation["errors"],
            "message": "Security finding failed validation.",
        }

    # ---------------------------------------------------------
    # Step 3: Use normalized values
    # ---------------------------------------------------------

    normalized = validation["normalized"]

    # ---------------------------------------------------------
    # Step 4: Store the validated finding
    # ---------------------------------------------------------

    try:
        database_id = insert_security_finding(
            normalized["finding_id"],
            normalized["title"],
            normalized["severity"],
            normalized["url"],
            normalized["impact"],
        )

    except Exception as exc:
        return {
            "status": "error",
            "database_status": "storage_failed",
            "error": str(exc),
            "message": (
                "Security finding was validated "
                "but could not be stored."
            ),
        }

    # ---------------------------------------------------------
    # Step 5: Return successful result
    # ---------------------------------------------------------

    return {
        "status": "received",
        "database_status": "stored",
        "database_id": database_id,
        "finding": normalized,
        "message": (
            "Security finding validated and stored successfully."
        ),
    }


@mcp.tool()
def get_security_finding(finding_id: str) -> dict:
    """
    Retrieve a previously stored security finding
    using its finding_id.
    """

    # Basic validation
    if not finding_id or not finding_id.strip():
        return {
            "status": "error",
            "message": "finding_id is required.",
        }

    finding_id = finding_id.strip()

    try:
        finding = db_get_security_finding(finding_id)

    except Exception as exc:
        return {
            "status": "error",
            "message": "Failed to retrieve security finding.",
            "error": str(exc),
        }

    # Finding does not exist
    if finding is None:
        return {
            "status": "not_found",
            "message": "Security finding was not found.",
            "finding_id": finding_id,
        }

    # Finding found
    return {
        "status": "found",
        "finding": finding,
    }


@mcp.tool()
def list_security_findings(limit: int = 20) -> dict:
    """
    Return the most recently received security findings.

    Maximum number of results is 100.
    """

    try:
        findings = db_list_security_findings(limit)

    except Exception as exc:
        return {
            "status": "error",
            "message": "Failed to retrieve security findings.",
            "error": str(exc),
        }

    return {
        "status": "success",
        "count": len(findings),
        "findings": findings,
    }


if __name__ == "__main__":
    mcp.run(
        transport="streamable-http",
        host="0.0.0.0",
        port=8765,
        streamable_http_path="/mcp",
    )