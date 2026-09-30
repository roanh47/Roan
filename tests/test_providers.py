"""Tests voor de provider-picker met 4 categorieën en eigen endpoints."""

import pytest

from roan import config
from roan import tui as tui_mod
from roan.tui import ProviderScreen, RoanApp


class FakeAgent:
    model = "fake"
    session_id = "test-session"
    messages = []

    def reload(self):
        pass

    def clear(self):
        pass

    def save(self):
        pass

    def send_stream(self, text, on_event=None):
        yield f"echo: {text}"


@pytest.fixture
def roan_cfg(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "USER_PATH", tmp_path / "user.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    monkeypatch.setattr(config, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(config, "CRON_DIR", tmp_path / "cron")
    monkeypatch.setattr(config, "PLUGINS_DIR", tmp_path / "plugins")
    monkeypatch.setattr(config, "LOGS_DIR", tmp_path / "logs")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "PLANS_DIR", tmp_path / "plans")
    config.save_config({"provider": "lmstudio", "model": "m", "tui": "default"})
    from roan import i18n

    i18n.set_language("nl")
    # geen netwerk in tests
    monkeypatch.setattr(
        tui_mod,
        "list_providers",
        lambda cat="all": [("groq", "Groq"), ("openai", "OpenAI")]
        if cat in ("all", "free", "paid")
        else [],
    )
    monkeypatch.setattr(tui_mod, "provider_meta", lambda pid: {"plan": False, "name": pid})
    return tmp_path


# ---------- config: endpoints ----------
def test_add_and_get_endpoints(roan_cfg):
    config.add_endpoint("thuis", "http://192.168.1.9:1234/v1", "lm-studio")
    config.add_endpoint("vps", "https://api.example.com/v1", "sk-1")
    names = [e["name"] for e in config.get_endpoints()]
    assert names == ["thuis", "vps"]
    assert config.get_endpoint("vps")["api_key"] == "sk-1"


def test_add_endpoint_replaces_same_name(roan_cfg):
    config.add_endpoint("thuis", "http://a/v1")
    config.add_endpoint("thuis", "http://b/v1")
    endpoints = config.get_endpoints()
    assert len(endpoints) == 1
    assert endpoints[0]["base_url"] == "http://b/v1"


def test_remove_endpoint(roan_cfg):
    config.add_endpoint("thuis", "http://a/v1")
    assert config.remove_endpoint("thuis") is True
    assert config.get_endpoints() == []
    assert config.remove_endpoint("bestaat-niet") is False


# ---------- ProviderScreen ----------
@pytest.mark.asyncio
async def test_four_categories_in_order(roan_cfg):
    from textual.widgets import Select

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        app.push_screen(ProviderScreen())
        await pilot.pause()
        screen = app.screen
        select = screen.query_one("#pcat", Select)
        values = [value for _label, value in select._options]
        assert values == ["free", "paid", "local", "custom"]


@pytest.mark.asyncio
async def test_local_category_lists_localhost(roan_cfg):
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="local")
        app.push_screen(screen)
        await pilot.pause()
        listing = screen.query_one("#provider-list", OptionList)
        assert listing.option_count == 9
        labels = [str(listing.get_option_at_index(i).prompt) for i in range(listing.option_count)]
        assert any("localhost:1234" in lb for lb in labels)
        assert any("localhost:11434" in lb for lb in labels)


@pytest.mark.asyncio
async def test_local_choice_returns_base_url(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="local")
        app.push_screen(screen, results.append)
        await pilot.pause()
        screen._chosen = "ollama"
        screen._choose()
        await pilot.pause()
        assert results[0]["provider"] == "ollama"
        assert results[0]["base_url"] == "http://localhost:11434/v1"


@pytest.mark.asyncio
async def test_local_base_url_is_editable(roan_cfg):
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="local")
        app.push_screen(screen, results.append)
        await pilot.pause()
        listing = screen.query_one("#provider-list", OptionList)
        screen.on_option_list_option_selected(
            OptionList.OptionSelected(listing, listing.get_option_at_index(0), 0)
        )
        await pilot.pause()
        # poort aanpassen
        screen.query_one("#pbase").value = "http://localhost:9999/v1"
        screen._choose()
        await pilot.pause()
        assert results[0]["base_url"] == "http://localhost:9999/v1"


@pytest.mark.asyncio
async def test_custom_add_and_choose_endpoint(roan_cfg):
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="custom")
        app.push_screen(screen, results.append)
        await pilot.pause()

        assert screen.query_one("#provider-list", OptionList).option_count == 1  # hint

        screen.query_one("#pname").value = "thuis"
        screen.query_one("#pbase").value = "http://192.168.1.9:1234/v1"
        screen.query_one("#pkey").value = "lm-studio"
        screen._add_endpoint()
        await pilot.pause()

        listing = screen.query_one("#provider-list", OptionList)
        assert listing.option_count == 1
        assert config.get_endpoint("thuis")["base_url"] == "http://192.168.1.9:1234/v1"

        screen._chosen = "thuis"
        screen._choose()
        await pilot.pause()
        assert results[0]["provider"] == "custom"
        assert results[0]["api_key"] == "lm-studio"


@pytest.mark.asyncio
async def test_custom_add_requires_name_and_url(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="custom")
        app.push_screen(screen)
        await pilot.pause()
        screen.query_one("#pname").value = "alleen-naam"
        screen._add_endpoint()
        await pilot.pause()
        assert config.get_endpoints() == []


@pytest.mark.asyncio
async def test_custom_delete_endpoint(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="custom")
        app.push_screen(screen)
        await pilot.pause()
        config.add_endpoint("weg", "http://x/v1")
        screen._rebuild()
        screen._chosen = "weg"
        screen._delete_endpoint()
        await pilot.pause()
        assert config.get_endpoints() == []


@pytest.mark.asyncio
async def test_hosted_category_hides_custom_inputs(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="free")
        app.push_screen(screen)
        await pilot.pause()
        assert screen.query_one("#pname").display is False
        assert screen.query_one("#pkey").display is False
        assert screen.query_one("#pbase").display is False
        assert screen.query_one("#padd").display is False


@pytest.mark.asyncio
async def test_custom_category_shows_inputs(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="custom")
        app.push_screen(screen)
        await pilot.pause()
        assert screen.query_one("#pname").display is True
        assert screen.query_one("#pbase").display is True
        assert screen.query_one("#padd").display is True


@pytest.mark.asyncio
async def test_switching_category_clears_selection(roan_cfg):
    from textual.widgets import Select

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="local")
        app.push_screen(screen)
        await pilot.pause()
        screen._chosen = "ollama"
        screen.query_one("#pcat", Select).value = "custom"
        await pilot.pause()
        assert screen._chosen == ""


# ---------- doorwerking naar config ----------
@pytest.mark.asyncio
async def test_app_picker_saves_local_provider(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        app._open_provider_picker()
        await pilot.pause()
        screen = app.screen
        assert isinstance(screen, ProviderScreen)
        screen.query_one("#pcat").value = "local"
        await pilot.pause()
        screen._chosen = "ollama"
        screen._choose()
        await pilot.pause()
        cfg = config.load_config()
        assert cfg["provider"] == "ollama"
        assert cfg["base_url"] == "http://localhost:11434/v1"


# ---------- Enter in een veld ----------
@pytest.mark.asyncio
async def test_enter_in_api_key_saves(roan_cfg):
    """Enter in het api-key-veld moet opslaan, niet alleen de knop."""
    from roan.tui import SetupScreen

    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        screen = SetupScreen(provider="groq", model="llama-3")
        app.push_screen(screen, results.append)
        await pilot.pause()
        screen.query_one("#api_key").focus()
        screen.query_one("#api_key").value = "sk-test-123"
        await pilot.press("enter")
        await pilot.pause()
    assert results == [True]
    assert config.load_config()["api_key"] == "sk-test-123"


@pytest.mark.asyncio
async def test_enter_in_base_url_saves(roan_cfg):
    from roan.tui import SetupScreen

    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        screen = SetupScreen(provider="custom", model="m")
        app.push_screen(screen, results.append)
        await pilot.pause()
        screen.query_one("#base_url").focus()
        screen.query_one("#base_url").value = "http://192.168.1.9:8000/v1"
        await pilot.press("enter")
        await pilot.pause()
    assert results == [True]
    assert config.load_config()["base_url"] == "http://192.168.1.9:8000/v1"


@pytest.mark.asyncio
async def test_enter_in_local_picks_provider(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="local")
        app.push_screen(screen, results.append)
        await pilot.pause()
        screen._chosen = "lmstudio"
        screen.query_one("#pbase").focus()
        await pilot.press("enter")
        await pilot.pause()
    assert results[0]["provider"] == "lmstudio"


@pytest.mark.asyncio
async def test_enter_in_custom_adds_endpoint(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="custom")
        app.push_screen(screen)
        await pilot.pause()
        screen.query_one("#pname").value = "thuis"
        screen.query_one("#pbase").value = "http://192.168.1.9:1234/v1"
        screen.query_one("#pbase").focus()
        await pilot.press("enter")
        await pilot.pause()
    assert config.get_endpoint("thuis")["base_url"] == "http://192.168.1.9:1234/v1"


# ---------- beschrijving i.p.v. de id ----------
@pytest.mark.asyncio
async def test_provider_list_shows_description(roan_cfg, monkeypatch):
    from textual.widgets import OptionList

    monkeypatch.setattr(tui_mod, "provider_desc", lambda pid: f"beschrijving van {pid}")
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        screen = ProviderScreen(category="free")
        app.push_screen(screen)
        await pilot.pause()
        listing = screen.query_one("#provider-list", OptionList)
        labels = [str(listing.get_option_at_index(i).prompt) for i in range(listing.option_count)]
        assert labels[0] == "Groq  ·  beschrijving van groq"
        assert not any("· groq" in lb for lb in labels)


@pytest.mark.asyncio
async def test_description_falls_back_to_model_count(roan_cfg, monkeypatch):
    monkeypatch.setattr(tui_mod, "provider_desc", lambda pid: "")
    monkeypatch.setattr(
        tui_mod, "provider_meta", lambda pid: {"plan": False, "name": pid, "models": ["a", "b", "c"]}
    )
    assert tui_mod.provider_description("onbekend") == "3 modellen"


@pytest.mark.asyncio
async def test_description_marks_subscription(roan_cfg, monkeypatch):
    monkeypatch.setattr(tui_mod, "provider_desc", lambda pid: "")
    monkeypatch.setattr(
        tui_mod, "provider_meta", lambda pid: {"plan": True, "name": pid, "models": ["a", "b"]}
    )
    assert tui_mod.provider_description("alibaba-coding-plan") == "abonnement · 2 modellen"
