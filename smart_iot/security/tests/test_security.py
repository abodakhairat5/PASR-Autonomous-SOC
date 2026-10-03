import json
import pytest
from ..auth import DeviceAuthenticator
from ..crypto import IoTSecureTransport
from ..secure_client import SecureIoTClient


def test_encryption_decryption_flow():
  """اختبار التشفير وفك التشفير بنجاح"""
  secret_key = b"12345678901234567890123456789012"
  client = SecureIoTClient(device_id="TEST_METER_01", secret_key=secret_key)
  original_data = {"voltage": 230.5, "status": "OK"}

  packet = client.prepare_secure_payload(original_data)
  decrypted_data = client.process_incoming_packet(packet)

  assert decrypted_data == original_data
  assert packet["device_id"] == "TEST_METER_01"
  assert "payload" in packet
  assert "nonce" in packet
  assert "timestamp" in packet


def test_tampered_data_rejection():
  """اختبار كشف التلاعب بالبيانات (Integrity/Tampering Failure via AES-GCM)"""
  secret_key = b"12345678901234567890123456789012"
  client = SecureIoTClient(device_id="TEST_METER_01", secret_key=secret_key)
  original_data = {"voltage": 230.5}

  packet = client.prepare_secure_payload(original_data)

  # التلاعب بالـ Payload المشفر (تغيير حرف في الـ Base64)
  tampered_payload = list(packet["payload"])
  tampered_payload[0] = "A" if tampered_payload[0] != "A" else "B"
  packet["payload"] = "".join(tampered_payload)

  # التشفير بـ AES-GCM سيرفض الحزمة المشفرة المتلاعب بها تلقائياً
  with pytest.raises(Exception):
    client.process_incoming_packet(packet)


def test_device_authenticator():
  """اختبار تسجيل وتوثيق الأجهزة"""
  auth = DeviceAuthenticator()
  auth.register_device("METER_99", "secret_token_123")

  assert "METER_99" in auth.registered_devices
  assert auth.registered_devices["METER_99"] == "secret_token_123"
