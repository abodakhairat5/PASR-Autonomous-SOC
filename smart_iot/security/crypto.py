import base64
import os
import time
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class IoTSecureTransport:

  def __init__(self, secret_key: bytes):

    self.key = secret_key
    self.aesgcm = AESGCM(self.key)

  def encrypt_payload(self, data_json_str: str, device_id: str) -> dict:

    nonce = os.urandom(12)

    timestamp = int(time.time())
    associated_data = f"{device_id}:{timestamp}".encode('utf-8')

    ciphertext = self.aesgcm.encrypt(
        nonce, data_json_str.encode('utf-8'), associated_data
    )

    return {
        'device_id': device_id,
        'timestamp': timestamp,
        'nonce': base64.b64encode(nonce).decode('utf-8'),
        'payload': base64.b64encode(ciphertext).decode('utf-8'),
    }

  def decrypt_payload(self, encrypted_packet: dict) -> str:
    device_id = encrypted_packet['device_id']
    timestamp = encrypted_packet['timestamp']
    nonce = base64.b64decode(encrypted_packet['nonce'])
    ciphertext = base64.b64decode(encrypted_packet['payload'])

    associated_data = f"{device_id}:{timestamp}".encode('utf-8')

    decrypted_bytes = self.aesgcm.decrypt(nonce, ciphertext, associated_data)
    return decrypted_bytes.decode('utf-8')
