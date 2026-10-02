import random
import time

from .models import TelemetryMessage


class MockTransport:
    """
    Simulates an IoT communication channel.

    Can simulate:
    - network latency
    - message delivery reliability

    This is a development abstraction that can later
    be replaced by MQTT, HTTP, or a real 5G gateway.
    """

    def __init__(
        self,
        latency_ms: float = 0,
        reliability: float = 1.0,
    ):
        if latency_ms < 0:
            raise ValueError("latency_ms cannot be negative")

        if not 0.0 <= reliability <= 1.0:
            raise ValueError("reliability must be between 0.0 and 1.0")

        self.latency_ms = latency_ms
        self.reliability = reliability
        self.messages: list[TelemetryMessage] = []

    def send(self, message: TelemetryMessage) -> bool:
        if self.latency_ms > 0:
            time.sleep(self.latency_ms / 1000)

        if random.random() > self.reliability:
            return False

        self.messages.append(message)
        return True

    def receive(self) -> list[TelemetryMessage]:
        messages = self.messages.copy()
        self.messages.clear()
        return messages