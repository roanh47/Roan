"""Channel-abstractie: laat dezelfde Roan-agent via meerdere platforms praten."""

from __future__ import annotations

import time

from ..agent import Agent


class Channel:
    """Basis voor een kanaal. Houdt per gesprek een eigen Agent bij."""

    name = "channel"

    def __init__(self):
        self._agents: dict[str, Agent] = {}

    def agent_for(self, conversation_id: str) -> Agent:
        key = str(conversation_id)
        if key not in self._agents:
            self._agents[key] = Agent(session_id=f"{self.name}-{key}")
        return self._agents[key]

    def reset(self, conversation_id: str) -> Agent:
        agent = self.agent_for(conversation_id)
        agent.session_id = f"{self.name}-{conversation_id}-{int(time.time())}"
        agent.clear()
        return agent
