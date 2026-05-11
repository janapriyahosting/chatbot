"""Generate a VAPID keypair for Web Push.

Run once per install. Paste the printed values into .env, restart
chatbot-api. The public key gets shipped to the agent PWA frontend as
the applicationServerKey when it subscribes; the private key stays on
the server and signs each outbound push.

    .venv/bin/python scripts/gen_vapid.py
"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def main() -> None:
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key()

    priv_raw = priv.private_numbers().private_value.to_bytes(32, "big")
    pub_raw = pub.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    print("# Paste into .env, then restart chatbot-api:")
    print(f"VAPID_PUBLIC_KEY={_b64url(pub_raw)}")
    print(f"VAPID_PRIVATE_KEY={_b64url(priv_raw)}")
    print("VAPID_CONTACT_EMAIL=narendhar@janapriyaupscale.com  # who push services should contact")


if __name__ == "__main__":
    main()
