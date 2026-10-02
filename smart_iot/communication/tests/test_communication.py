from datetime import datetime

import pytest

from smart_iot.communication.models import TelemetryMessage
from smart_iot.communication.transport import MockTransport


def create_message(device_id="meter-001"):
    return TelemetryMessage(
        device_id=device_id,
        timestamp=datetime.now(),
        payload={
            "voltage": 230.5,
            "current": 4.2,
        },
    )


def test_send_and_receive():
    transport = MockTransport()

    message = create_message()

    delivered = transport.send(message)

    assert delivered is True

    received = transport.receive()

    assert len(received) == 1
    assert received[0] == message


def test_receive_clears_buffer():
    transport = MockTransport()

    transport.send(create_message())

    first_receive = transport.receive()
    second_receive = transport.receive()

    assert len(first_receive) == 1
    assert second_receive == []


def test_multiple_messages():
    transport = MockTransport()

    for i in range(3):
        transport.send(create_message(f"meter-{i:03d}"))

    received = transport.receive()

    assert len(received) == 3


def test_reliable_transport():
    transport = MockTransport(
        latency_ms=0,
        reliability=1.0,
    )

    delivered = transport.send(create_message())

    assert delivered is True
    assert len(transport.receive()) == 1


def test_unreliable_transport():
    transport = MockTransport(
        latency_ms=0,
        reliability=0.0,
    )

    delivered = transport.send(create_message())

    assert delivered is False
    assert transport.receive() == []


def test_invalid_latency():
    with pytest.raises(ValueError):
        MockTransport(latency_ms=-1)


def test_invalid_reliability():
    with pytest.raises(ValueError):
        MockTransport(reliability=1.5)