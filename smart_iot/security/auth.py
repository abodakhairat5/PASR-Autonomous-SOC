import hashlib
import hmac


class DeviceAuthenticator:
    """
    Authenticates IoT devices using a pre-shared secret.

    Each registered device has its own secret.
    HMAC-SHA256 is used to authenticate the payload.
    """

    def __init__(self, registered_devices: dict[str, str] | None = None):
        self.registered_devices = registered_devices or {}

    def register_device(
        self,
        device_id: str,
        secret: str,
    ) -> None:
        if not device_id:
            raise ValueError("device_id is required")

        if not secret:
            raise ValueError("device secret is required")

        self.registered_devices[device_id] = secret

    def is_registered(self, device_id: str) -> bool:
        return device_id in self.registered_devices

    def generate_signature(
        self,
        device_id: str,
        payload_bytes: bytes,
    ) -> str:
        if not self.is_registered(device_id):
            raise ValueError(f"Unknown device: {device_id}")

        secret = self.registered_devices[device_id].encode("utf-8")

        return hmac.new(
            secret,
            payload_bytes,
            hashlib.sha256,
        ).hexdigest()

    def verify_signature(
        self,
        device_id: str,
        payload_bytes: bytes,
        signature: str,
    ) -> bool:
        if not self.is_registered(device_id):
            return False

        expected_signature = self.generate_signature(
            device_id,
            payload_bytes,
        )

        return hmac.compare_digest(
            expected_signature,
            signature,
        )
    
