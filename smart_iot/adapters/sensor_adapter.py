import csv
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterator


@dataclass
class SensorTelemetry:
    timestamp: datetime
    temperature_c: float | None
    humidity: float | None
    pir_motion: float | None

    accel_x_m_s2: float | None
    accel_y_m_s2: float | None
    accel_z_m_s2: float | None

    mq_raw: float | None
    mq_gas_detected: float | None

    pi_id: str

    anomaly_flag: int
    anomaly_type: str


def _optional_float(value: str) -> float | None:
    if value is None or value == "":
        return None

    return float(value)


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(
        value.replace("Z", "+00:00")
    )


def load_sensor_telemetry(
    path: Path,
    limit: int | None = None,
) -> Iterator[SensorTelemetry]:

    with path.open(
        "r",
        newline="",
        encoding="utf-8",
    ) as file:

        reader = csv.DictReader(file)

        for index, row in enumerate(reader):

            if limit is not None and index >= limit:
                break

            yield SensorTelemetry(
                timestamp=_parse_timestamp(
                    row["timestamp"]
                ),
                temperature_c=_optional_float(
                    row["temperature_C"]
                ),
                humidity=_optional_float(
                    row["humidity"]
                ),
                pir_motion=_optional_float(
                    row["pir_motion"]
                ),
                accel_x_m_s2=_optional_float(
                    row["accel_x_m_s2"]
                ),
                accel_y_m_s2=_optional_float(
                    row["accel_y_m_s2"]
                ),
                accel_z_m_s2=_optional_float(
                    row["accel_z_m_s2"]
                ),
                mq_raw=_optional_float(
                    row["mq_raw"]
                ),
                mq_gas_detected=_optional_float(
                    row["mq_gas_detected"]
                ),
                pi_id=row["pi_id"],
                anomaly_flag=int(
                    float(row["anomaly_flag"])
                ),
                anomaly_type=row["anomaly_type"],
            )