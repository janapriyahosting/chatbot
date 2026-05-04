from app.agents.base import Message
from app.agents.gemini_agent import GeminiAgent
from app.agents.groq_agent import GroqAgent
from app.core.config import settings

HEAVY_HINTS = ("explain in detail", "step by step", "analyze", "compare", "reason through")
HEAVY_TOKENS_APPROX = 600


class AgentRouter:
    """Layered routing.

    Groq handles short/fast turns. Gemini takes over for long context or
    explicit reasoning requests. `force` lets a caller pin a specific agent.
    """

    def __init__(self) -> None:
        self._groq = GroqAgent()
        self._gemini = GeminiAgent()

    def _pick(self, messages: list[Message]) -> str:
        total_chars = sum(len(m.content) for m in messages)
        last = messages[-1].content.lower() if messages else ""
        if total_chars > HEAVY_TOKENS_APPROX * 4:
            return "gemini"
        if any(h in last for h in HEAVY_HINTS):
            return "gemini"
        return "groq"

    async def reply(
        self,
        messages: list[Message],
        system: str | None = None,
        force: str | None = None,
    ) -> tuple[str, str]:
        agent_name = force or self._pick(messages)
        agent = self._gemini if agent_name == "gemini" else self._groq
        text = await agent.reply(messages, system or settings.default_system_prompt)
        return text, agent.name
