import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


@dataclass
class NetworkFlow:
    row_id: int
    source_port: int
    destination_port: int
    protocol: str
    service: str
    flow_duration: float
    forward_packets: float
    backward_packets: float
    packets_per_second: float
    syn_flag_count: float
    rst_flag_count: float
    payload_bytes_per_second: float
    attack_type: str


def _to_int(value: str) -> int:
    return int(float(value))


def _to_float(value: str) -> float:
    return float(value)


def load_network_flows(
    path: Path,
    limit: int | None = None,
) -> Iterator[NetworkFlow]:

    with path.open(
        "r",
        newline="",
        encoding="utf-8",
    ) as file:

        reader = csv.DictReader(file)

        for index, row in enumerate(reader):

            if limit is not None and index >= limit:
                break

            yield NetworkFlow(
                row_id=_to_int(row["row_id"]),
                source_port=_to_int(row["id.orig_p"]),
                destination_port=_to_int(row["id.resp_p"]),
                protocol=row["proto"],
                service=row["service"],
                flow_duration=_to_float(row["flow_duration"]),
                forward_packets=_to_float(row["fwd_pkts_tot"]),
                backward_packets=_to_float(row["bwd_pkts_tot"]),
                packets_per_second=_to_float(
                    row["flow_pkts_per_sec"]
                ),
                syn_flag_count=_to_float(
                    row["flow_SYN_flag_count"]
                ),
                rst_flag_count=_to_float(
                    row["flow_RST_flag_count"]
                ),
                payload_bytes_per_second=_to_float(
                    row["payload_bytes_per_second"]
                ),
                attack_type=row["Attack_type"],
            )