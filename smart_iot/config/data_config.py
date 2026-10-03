import os
from pathlib import Path


DATA_ROOT = Path(
    os.getenv(
        "PASR_DATA_ROOT",
        r"C:\Users\abdok\Downloads\data agent\data agent\data",
    )
)


NETWORK_DATASET = (
    DATA_ROOT
    / "cleaned"
    / "network_rt_iot2022_clean.csv"
)

SENSOR_DATASET = (
    DATA_ROOT
    / "cleaned"
    / "sensor_curated_clean.csv"
)


def validate_data_paths() -> None:
    if not DATA_ROOT.exists():
        raise FileNotFoundError(
            f"Data root does not exist: {DATA_ROOT}"
        )

    if not NETWORK_DATASET.exists():
        raise FileNotFoundError(
            f"Network dataset not found: {NETWORK_DATASET}"
        )

    if not SENSOR_DATASET.exists():
        raise FileNotFoundError(
            f"Sensor dataset not found: {SENSOR_DATASET}"
        )


