from urllib.parse import urlparse


ALLOWED_SEVERITIES = {
    "low",
    "medium",
    "high",
    "critical",
}


def validate_security_finding(
    finding_id: str,
    title: str,
    severity: str,
    url: str,
    impact: str,
) -> dict:
    """
    Validate a security finding before storing it in the SOC database.
    """

    errors = []

    # finding_id
    if not finding_id or not finding_id.strip():
        errors.append("finding_id is required.")

    # title
    if not title or not title.strip():
        errors.append("title is required.")

    # severity
    normalized_severity = severity.strip().lower() if severity else ""

    if normalized_severity not in ALLOWED_SEVERITIES:
        errors.append(
            "severity must be one of: low, medium, high, critical."
        )

    # URL
    if not url or not url.strip():
        errors.append("url is required.")
    else:
        parsed_url = urlparse(url)

        if parsed_url.scheme not in {"http", "https"}:
            errors.append("url must use http or https.")

        if not parsed_url.netloc:
            errors.append("url must be a valid URL.")

    # impact
    if not impact or not impact.strip():
        errors.append("impact is required.")

    if errors:
        return {
            "valid": False,
            "errors": errors,
        }

    return {
        "valid": True,
        "errors": [],
        "normalized": {
            "finding_id": finding_id.strip(),
            "title": title.strip(),
            "severity": normalized_severity,
            "url": url.strip(),
            "impact": impact.strip(),
        },
    }