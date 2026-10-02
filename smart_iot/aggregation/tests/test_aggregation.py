from datetime import datetime, timezone
from smart_iot.aggregation.models import (
    calculate_reduction_ratio,
)
from smart_iot.adapters.network_adapter import (
    NetworkFlow,
)

from smart_iot.adapters.sensor_adapter import (
    SensorTelemetry,
)

from smart_iot.aggregation.network_aggregator import (
    aggregate_network_batch,
    aggregate_network_data,
)

from smart_iot.aggregation.sensor_aggregator import (
    aggregate_sensor_data,
    aggregate_sensor_window,
)

from smart_iot.config.data_config import (
    NETWORK_DATASET,
    SENSOR_DATASET,
)


def test_sensor_window_aggregation():
    records = [
        SensorTelemetry(
            timestamp=datetime(
                2025,
                12,
                9,
                11,
                53,
                20,
                tzinfo=timezone.utc,
            ),
            temperature_c=20.0,
            humidity=60.0,
            pir_motion=1.0,
            accel_x_m_s2=None,
            accel_y_m_s2=None,
            accel_z_m_s2=None,
            mq_raw=None,
            mq_gas_detected=None,
            pi_id="pi1",
            anomaly_flag=0,
            anomaly_type="none",
        ),
        SensorTelemetry(
            timestamp=datetime(
                2025,
                12,
                9,
                11,
                53,
                25,
                tzinfo=timezone.utc,
            ),
            temperature_c=22.0,
            humidity=70.0,
            pir_motion=0.0,
            accel_x_m_s2=None,
            accel_y_m_s2=None,
            accel_z_m_s2=None,
            mq_raw=None,
            mq_gas_detected=None,
            pi_id="pi1",
            anomaly_flag=1,
            anomaly_type="temperature",
        ),
    ]

    result = aggregate_sensor_window(records)

    assert result.pi_id == "pi1"
    assert result.sample_count == 2
    assert result.anomaly_count == 1

    assert result.temperature_mean == 21.0
    assert result.temperature_min == 20.0
    assert result.temperature_max == 22.0

    assert result.humidity_mean == 65.0
    assert result.humidity_min == 60.0
    assert result.humidity_max == 70.0

    assert result.motion_count == 1


def test_sensor_window_rejects_empty_input():
    try:
        aggregate_sensor_window([])
        assert False
    except ValueError:
        pass


def test_real_sensor_aggregation():
    aggregates = aggregate_sensor_data(
        SENSOR_DATASET,
        window_seconds=60,
        limit=100,
    )

    assert len(aggregates) > 0

    total_samples = sum(
        item.sample_count
        for item in aggregates
    )

    assert total_samples == 100

    assert all(
        item.sample_count > 0
        for item in aggregates
    )


def test_network_batch_aggregation():
    flows = [
        NetworkFlow(
            row_id=1,
            source_port=40000,
            destination_port=1883,
            protocol="tcp",
            service="mqtt",
            flow_duration=1.0,
            forward_packets=10,
            backward_packets=5,
            packets_per_second=15.0,
            syn_flag_count=1,
            rst_flag_count=0,
            payload_bytes_per_second=1000.0,
            attack_type="MQTT_Publish",
        ),
        NetworkFlow(
            row_id=2,
            source_port=40001,
            destination_port=53,
            protocol="udp",
            service="dns",
            flow_duration=2.0,
            forward_packets=20,
            backward_packets=10,
            packets_per_second=15.0,
            syn_flag_count=0,
            rst_flag_count=1,
            payload_bytes_per_second=2000.0,
            attack_type="none",
        ),
    ]

    result = aggregate_network_batch(
        flows,
        batch_id=0,
    )

    assert result.batch_id == 0
    assert result.flow_count == 2

    assert result.tcp_count == 1
    assert result.udp_count == 1
    assert result.other_protocol_count == 0

    assert result.mqtt_count == 1
    assert result.other_service_count == 1

    assert result.avg_packets_per_second == 15.0

    assert result.total_syn_flags == 1
    assert result.total_rst_flags == 1

    assert result.avg_payload_bytes_per_second == 1500.0

    assert result.attack_flow_count == 1


def test_network_batch_rejects_empty_input():
    try:
        aggregate_network_batch([], batch_id=0)
        assert False
    except ValueError:
        pass


def test_real_network_aggregation():
    aggregates = aggregate_network_data(
        NETWORK_DATASET,
        batch_size=100,
        limit=300,
    )

    assert len(aggregates) == 3

    total_flows = sum(
        item.flow_count
        for item in aggregates
    )

    assert total_flows == 300

    assert all(
        item.flow_count > 0
        for item in aggregates
    )

from smart_iot.aggregation.models import (
    calculate_reduction_ratio,
)


def test_reduction_ratio():
    ratio = calculate_reduction_ratio(
        original_count=300,
        aggregated_count=3,
    )

    assert ratio == 0.99


def test_reduction_ratio_rejects_invalid_values():
    try:
        calculate_reduction_ratio(
            original_count=0,
            aggregated_count=1,
        )
        assert False
    except ValueError:
        pass

    try:
        calculate_reduction_ratio(
            original_count=10,
            aggregated_count=11,
        )
        assert False
    except ValueError:
        pass

def test_real_data_reduction_measurement():
    network_limit = 300

    network_aggregates = aggregate_network_data(
        NETWORK_DATASET,
        batch_size=100,
        limit=network_limit,
    )

    network_reduction = calculate_reduction_ratio(
        original_count=network_limit,
        aggregated_count=len(network_aggregates),
    )

    assert len(network_aggregates) == 3
    assert network_reduction == 0.99

    sensor_limit = 100

    sensor_aggregates = aggregate_sensor_data(
        SENSOR_DATASET,
        window_seconds=60,
        limit=sensor_limit,
    )

    sensor_reduction = calculate_reduction_ratio(
        original_count=sensor_limit,
        aggregated_count=len(sensor_aggregates),
    )

    assert len(sensor_aggregates) > 0
    assert 0.0 <= sensor_reduction <= 1.0

    print(
        f"\nNetwork reduction: "
        f"{network_reduction * 100:.2f}%"
    )

    print(
        f"Sensor reduction: "
        f"{sensor_reduction * 100:.2f}%"
    )