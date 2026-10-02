from smart_iot.adapters.network_adapter import (
    NetworkFlow,
    load_network_flows,
)

from smart_iot.adapters.sensor_adapter import (
    SensorTelemetry,
    load_sensor_telemetry,
)

from smart_iot.config.data_config import (
    NETWORK_DATASET,
    SENSOR_DATASET,
    validate_data_paths,
)


def test_real_data_paths():
    validate_data_paths()

    assert NETWORK_DATASET.exists()
    assert SENSOR_DATASET.exists()


def test_network_adapter():
    flows = list(
        load_network_flows(
            NETWORK_DATASET,
            limit=3,
        )
    )

    assert len(flows) == 3
    assert all(
        isinstance(flow, NetworkFlow)
        for flow in flows
    )

    assert flows[0].protocol == "tcp"
    assert flows[0].service == "mqtt"
    assert flows[0].destination_port == 1883
    assert flows[0].attack_type == "MQTT_Publish"


def test_sensor_adapter():
    telemetry = list(
        load_sensor_telemetry(
            SENSOR_DATASET,
            limit=3,
        )
    )

    assert len(telemetry) == 3
    assert all(
        isinstance(item, SensorTelemetry)
        for item in telemetry
    )

    assert telemetry[0].pi_id == "pi4"
    assert telemetry[0].anomaly_flag == 0
    assert telemetry[0].anomaly_type == "none"