from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    groq_api_key: str
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"

    chat360_api_key: str = ""
    chat360_from: str = ""
    chat360_webhook_secret: str = ""

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

    default_system_prompt: str = (
        "You are a concise, helpful assistant. Prefer short answers unless asked for detail."
    )


settings = Settings()
