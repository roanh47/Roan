---
type: Howto
title: Add a popup
description: A modal screen that matches the rest, without copying any CSS.
tags: [roan, howto, tui, modal]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: tui
    resource: ../../roan/tui.py
    title: ../../roan/tui.py
  - id: look-tests
    resource: ../../tests/test_tui_look.py
    title: ../../tests/test_tui_look.py
---

# The minimum

    class MyScreen(ModalScreen):
        """One line saying what it is for."""

        CSS = POPUP_CSS + """
        #my-box { width: 70%; max-width: 60; }
        """

        def compose(self) -> ComposeResult:
            with Vertical(id="my-box", classes="popup"):
                yield from _titlebar(t("my_title"))
                yield Label(t("my_label"), classes="section")
                yield Input(id="my-input")
                yield Static(t("my_hint"), classes="hint")
                with Horizontal(classes="actions"):
                    yield Button(t("btn_back"), id="my-back")
                    yield Button(t("btn_choose"), id="my-choose", variant="primary")

        @on(Button.Pressed)
        def _on_button(self, event: Button.Pressed) -> None:
            bid = event.button.id
            if bid in ("close", "my-back"):
                self.dismiss(None)
                return
            if bid == "my-choose":
                self.dismiss("chosen")

# Rules

1. **`classes="popup"` on the outer `Vertical`.** Without it none of the shared
   style applies.
2. **Never write your own box CSS.** Width and height only.
3. **`_titlebar()` gives you the title and the close button**, positioned right,
   with the title aligned to the field labels.
4. **One frame per popup.** No borders on anything inside it.
5. **Rows state their height.** `classes="hint"` and `classes="actions"` are
   already one row; a `Horizontal` you add yourself must set `height: 1`.
6. **Text uses `t()`**, in both languages.
7. **Bind escape** if you have a search field, and make the first press clear the
   search instead of closing.
8. **Focus something on mount** - an `Input` or the list - so typing works
   immediately.

# Tests to add

Append the screen to the `POPUPS` list in `tests/test_tui_look.py`: it then gets
the shared-class check, the "sits on a lighter surface than the screen" check and
the close-button check for free. Add a fit test at 46x18 if it is a form.
