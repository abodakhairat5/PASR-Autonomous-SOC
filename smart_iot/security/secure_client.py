import json
import logging
import time
from typing import Any, Dict, Optional

try:
    from .auth import DeviceAuthenticator
    from .crypto import IoTSecureTransport
except ImportError:
    from auth import DeviceAuthenticator
    from crypto import IoTSecureTransport


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SecureIoTClient")


class SecureIoTClient:
    """
    Client class that coordinates secure preparation and
    processing of smart meter / IoT data.

    Encryption is handled by IoTSecureTransport using AES-GCM.
    Device authentication support is provided by DeviceAuthenticator.
    """

    def __init__(
        self,
        device_id: str,
        secret_key: Optional[bytes] = None,
        auth_token: Optional[str] = None,
    ):
        self.device_id = device_id

        if secret_key is None:
            raise ValueError("secret_key is required")

        self.crypto = IoTSecureTransport(
            secret_key=secret_key
        )

        self.authenticator = DeviceAuthenticator()

        if auth_token:
            self.authenticator.register_device(
                device_id,
                auth_token,
            )

    def prepare_secure_payload(
        self,
        raw_or_aggregated_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Serialize and encrypt IoT telemetry.

        A current Unix timestamp is included in the packet
        and authenticated as part of the AES-GCM AAD.
        """
        try:
            json_data = json.dumps(raw_or_aggregated_data)

            timestamp = int(time.time())

            encrypted_packet = self.crypto.encrypt_payload(
                json_data,
                self.device_id,
                timestamp,
            )

            logger.info(
                "Successfully encrypted payload for Device ID: "
                f"{self.device_id}"
            )

            return encrypted_packet

        except Exception as e:
            logger.error(
                f"Failed to prepare secure payload for "
                f"{self.device_id}: {e}"
            )
            raise

    def process_incoming_packet(
        self,
        encrypted_packet: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Decrypt and validate an incoming secure IoT packet.

        IoTSecureTransport performs:
        - timestamp freshness validation
        - packet integrity validation
        - replay detection
        - AES-GCM decryption
        """
        try:
            decrypted_json_str = self.crypto.decrypt_payload(
                encrypted_packet
            )

            data = json.loads(decrypted_json_str)

            logger.info(
                "Successfully validated & decrypted packet from: "
                f"{encrypted_packet.get('device_id')}"
            )

            return data

        except ValueError as val_err:
            logger.error(
                f"Security Validation Alert: {val_err}"
            )
            raise

        except Exception as e:
            logger.error(
                f"Failed to decrypt packet: {e}"
            )
            raise


if __name__ == "__main__":
    client = SecureIoTClient(
        device_id="SMART_METER_001",
        secret_key=b"12345678901234567890123456789012",
    )

    dummy_aggregated_data = {
        "meter_id": "SMART_METER_001",
        "avg_voltage": 220.4,
        "total_consumption_kwh": 45.2,
        "status": "NORMAL",
    }

    packet = client.prepare_secure_payload(
        dummy_aggregated_data
    )

    print("\n--- Encrypted Packet ---")
    print(json.dumps(packet, indent=2))

    decrypted = client.process_incoming_packet(packet)

    print("\n--- Decrypted Data ---")
    print(decrypted)

