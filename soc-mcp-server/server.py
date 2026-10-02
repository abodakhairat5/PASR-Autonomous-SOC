from mcp.server.mcpserver import MCPServer

from database import (
    insert_security_finding,
    get_security_finding as db_get_security_finding,
    list_security_findings as db_list_security_findings,
    create_validation_request,
    update_validation_result,
    get_validation as db_get_validation,
    list_validations as db_list_validations,
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

@mcp.tool()
def request_pentest_validation(
    validation_id: str,
    finding_id: str,
    rule_id: str = "",
    target_url: str = "",
    attack_vector: str = "",
    correlation_id: str = "",
) -> dict:
    """
    Request PentesterWorkflow to re-test a previously detected
    security finding after SOC mitigation.

    This tool creates the SOC-side validation contract.
    """

    if not validation_id.strip():
        return {
            "status": "rejected",
            "message": "validation_id is required.",
        }

    if not finding_id.strip():
        return {
            "status": "rejected",
            "message": "finding_id is required.",
        }

    try:
        create_validation_request(
            validation_id=validation_id.strip(),
            finding_id=finding_id.strip(),
            rule_id=rule_id.strip() or None,
            target_url=target_url.strip() or None,
            attack_vector=attack_vector.strip() or None,
            correlation_id=correlation_id.strip() or None,
        )

    except Exception as exc:
        return {
            "status": "error",
            "message": "Failed to create validation request.",
            "error": str(exc),
        }

    return {
        "status": "requested",
        "validation_id": validation_id,
        "finding_id": finding_id,
        "rule_id": rule_id or None,
        "message": (
            "Pentest validation request created. "
            "PentesterWorkflow should re-test the finding."
        ),
    }


@mcp.tool()
def submit_pentest_validation_result(
    validation_id: str,
    result: str,
    evidence: str = "",
) -> dict:
    """
    Receive the authoritative result of a PentesterWorkflow
    re-test.

    Allowed results:
    - BLOCKED
    - NOT_BLOCKED
    - ERROR
    """

    result = result.strip().upper()

    try:
        update_validation_result(
            validation_id=validation_id.strip(),
            result=result,
            evidence=evidence.strip() or None,
        )

    except ValueError as exc:
        return {
            "status": "rejected",
            "message": str(exc),
        }

    except Exception as exc:
        return {
            "status": "error",
            "message": "Failed to store validation result.",
            "error": str(exc),
        }

    validation = db_get_validation(validation_id.strip())

    return {
        "status": "completed",
        "validation": validation,
        "message": "Pentest validation result stored successfully.",
    }


@mcp.tool()
def get_pentest_validation(
    validation_id: str,
) -> dict:
    """
    Retrieve a pentest validation request/result.
    """

    if not validation_id.strip():
        return {
            "status": "error",
            "message": "validation_id is required.",
        }

    try:
        validation = db_get_validation(
            validation_id.strip()
        )

    except Exception as exc:
        return {
            "status": "error",
            "message": "Failed to retrieve validation.",
            "error": str(exc),
        }

    if validation is None:
        return {
            "status": "not_found",
            "validation_id": validation_id,
        }

    return {
        "status": "found",
        "validation": validation,
    }


@mcp.tool()
def list_pentest_validations(
    limit: int = 20,
) -> dict:
    """
    Return recent pentest validation records.
    """

    try:
        validations = db_list_validations(limit)

    except Exception as exc:
        return {
            "status": "error",
            "message": "Failed to retrieve validations.",
            "error": str(exc),
        }

    return {
        "status": "success",
        "count": len(validations),
        "validations": validations,
    }