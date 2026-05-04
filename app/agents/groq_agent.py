from groq import AsyncGroq

from app.agents.base import Message
from app.core.config import settings


class GroqAgent:
    name = "groq"

    def __init__(self, model: str | None = None) -> None:
        self._client = AsyncGroq(api_key=settings.groq_api_key)
        self._model = model or settings.groq_model

    async def reply(self, messages: list[Message], system: str | None = None) -> str:
        payload = []
        if system:
            payload.append({"role": "system", "content": system})
        payload.extend({"role": m.role, "content": m.content} for m in messages)
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=payload,
            temperature=0.3,
        )
        return resp.choices[0].message.content or ""
