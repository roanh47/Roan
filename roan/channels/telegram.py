"""Telegram-kanaal: praat met dezelfde Roan-agent via een Telegram-bot.

Start met `Roan telegram`. De bot-token komt uit ~/.Roan/config.json
(`telegram_token`) of de env-var ROAN_TELEGRAM_TOKEN.
"""

from __future__ import annotations

import html
import json
import os
import time
import urllib.parse
import urllib.request

from ..config import ROAN_DIR, load_config, save_config
from ..i18n import LANGUAGES, set_language, t
from .base import Channel

API = "https://api.telegram.org/bot{token}/{method}"
MAX_LEN = 4000


# ---------- pure helpers (testbaar) ----------
def split_message(text: str, limit: int = MAX_LEN) -> list[str]:
    """Knip een lang bericht in stukken van max `limit` tekens."""
    text = text or "(leeg)"
    chunks: list[str] = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        if cut <= 0:
            cut = limit
        chunks.append(text[:cut])
        text = text[cut:].lstrip("\n")
    chunks.append(text)
    return chunks


def escape(text: str) -> str:
    return html.escape(text or "", quote=False)


def parse_update(update: dict) -> tuple[str, str, int] | None:
    """(chat_id, text, message_id) uit een Telegram-update, of None."""
    msg = update.get("message") or update.get("edited_message")
    if not msg or "chat" not in msg:
        return None
    text = msg.get("text")
    if not text:
        return None
    return str(msg["chat"]["id"]), text.strip(), msg["message_id"]


def handle_command(text: str, agent, reset_fn) -> str | None:
    """Verwerk een /commando. Geeft het antwoord, of None als het geen commando is."""
    if not text.startswith("/"):
        return None
    parts = text[1:].split()
    name = parts[0].lower().split("@")[0] if parts else ""
    args = parts[1:]

    if name in ("start", "help"):
        return t("tg_help")
    if name in ("new", "clear"):
        new = reset_fn()
        return t("msg_new_session", id=getattr(new, "session_id", "?"))
    if name == "language":
        if not args or args[0].lower() not in LANGUAGES:
            return t("msg_languages", langs=", ".join(LANGUAGES))
        code = set_language(args[0].lower())
        save_config({"language": code})
        return t("msg_language_set", lang=code)
    if name == "memory":
        from ..memory import load_memory

        mem = load_memory().strip()
        return mem or "(nog niets onthouden)"
    if name == "model":
        if not args:
            return f"Huidig model: {load_config()['model']}"
        cfg = save_config({"model": args[0]})
        agent.reload()
        return f"Model -> {cfg['model']}"
    if name == "provider":
        from ..config import PROVIDER_PRESETS

        if not args:
            return f"Huidige provider: {load_config()['provider']}"
        if args[0].lower() not in PROVIDER_PRESETS:
            return "Providers: " + ", ".join(sorted(PROVIDER_PRESETS))
        save_config({"provider": args[0].lower()})
        agent.reload()
        return f"Provider -> {args[0].lower()}"
    if name == "models":
        from ..models import list_models

        cfg = load_config()
        return list_models(cfg["base_url"], cfg["api_key"]).replace("`", "").replace("**", "")
    if name == "free":
        from ..models import list_free

        return list_free().replace("`", "").replace("**", "")
    if name == "status":
        cfg = load_config()
        return (
            f"provider: {cfg['provider']}\n"
            f"base_url: {cfg['base_url']}\n"
            f"model: {cfg['model']}\n"
            f"api_key: {'set' if cfg.get('api_key') else 'empty'}"
        )
    return t("msg_unknown_cmd", name=name)


# ---------- netwerk ----------
class TelegramAPI:
    def __init__(self, token: str):
        self.token = token

    def _call(self, method: str, payload: dict | None = None, timeout: int = 60):
        url = API.format(token=self.token, method=method)
        data = urllib.parse.urlencode(payload).encode() if payload else None
        req = urllib.request.Request(url, data=data)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())

    def get_updates(self, offset: int | None, timeout: int = 30) -> list[dict]:
        payload = {"timeout": timeout}
        if offset is not None:
            payload["offset"] = offset
        try:
            return self._call("getUpdates", payload, timeout=timeout + 10).get("result", [])
        except Exception:
            return []

    def send(self, chat_id: str, text: str) -> None:
        for chunk in split_message(text):
            try:
                self._call(
                    "sendMessage",
                    {"chat_id": chat_id, "text": chunk, "parse_mode": "HTML", "disable_web_page_preview": "true"},
                    timeout=30,
                )
            except Exception:
                # Fallback zonder opmaak
                try:
                    self._call("sendMessage", {"chat_id": chat_id, "text": chunk}, timeout=30)
                except Exception:
                    pass

    def typing(self, chat_id: str) -> None:
        try:
            self._call("sendChatAction", {"chat_id": chat_id, "action": "typing"}, timeout=10)
        except Exception:
            pass


# ---------- kanaal ----------
class TelegramChannel(Channel):
    name = "tg"

    def __init__(self, token: str):
        super().__init__()
        self.api = TelegramAPI(token)

    def handle_text(self, chat_id: str, text: str) -> str:
        agent = self.agent_for(chat_id)
        cmd = handle_command(text, agent, lambda: self.reset(chat_id))
        if cmd is not None:
            return cmd
        parts: list[str] = []
        for delta in agent.send_stream(text):
            parts.append(delta)
        return "".join(parts) or "(geen antwoord)"

    def run(self) -> None:
        print("Roan Telegram-kanaal actief. Ctrl-C om te stoppen.")
        offset = None
        while True:
            updates = self.api.get_updates(offset)
            for up in updates:
                offset = up["update_id"] + 1
                parsed = parse_update(up)
                if not parsed:
                    continue
                chat_id, text, _ = parsed
                self.api.typing(chat_id)
                try:
                    reply = self.handle_text(chat_id, text)
                except Exception as e:
                    reply = f"Fout: {e}"
                self.api.send(chat_id, reply)
            time.sleep(0.5)


def resolve_token() -> str | None:
    return os.environ.get("ROAN_TELEGRAM_TOKEN") or load_config().get("telegram_token")


def run_telegram() -> None:
    from ..i18n import init_from_config

    init_from_config()
    token = resolve_token()
    if not token:
        print(
            "Geen Telegram-token gevonden.\n"
            "Zet `telegram_token` in ~/.Roan/config.json of export ROAN_TELEGRAM_TOKEN."
        )
        return
    TelegramChannel(token).run()
