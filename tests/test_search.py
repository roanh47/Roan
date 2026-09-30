"""Tests voor zoeken in de provider- en modellenlijsten."""

import pytest

from roan import config
from roan import tui as tui_mod
from roan.tui import ModelsScreen, ProviderScreen, RoanApp

FREE = [
    ("cerebras", "Cerebras"),
    ("groq", "Groq"),
    ("mistral", "Mistral"),
    ("nvidia", "NVIDIA"),
]
PAID = [
    ("openai", "OpenAI"),
    ("anthropic", "Anthropic"),
    ("deepseek", "DeepSeek"),
    ("xai", "xAI"),
    ("mistral-paid", "Mistral"),
]


class FakeAgent:
    model = "m"
    session_id = "s"
    messages = []

    def reload(self):
        pass

    def clear(self):
        pass

    def send_stream(self, text, on_event=None):
        yield f"echo: {text}"


@pytest.fixture
def roan_cfg(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "USER_PATH", tmp_path / "user.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    config.save_config({"provider": "groq", "model": "m", "base_url": "http://localhost:1234/v1"})
    from roan import i18n

    i18n.set_language("nl")
    return tmp_path


def _labels(screen, list_id: str):
    from textual.widgets import OptionList

    listing = screen.query_one(f"#{list_id}", OptionList)
    return [str(listing.get_option_at_index(i).prompt) for i in range(listing.option_count)]


def _ids(screen, list_id: str):
    from textual.widgets import OptionList

    listing = screen.query_one(f"#{list_id}", OptionList)
    return [listing.get_option_at_index(i).id for i in range(listing.option_count)]


async def _open_providers(pilot, app, category="free"):
    """ProviderScreen openen met een bekende providerlijst (geen netwerk nodig)."""
    screen = ProviderScreen(category)
    app.push_screen(screen)
    await pilot.pause()
    screen.providers = {"free": FREE, "paid": PAID}
    screen._cache.clear()
    screen._rebuild()
    await pilot.pause()
    return screen


# ---------- providers ----------
@pytest.mark.asyncio
async def test_all_providers_without_a_query(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = await _open_providers(pilot, app)
        assert len(_labels(screen, "provider-list")) == len(FREE)


@pytest.mark.asyncio
async def test_search_filters_live(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = await _open_providers(pilot, app)
        screen.query_one("#psearch").value = "gro"
        await pilot.pause()
        assert _ids(screen, "provider-list") == ["groq"]


@pytest.mark.asyncio
async def test_search_is_case_insensitive_and_matches_id(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = await _open_providers(pilot, app)
        screen.query_one("#psearch").value = "NVI"  # 'nvidia' zit alleen in de id
        await pilot.pause()
        assert _ids(screen, "provider-list") == ["nvidia"]


@pytest.mark.asyncio
async def test_search_without_results(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = await _open_providers(pilot, app)
        screen.query_one("#psearch").value = "zzz"
        await pilot.pause()
        assert _ids(screen, "provider-list") == [None]
        assert "Geen resultaten" in _labels(screen, "provider-list")[0]


@pytest.mark.asyncio
async def test_search_stays_inside_the_category(roan_cfg):
    """Op de gratis-tab vind je geen betaalde provider, op de betaald-tab wel."""
    from textual.widgets import Select

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = await _open_providers(pilot, app)
        screen.query_one("#psearch").value = "openai"
        await pilot.pause()
        assert _ids(screen, "provider-list") == [None]

        screen.query_one("#pcat", Select).value = "paid"
        await pilot.pause()
        assert "openai" in _ids(screen, "provider-list")


@pytest.mark.asyncio
async def test_enter_in_search_picks_the_top_hit(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = ProviderScreen("free")
        app.push_screen(screen, results.append)
        await pilot.pause()
        screen.providers = {"free": FREE, "paid": PAID}
        screen._cache.clear()
        screen._rebuild()
        await pilot.pause()

        search = screen.query_one("#psearch")
        search.value = "mistral"
        await pilot.pause()
        search.focus()
        await pilot.press("enter")
        await pilot.pause()
    assert results and results[0]["provider"] == "mistral"


@pytest.mark.asyncio
async def test_escape_clears_search_before_closing(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = ProviderScreen("free")
        app.push_screen(screen, results.append)
        await pilot.pause()
        screen.providers = {"free": FREE, "paid": PAID}
        screen._cache.clear()
        screen._rebuild()
        await pilot.pause()

        search = screen.query_one("#psearch")
        search.focus()
        search.value = "gro"
        await pilot.pause()
        await pilot.press("escape")
        await pilot.pause()
        assert search.value == ""  # alleen gewist, scherm nog open
        assert results == []

        await pilot.press("escape")
        await pilot.pause()
    assert results == [None]  # nu pas dicht


# ---------- modellen ----------
@pytest.mark.asyncio
async def test_models_search(roan_cfg):
    app = RoanApp(FakeAgent())
    free = [("groq", "llama-3.1-8b"), ("groq", "mixtral-8x7b"), ("cerebras", "qwen3-coder")]
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(free, [], [])
        app.push_screen(screen)
        await pilot.pause()
        assert len(_labels(screen, "models-list")) == 3

        screen.query_one("#msearch").value = "mixtral"
        await pilot.pause()
        assert len(_labels(screen, "models-list")) == 1
        assert "mixtral-8x7b" in _labels(screen, "models-list")[0]


@pytest.mark.asyncio
async def test_models_search_matches_provider(roan_cfg):
    app = RoanApp(FakeAgent())
    free = [("groq", "llama-3.1-8b"), ("cerebras", "qwen3-coder")]
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(free, [], [])
        app.push_screen(screen)
        await pilot.pause()
        screen.query_one("#msearch").value = "cerebras"
        await pilot.pause()
        assert _labels(screen, "models-list")[0].startswith("qwen3-coder")


@pytest.mark.asyncio
async def test_models_enter_picks_top_hit(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    free = [("groq", "llama-3.1-8b"), ("groq", "mixtral-8x7b")]
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(free, [], [])
        app.push_screen(screen, results.append)
        await pilot.pause()
        search = screen.query_one("#msearch")
        search.value = "mixtral"
        await pilot.pause()
        search.focus()
        await pilot.press("enter")
        await pilot.pause()
    assert results == [("groq", "mixtral-8x7b")]


@pytest.mark.asyncio
async def test_models_search_without_results(roan_cfg):
    app = RoanApp(FakeAgent())
    free = [("groq", "llama-3.1-8b")]
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(free, [], [])
        app.push_screen(screen)
        await pilot.pause()
        screen.query_one("#msearch").value = "zzz"
        await pilot.pause()
        assert _ids(screen, "models-list") == [None]
        assert "Geen resultaten" in _labels(screen, "models-list")[0]


# ---------- custom endpoints mogen niet gecacht blijven ----------
@pytest.mark.asyncio
async def test_new_custom_endpoint_appears_immediately(roan_cfg):
    """Een net toegevoegd endpoint moet direct in de lijst staan."""
    from textual.widgets import Select

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = await _open_providers(pilot, app)
        screen.query_one("#pcat", Select).value = "custom"
        await pilot.pause()
        assert _ids(screen, "provider-list") == [None]  # nog niks

        screen.query_one("#pname").value = "thuis"
        screen.query_one("#pbase").value = "https://thuis.example/v1"
        screen._add_endpoint()
        await pilot.pause()
        assert _ids(screen, "provider-list") == ["thuis"]
        assert "thuis" in _labels(screen, "provider-list")[0]


@pytest.mark.asyncio
async def test_deleted_custom_endpoint_disappears(roan_cfg):
    from textual.widgets import Select

    config.add_endpoint("weg", "https://weg.example/v1", "k")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = await _open_providers(pilot, app)
        screen.query_one("#pcat", Select).value = "custom"
        await pilot.pause()
        assert _ids(screen, "provider-list") == ["weg"]

        screen._chosen = "weg"
        screen._delete_endpoint()
        await pilot.pause()
        assert _ids(screen, "provider-list") == [None]


@pytest.mark.asyncio
async def test_switching_category_keeps_the_query(roan_cfg):
    """Zoekopdracht blijft staan als je van categorie wisselt."""
    from textual.widgets import Select

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = await _open_providers(pilot, app)
        screen.query_one("#psearch").value = "mi"
        await pilot.pause()
        assert "mistral" in _ids(screen, "provider-list")

        screen.query_one("#pcat", Select).value = "paid"
        await pilot.pause()
        assert "mistral-paid" in _ids(screen, "provider-list")
