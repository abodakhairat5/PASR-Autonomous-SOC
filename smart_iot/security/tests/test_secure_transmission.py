import base64
import time

import pytest

from smart_iot.security.auth import DeviceAuthenticator
from smart_iot.security.crypto import IoTSecureTransport


KEY = b"12345678901234567890123456789012"
DEVICE_ID = "meter-001"


def test_device_registration():
    authenticator = DeviceAuthenticator()

    authenticator.register_device(
        DEVICE_ID,
        "secret-token",
    )

    assert authenticator.is_registered(DEVICE_ID)


def test_hmac_signature_verification():
    authenticator = DeviceAuthenticator()

    authenticator.register_device(
        DEVICE_ID,
        "secret-token",
    )

    payload = b'{"power": 967.1}'

    signature = authenticator.generate_signature(
        DEVICE_ID,
        payload,
    )

    assert authenticator.verify_signature(
        DEVICE_ID,
        payload,
        signature,
    )


def test_unknown_device_rejected():
    authenticator = DeviceAuthenticator()

    payload = b'{"power": 967.1}'

    assert not authenticator.verify_signature(
        "unknown-device",
        payload,
        "invalid-signature",
    )


def test_tampered_payload_rejected():
    authenticator = DeviceAuthenticator()

    authenticator.register_device(
        DEVICE_ID,
        "secret-token",
    )

    original_payload = b'{"power": 967.1}'

    signature = authenticator.generate_signature(
        DEVICE_ID,
        original_payload,
    )

    tampered_payload = b'{"power": 10000.0}'

    assert not authenticator.verify_signature(
        DEVICE_ID,
        tampered_payload,
        signature,
    )


def test_encrypt_decrypt_roundtrip():
    crypto = IoTSecureTransport(KEY)

    payload = '{"voltage": 230.5, "power": 967.1}'

    packet = crypto.encrypt_payload(
        payload,
        DEVICE_ID,
        timestamp=int(time.time()),
    )

    decrypted = crypto.decrypt_payload(packet)

    assert decrypted == payload


def test_ciphertext_is_not_plaintext():
    crypto = IoTSecureTransport(KEY)

    payload = '{"voltage": 230.5, "power": 967.1}'

    packet = crypto.encrypt_payload(
        payload,
        DEVICE_ID,
        timestamp=int(time.time()),
    )

    ciphertext = base64.b64decode(packet["payload"])

    assert payload.encode("utf-8") not in ciphertext


def test_tampered_ciphertext_rejected():
    crypto = IoTSecureTransport(KEY)

    packet = crypto.encrypt_payload(
        '{"power": 967.1}',
        DEVICE_ID,
        timestamp=int(time.time()),
    )

    payload_bytes = bytearray(
        base64.b64decode(packet["payload"])
    )

    payload_bytes[0] ^= 1

    packet["payload"] = base64.b64encode(
        bytes(payload_bytes)
    ).decode("utf-8")

    with pytest.raises(
        ValueError,
        match="Packet authentication failed",
    ):
        crypto.decrypt_payload(packet)


def test_wrong_device_id_rejected():
    crypto = IoTSecureTransport(KEY)

    packet = crypto.encrypt_payload(
        '{"power": 967.1}',
        DEVICE_ID,
        timestamp=int(time.time()),
    )

    packet["device_id"] = "meter-999"

    with pytest.raises(
        ValueError,
        match="Packet authentication failed",
    ):
        crypto.decrypt_payload(packet)


def test_wrong_key_rejected():
    crypto = IoTSecureTransport(KEY)

    packet = crypto.encrypt_payload(
        '{"power": 967.1}',
        DEVICE_ID,
        timestamp=int(time.time()),
    )

    wrong_crypto = IoTSecureTransport(
        b"00000000000000000000000000000000"
    )

    with pytest.raises(
        ValueError,
        match="Packet authentication failed",
    ):
        wrong_crypto.decrypt_payload(packet)


def test_malformed_packet_rejected():
    crypto = IoTSecureTransport(KEY)

    malformed_packet = {
        "device_id": DEVICE_ID,
        "timestamp": int(time.time()),
        "nonce": "invalid",
        "payload": "invalid",
    }

    with pytest.raises(
        ValueError,
        match="Invalid base64 encoded packet",
    ):
        crypto.decrypt_payload(malformed_packet)


def test_replay_attack_rejected():
    crypto = IoTSecureTransport(KEY)

    packet = crypto.encrypt_payload(
        '{"power": 967.1}',
        DEVICE_ID,
        timestamp=int(time.time()),
    )

    # First delivery should succeed.
    decrypted = crypto.decrypt_payload(packet)

    assert decrypted == '{"power": 967.1}'

    # Replaying the exact same packet must be rejected.
    with pytest.raises(
        ValueError,
        match="Replay attack detected",
    ):
        crypto.decrypt_payload(packet)


def test_expired_packet_rejected():
    crypto = IoTSecureTransport(
        KEY,
        max_clock_skew=60,
    )

    old_timestamp = int(time.time()) - 120

    packet = crypto.encrypt_payload(
        '{"power": 967.1}',
        DEVICE_ID,
        timestamp=old_timestamp,
    )

    with pytest.raises(
        ValueError,
        match="outside the allowed time window",
    ):
        crypto.decrypt_payload(packet)

