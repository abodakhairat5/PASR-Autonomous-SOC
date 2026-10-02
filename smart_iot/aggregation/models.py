from dataclasses import dataclass


@dataclass
class SensorAggregate:
    pi_id: str
    window_start: str
    window_end: str

    sample_count: int
    anomaly_count: int

    temperature_mean: float | None
    temperature_min: float | None
    temperature_max: float | None

    humidity_mean: float | None
    humidity_min: float | None
    humidity_max: float | None

    motion_count: int


@dataclass
class NetworkAggregate:
    batch_id: int
    flow_count: int

    tcp_count: int
    udp_count: int
    other_protocol_count: int

    mqtt_count: int
    other_service_count: int

    avg_packets_per_second: float
    total_syn_flags: float
    total_rst_flags: float
    avg_payload_bytes_per_second: float

    attack_flow_count: int

def calculate_reduction_ratio(
    original_count: int,
    aggregated_count: int,
) -> float:
    if original_count <= 0:
        raise ValueError(
            "original_count must be greater than zero."
        )

    if aggregated_count < 0:
        raise ValueError(
            "aggregated_count cannot be negative."
        )

    if aggregated_count > original_count:
        raise ValueError(
            "aggregated_count cannot exceed original_count."
        )

    return (
        1 - (aggregated_count / original_count)
    )