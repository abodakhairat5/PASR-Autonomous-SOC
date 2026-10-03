
from dataclasses import dataclass
from datetime import datetime


@dataclass
class TelemetryMessage:
    device_id: str
    timestamp: datetime
    payload: dict
    protocol: str = "gRPC"
