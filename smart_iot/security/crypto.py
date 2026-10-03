import base64
import os
import time

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class IoTSecureTransport:
    """
    Provides authenticated encryption for IoT telemetry.

    AES-GCM provides:
    - Confidentiality
    - Integrity
    - Authentication of encrypted data

    Replay protection is provided using:
    - Timestamp freshness validation
    - Previously processed nonce tracking
    """

    NONCE_SIZE = 12

    def __init__(
        self,
        secret_key: bytes,
        max_clock_skew: int = 60,
    ):
        if not isinstance(secret_key, bytes):
            raise TypeError("secret_key must be bytes")

        if len(secret_key) not in (16, 24, 32):
            raise ValueError(
                "AES key must be 16, 24, or 32 bytes long"
            )

        if max_clock_skew < 0:
            raise ValueError(
                "max_clock_skew cannot be negative"
            )

        self.key = secret_key
        self.aesgcm = AESGCM(secret_key)
        self.max_clock_skew = max_clock_skew

        # Stores successfully processed nonces.
        # Used to detect replayed packets.
        self.seen_nonces: set[tuple[str, bytes]] = set()

    def encrypt_payload(
        self,
        data_json_str: str,
        device_id: str,
        timestamp: int,
    ) -> dict:
        if not device_id:
            raise ValueError("device_id is required")

        if not isinstance(data_json_str, str):
            raise TypeError("data_json_str must be a string")

        if not isinstance(timestamp, int):
            raise ValueError("timestamp must be an integer")

        nonce = os.urandom(self.NONCE_SIZE)

        # Device ID and timestamp are authenticated
        # as Additional Authenticated Data (AAD).
        associated_data = (
            f"{device_id}:{timestamp}"
        ).encode("utf-8")

        ciphertext = self.aesgcm.encrypt(
            nonce,
            data_json_str.encode("utf-8"),
            associated_data,
        )

        return {
            "device_id": device_id,
            "timestamp": timestamp,
            "nonce": base64.b64encode(nonce).decode("utf-8"),
            "payload": base64.b64encode(ciphertext).decode("utf-8"),
        }

    def decrypt_payload(
        self,
        encrypted_packet: dict,
    ) -> str:
        required_fields = {
            "device_id",
            "timestamp",
            "nonce",
            "payload",
        }

        missing_fields = required_fields - encrypted_packet.keys()

        if missing_fields:
            raise ValueError(
                f"Missing packet fields: {sorted(missing_fields)}"
            )

        device_id = encrypted_packet["device_id"]
        timestamp = encrypted_packet["timestamp"]

        if not device_id:
            raise ValueError("device_id is required")

        if not isinstance(timestamp, int):
            raise ValueError("timestamp must be an integer")

        # Reject packets that are too old or too far in the future.
        current_time = int(time.time())

        if abs(current_time - timestamp) > self.max_clock_skew:
            raise ValueError(
                "Packet timestamp is outside the allowed time window"
            )

        try:
            nonce = base64.b64decode(
                encrypted_packet["nonce"],
                validate=True,
            )

            ciphertext = base64.b64decode(
                encrypted_packet["payload"],
                validate=True,
            )
        except Exception as exc:
            raise ValueError(
                "Invalid base64 encoded packet"
            ) from exc

        if len(nonce) != self.NONCE_SIZE:
            raise ValueError("Invalid nonce length")

        # Identify a previously processed packet.
        nonce_key = (device_id, nonce)

        if nonce_key in self.seen_nonces:
            raise ValueError(
                "Replay attack detected: packet was already processed"
            )

        associated_data = (
            f"{device_id}:{timestamp}"
        ).encode("utf-8")

        try:
            decrypted_bytes = self.aesgcm.decrypt(
                nonce,
                ciphertext,
                associated_data,
            )
        except InvalidTag as exc:
            raise ValueError(
                "Packet authentication failed or data was tampered with"
            ) from exc

        # Mark the packet as processed only after successful
        # authentication and decryption.
        self.seen_nonces.add(nonce_key)

        return decrypted_bytes.decode("utf-8")

