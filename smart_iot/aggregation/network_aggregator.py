from pathlib import Path

from smart_iot.adapters.network_adapter import (
    NetworkFlow,
    load_network_flows,
)

from .models import NetworkAggregate


def aggregate_network_batch(
    flows: list[NetworkFlow],
    batch_id: int,
) -> NetworkAggregate:
    if not flows:
        raise ValueError("Cannot aggregate an empty network batch.")

    tcp_count = sum(
        1 for flow in flows
        if flow.protocol.lower() == "tcp"
    )

    udp_count = sum(
        1 for flow in flows
        if flow.protocol.lower() == "udp"
    )

    other_protocol_count = (
        len(flows)
        - tcp_count
        - udp_count
    )

    mqtt_count = sum(
        1 for flow in flows
        if flow.service.lower() == "mqtt"
    )

    other_service_count = (
        len(flows)
        - mqtt_count
    )

    avg_packets_per_second = (
        sum(flow.packets_per_second for flow in flows)
        / len(flows)
    )

    total_syn_flags = sum(
        flow.syn_flag_count
        for flow in flows
    )

    total_rst_flags = sum(
        flow.rst_flag_count
        for flow in flows
    )

    avg_payload_bytes_per_second = (
        sum(
            flow.payload_bytes_per_second
            for flow in flows
        )
        / len(flows)
    )

    attack_flow_count = sum(
        1
        for flow in flows
        if flow.attack_type
        and flow.attack_type.lower() != "none"
    )

    return NetworkAggregate(
        batch_id=batch_id,
        flow_count=len(flows),

        tcp_count=tcp_count,
        udp_count=udp_count,
        other_protocol_count=other_protocol_count,

        mqtt_count=mqtt_count,
        other_service_count=other_service_count,

        avg_packets_per_second=avg_packets_per_second,
        total_syn_flags=total_syn_flags,
        total_rst_flags=total_rst_flags,
        avg_payload_bytes_per_second=(
            avg_payload_bytes_per_second
        ),

        attack_flow_count=attack_flow_count,
    )


def aggregate_network_data(
    path: Path,
    batch_size: int = 1000,
    limit: int | None = None,
) -> list[NetworkAggregate]:

    if batch_size <= 0:
        raise ValueError(
            "batch_size must be greater than zero."
        )

    aggregates: list[NetworkAggregate] = []
    batch: list[NetworkFlow] = []
    batch_id = 0

    for flow in load_network_flows(
        path,
        limit=limit,
    ):
        batch.append(flow)

        if len(batch) >= batch_size:
            aggregates.append(
                aggregate_network_batch(
                    batch,
                    batch_id,
                )
            )

            batch = []
            batch_id += 1

    if batch:
        aggregates.append(
            aggregate_network_batch(
                batch,
                batch_id,
            )
        )

    return aggregates