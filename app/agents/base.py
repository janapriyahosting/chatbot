from dataclasses import dataclass
from typing import Protocol


@dataclass
class Message:
    role: str
    content: str


class Agent(Protocol):
    name: str

    async def reply(self, messages: list[Message], system: str | None = None) -> str: ...
