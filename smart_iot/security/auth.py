import hashlib
import hmac


class DeviceAuthenticator:

  def __init__(self, registered_devices: dict = None):

    self.registered_devices = registered_devices or {}

  def register_device(self, device_id: str, secret_token: str):
    self.registered_devices[device_id] = secret_token

  def verify_device(
      self, device_id: str, token: str, payload_bytes: bytes, signature: str
  ) -> bool:

    if device_id not in self.registered_devices:
      return False

    device_key = self.registered_devices[device_id].encode('utf-8')
    computed_sig = hmac.new(device_key, payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed_sig, signature)
