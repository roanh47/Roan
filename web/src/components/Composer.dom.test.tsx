// @vitest-environment jsdom

/**
 * The composer in a real (if small) DOM: the textarea it actually sizes, and
 * the caret that a new conversation puts in it. Both are effects, so the test
 * mounts the component and looks at the element — no source text, no guessed
 * class names.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMPOSER_CONTROL_SIZE, Composer } from "./Composer.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function tree(focusSignal = 0) {
  return (
    <Composer
      disabled={false}
      placeholder="Message Roan"
      onSend={() => undefined}
      focusSignal={focusSignal}
    />
  );
}

function textarea(): HTMLTextAreaElement {
  const element = container.querySelector("textarea");
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("the composer rendered no textarea");
  return element;
}

describe("the composer's field in the DOM", () => {
  it("is never shorter than the control row it shares with the send button", async () => {
    await act(async () => {
      root.render(tree());
    });
    // jsdom has no layout: scrollHeight is 0, which is exactly the first-paint
    // case the floor exists for.
    expect(textarea().style.height).toBe(`${String(COMPOSER_CONTROL_SIZE)}px`);
  });

  it("takes the focus when a new conversation opens, and only then", async () => {
    await act(async () => {
      root.render(tree(0));
    });
    expect(document.activeElement).not.toBe(textarea());

    await act(async () => {
      root.render(tree(1));
    });
    expect(document.activeElement).toBe(textarea());
    expect(textarea().getAttribute("id")).toBe("composer-input");
  });
});
