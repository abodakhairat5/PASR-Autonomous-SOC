from .models import Telemetry


VALID_DEVICE_TYPES = {
    "smart_meter",
    "iot_sensor",
}

VALID_STATUSES = {
    "normal",
    "warning",
    "fault",
}


def validate_telemetry(telemetry: Telemetry) -> tuple[bool, list[str]]:
    errors = []

    if not telemetry.device_id:
        errors.append("device_id is required")

    if telemetry.device_type not in VALID_DEVICE_TYPES:
        errors.append(
            f"invalid device_type: {telemetry.device_type}"
        )

    if telemetry.voltage < 0:
        errors.append("voltage cannot be negative")

    if telemetry.current < 0:
        errors.append("current cannot be negative")

    if telemetry.power < 0:
        errors.append("power cannot be negative")

    if telemetry.frequency <= 0:
        errors.append("frequency must be greater than zero")

    if telemetry.energy < 0:
        errors.append("energy cannot be negative")

    if telemetry.temperature < -50 or telemetry.temperature > 150:
        errors.append("temperature is outside valid range")

    if telemetry.status not in VALID_STATUSES:
        errors.append(
            f"invalid status: {telemetry.status}"
        )

    return len(errors) == 0, errors