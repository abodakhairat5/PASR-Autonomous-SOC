from datetime import datetime, timedelta
from pathlib import Path

from smart_iot.adapters.sensor_adapter import (
    SensorTelemetry,
    load_sensor_telemetry,
)

from .models import SensorAggregate


def _mean(values: list[float]) -> float | None:
    if not values:
        return None

    return sum(values) / len(values)


def _min(values: list[float]) -> float | None:
    if not values:
        return None

    return min(values)


def _max(values: list[float]) -> float | None:
    if not values:
        return None

    return max(values)


def aggregate_sensor_window(
    records: list[SensorTelemetry],
) -> SensorAggregate:
    if not records:
        raise ValueError("Cannot aggregate an empty sensor window.")

    pi_ids = {record.pi_id for record in records}

    if len(pi_ids) != 1:
        raise ValueError(
            "A sensor window must contain records from one pi_id."
        )

    temperatures = [
        record.temperature_c
        for record in records
        if record.temperature_c is not None
    ]

    humidities = [
        record.humidity
        for record in records
        if record.humidity is not None
    ]

    motion_count = sum(
        1
        for record in records
        if record.pir_motion is not None
        and record.pir_motion > 0
    )

    anomaly_count = sum(
        1
        for record in records
        if record.anomaly_flag == 1
    )

    timestamps = [
        record.timestamp
        for record in records
    ]

    window_start = min(timestamps)
    window_end = max(timestamps)

    return SensorAggregate(
        pi_id=records[0].pi_id,
        window_start=window_start.isoformat(),
        window_end=window_end.isoformat(),

        sample_count=len(records),
        anomaly_count=anomaly_count,

        temperature_mean=_mean(temperatures),
        temperature_min=_min(temperatures),
        temperature_max=_max(temperatures),

        humidity_mean=_mean(humidities),
        humidity_min=_min(humidities),
        humidity_max=_max(humidities),

        motion_count=motion_count,
    )


def aggregate_sensor_data(
    path: Path,
    window_seconds: int = 60,
    limit: int | None = None,
) -> list[SensorAggregate]:

    if window_seconds <= 0:
        raise ValueError(
            "window_seconds must be greater than zero."
        )

    aggregates: list[SensorAggregate] = []

    current_window: list[SensorTelemetry] = []
    current_pi_id: str | None = None
    window_start: datetime | None = None

    for record in load_sensor_telemetry(
        path,
        limit=limit,
    ):
        if current_pi_id is None:
            current_pi_id = record.pi_id
            window_start = record.timestamp

        should_start_new_window = (
            record.pi_id != current_pi_id
            or (
                window_start is not None
                and record.timestamp - window_start
                >= timedelta(seconds=window_seconds)
            )
        )

        if should_start_new_window:
            if current_window:
                aggregates.append(
                    aggregate_sensor_window(
                        current_window
                    )
                )

            current_window = []
            current_pi_id = record.pi_id
            window_start = record.timestamp

        current_window.append(record)

    if current_window:
        aggregates.append(
            aggregate_sensor_window(
                current_window
            )
        )

    return aggregates