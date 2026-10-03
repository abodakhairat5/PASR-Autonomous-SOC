import json
import logging
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
  """Client class that coordinates encryption, authentication, and transmission

  of smart meter / IoT data to the server or cloud.
  """

  def __init__(
      self,
      device_id: str,
      secret_key: Optional[bytes] = None,
      auth_token: Optional[str] = None,
  ):
    self.device_id = device_id
    self.crypto = IoTSecureTransport(secret_key=secret_key)
    self.authenticator = DeviceAuthenticator()
    if auth_token:
      self.authenticator.register_device(device_id, auth_token)

  def prepare_secure_payload(
      self, raw_or_aggregated_data: Dict[str, Any]
  ) -> Dict[str, Any]:
    """Takes aggregated data from the aggregation layer, serializes it to

    JSON, and encrypts it safely.

    Returns a secure transmission packet.
    """
    try:
      json_data = json.dumps(raw_or_aggregated_data)

      encrypted_packet = self.crypto.encrypt_payload(json_data, self.device_id)

      logger.info(
          f"Successfully encrypted payload for Device ID: {self.device_id}"
      )
      return encrypted_packet

    except Exception as e:
      logger.error(
          f"Failed to prepare secure payload for {self.device_id}: {e}"
      )
      raise e

  def process_incoming_packet(
      self, encrypted_packet: Dict[str, Any]
  ) -> Dict[str, Any]:
    """Used on the server/receiver side to verify integrity and decrypt data."""
    try:

      decrypted_json_str = self.crypto.decrypt_payload(encrypted_packet)
      data = json.loads(decrypted_json_str)

      logger.info(
          "Successfully validated & decrypted packet from:"
          f" {encrypted_packet.get('device_id')}"
      )
      return data

    except ValueError as val_err:
      logger.error(f"Security Validation Alert: {val_err}")
      raise val_err
    except Exception as e:
      logger.error(f"Failed to decrypt packet: {e}")
      raise e


if __name__ == "__main__":
  client = SecureIoTClient(
      device_id="SMART_METER_001", secret_key=b"12345678901234567890123456789012"
  )

  dummy_aggregated_data = {
      "meter_id": "SMART_METER_001",
      "avg_voltage": 220.4,
      "total_consumption_kwh": 45.2,
      "status": "NORMAL",
  }

  packet = client.prepare_secure_payload(dummy_aggregated_data)
  print("\n--- Encrypted Packet ---")
  print(json.dumps(packet, indent=2))

  decrypted = client.process_incoming_packet(packet)
  print("\n--- Decrypted Data ---")
  print(decrypted)
