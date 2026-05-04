"""Validate submitted form values against field type definitions."""
import re

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_IN_PHONE = re.compile(r"^[6-9]\d{9}$")
_URL = re.compile(r"^https?://[^\s]+$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_field(field: dict, raw: str) -> tuple[bool, str | None, str]:
    """Returns (ok, error_msg, normalized_value)."""
    ftype = (field.get("type") or "text").lower()
    label = field.get("label") or field.get("name") or "field"
    value = (raw or "").strip()
    required = field.get("required", True)

    if not value:
        if required:
            return False, f"{label} is required", ""
        return True, None, ""

    if ftype == "email":
        if not _EMAIL.match(value):
            return False, f"{label}: invalid email", value
    elif ftype in ("tel", "phone"):
        # Normalize to 10-digit Indian mobile. Accept formats like:
        #   9063454971, 09063454971, +919063454971, 91-9063454971, (+91) 90634-54971
        digits = re.sub(r"\D", "", value)
        if len(digits) == 13 and digits.startswith("091"):
            digits = digits[3:]
        elif len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]
        elif len(digits) == 11 and digits.startswith("0"):
            digits = digits[1:]
        if not _IN_PHONE.match(digits):
            return False, f"{label}: must be a 10-digit Indian mobile", digits
        value = digits
    elif ftype == "number":
        try:
            n = float(value) if "." in value else int(value)
        except ValueError:
            return False, f"{label}: must be a number", value
        lo, hi = field.get("min"), field.get("max")
        if lo is not None and n < lo:
            return False, f"{label}: must be ≥ {lo}", value
        if hi is not None and n > hi:
            return False, f"{label}: must be ≤ {hi}", value
        value = str(n)
    elif ftype == "url":
        if not _URL.match(value):
            return False, f"{label}: invalid URL", value
    elif ftype in ("select", "radio"):
        choices = {str(o.get("value", o.get("label"))) for o in (field.get("options") or [])}
        if choices and value not in choices:
            return False, f"{label}: not one of {sorted(choices)}", value
    elif ftype == "date":
        if not _DATE.match(value):
            return False, f"{label}: must be YYYY-MM-DD", value
    elif ftype == "checkbox":
        # Accept boolean-ish strings and normalize
        v = value.lower()
        if v in ("true", "yes", "on", "1"):
            value = "true"
        elif v in ("false", "no", "off", "0"):
            value = "false"
        else:
            return False, f"{label}: must be true/false", value
    elif ftype == "file":
        # Widget uploads the file first, submits the returned URL as the value
        if not value.startswith(("http://", "https://", "/static/uploads/")):
            return False, f"{label}: must be an uploaded file URL", value
    # text/textarea: just non-empty

    return True, None, value


def validate_form(fields: list[dict], values: dict) -> tuple[dict, dict]:
    """Returns (normalized_values, errors_by_field)."""
    errors: dict[str, str] = {}
    cleaned: dict[str, str] = {}
    for f in fields:
        name = f["name"]
        ok, err, norm = validate_field(f, str(values.get(name, "")))
        if ok:
            cleaned[name] = norm
        else:
            errors[name] = err or "invalid"
    return cleaned, errors
