#  //Telemetry model
from dataclasses import dataclass
from datetime import datetime


@dataclass
class Telemetry:
    device_id: str
    timestamp: datetime
    device_type: str

    voltage: float
    current: float
    power: float
    frequency: float
    energy: float

    temperature: float
    status: str