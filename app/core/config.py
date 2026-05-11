from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_WEAK_JWT_SECRETS = {
    "", "change-me", "changeme", "secret", "password", "dev", "test",
    "your-secret-key", "supersecret",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", populate_by_name=True
    )

    groq_api_key: str
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"

    whatsapp_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("WHATSAPP_API_KEY", "CHAT360_API_KEY"),
    )
    whatsapp_from: str = Field(
        default="",
        validation_alias=AliasChoices("WHATSAPP_FROM", "CHAT360_FROM"),
    )
    whatsapp_webhook_secret: str = Field(
        default="",
        validation_alias=AliasChoices("WHATSAPP_WEBHOOK_SECRET", "CHAT360_WEBHOOK_SECRET"),
    )
    whatsapp_session_message_url: str = ""

    database_url: str
    db_schema: str = "chatbot"

    valkey_url: str = "valkey://127.0.0.1:6379/0"
    valkey_prefix: str = "chatbot:"

    jpus_api_base: str = "http://127.0.0.1:8000"
    jpus_otp_prefix: str = "/api/v1/auth"
    otp_dev_bypass: bool = False
    otp_max_attempts: int = 3

    # --- OTP gateway (SmartPing by default; falls back to jpus if empty) ---
    # Secrets go only in .env, never in source.
    otp_provider: str = "smartping"  # "smartping" | "jpus"
    otp_ttl_seconds: int = 300        # 5 minutes
    smartping_base_url: str = "https://pgapi.smartping.ai/fe/api/v1/multiSend"
    smartping_username: str = ""
    smartping_password: str = ""
    smartping_sender_id: str = "JPTOWN"
    smartping_dlt_content_id: str = ""
    smartping_dlt_telemarketer_id: str = ""
    smartping_dlt_principal_entity_id: str = ""
    smartping_template: str = (
        "Your OTP for verifying your account on JanapriyaUpscale.com is {otp}. "
        "It is valid for 5 minutes. Do not share this code with anyone."
    )

    # Geofence: accept requests where the upstream proxy (nginx/Cloudflare) sets
    # `geofence_header` to one of `geofence_allow` (comma-separated ISO codes).
    # When `geofence_strict` is False, requests without the header are allowed —
    # convenient for dev. Private/loopback IPs are always allowed.
    geofence_header: str = "CF-IPCountry"
    geofence_allow: str = "IN"
    geofence_strict: bool = False

    jwt_secret: str
    jwt_ttl_hours: int = 12

    # OpenAPI docs (/docs, /redoc, /openapi.json) enumerate every admin route
    # and schema. Default off; flip on for dev/staging only.
    docs_enabled: bool = False

    @field_validator("jwt_secret")
    @classmethod
    def _jwt_secret_strong(cls, v: str) -> str:
        if v.strip().lower() in _WEAK_JWT_SECRETS:
            raise ValueError(
                "jwt_secret is set to a known-weak value; generate one with "
                "`python -c 'import secrets; print(secrets.token_urlsafe(48))'`"
            )
        if len(v) < 32:
            raise ValueError(
                f"jwt_secret must be at least 32 chars (got {len(v)}); "
                "generate one with `python -c 'import secrets; print(secrets.token_urlsafe(48))'`"
            )
        return v

    default_system_prompt: str = (
        "You are a concise, helpful assistant. Prefer short answers unless asked for detail."
    )

    # --- SMTP (email notifications) ---
    # Empty `smtp_host` disables outbound email entirely (no-op).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True   # STARTTLS on connect (port 587)
    smtp_use_ssl: bool = False  # implicit TLS (port 465). Only one of these.

    # Public-facing base URL used in email deeplinks (e.g. assignment notifications).
    public_base_url: str = "https://chatbot.janapriyahomes.com"

    # --- Microsoft 365 / Entra ID OAuth (strict allowlist) ---
    # Empty values disable the "Sign in with Microsoft" button.
    o365_tenant_id: str = ""
    o365_client_id: str = ""
    o365_client_secret: str = ""
    o365_redirect_path: str = "/auth/o365/callback"


settings = Settings()
