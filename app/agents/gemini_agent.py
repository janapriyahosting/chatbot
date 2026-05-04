import google.generativeai as genai

from app.agents.base import Message
from app.core.config import settings

genai.configure(api_key=settings.gemini_api_key)


class GeminiAgent:
    name = "gemini"

    def __init__(self, model: str | None = None) -> None:
        self._model_name = model or settings.gemini_model

    async def reply(self, messages: list[Message], system: str | None = None) -> str:
        model = genai.GenerativeModel(
            model_name=self._model_name,
            system_instruction=system or settings.default_system_prompt,
        )
        history = [
            {"role": "user" if m.role == "user" else "model", "parts": [m.content]}
            for m in messages[:-1]
        ]
        last = messages[-1].content if messages else ""
        chat = model.start_chat(history=history)
        resp = await chat.send_message_async(last)
        return resp.text or ""
