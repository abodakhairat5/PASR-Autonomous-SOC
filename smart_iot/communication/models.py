
from dataclasses import dataclass
from datetime import datetime


@dataclass
class TelemetryMessage:
    device_id: str
    timestamp: datetime
    payload: dict
<<<<<<< HEAD
    protocol: str = "gRPC"
=======
    protocol: str = "gRPC"
>>>>>>> 2b2e3a4 (Add secure IoT data transmission)
