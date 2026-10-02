from datetime import datetime

from .models import Telemetry


def load_mock_telemetry() -> list[Telemetry]:
    return [
        Telemetry(
            device_id="meter-001",
            timestamp=datetime.now(),
            device_type="smart_meter",
            voltage=230.5,
            current=4.2,
            power=967.1,
            frequency=50.0,
            energy=12.8,
            temperature=31.4,
            status="normal",
        ),
        Telemetry(
            device_id="meter-002",
            timestamp=datetime.now(),
            device_type="smart_meter",
            voltage=229.8,
            current=3.8,
            power=872.4,
            frequency=50.0,
            energy=10.6,
            temperature=30.9,
            status="normal",
        ),
    ]