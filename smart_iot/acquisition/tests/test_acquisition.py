from datetime import datetime

from smart_iot.acquisition.loader import load_mock_telemetry
from smart_iot.acquisition.models import Telemetry
from smart_iot.acquisition.validator import validate_telemetry


def test_mock_telemetry_loader():
    data = load_mock_telemetry()

    assert len(data) == 2

    for telemetry in data:
        assert isinstance(telemetry, Telemetry)


def test_valid_telemetry():
    data = load_mock_telemetry()

    for telemetry in data:
        valid, errors = validate_telemetry(telemetry)

        assert valid is True
        assert errors == []


def test_invalid_telemetry():
    telemetry = Telemetry(
        device_id="",
        timestamp=datetime.now(),
        device_type="unknown",
        voltage=-10,
        current=-2,
        power=-100,
        frequency=0,
        energy=-5,
        temperature=300,
        status="broken",
    )

    valid, errors = validate_telemetry(telemetry)

    assert valid is False
    assert len(errors) > 0