import { describe, expect, it } from "vitest";
import { ACTION_IDS, ACTIONS } from "../../src/data/controls";
import { actionFor, bindingLabel, defaultBindings, keyLabel, parseBindings, rebind, unbind } from "../../src/game/bindings";

describe("key bindings", () => {
  it("defaults bind every action, and no key twice", () => {
    const b = defaultBindings();
    const all = ACTION_IDS.flatMap((id) => b[id]);
    expect(new Set(all).size).toBe(all.length);
    for (const id of ACTION_IDS) expect(b[id].length).toBeGreaterThan(0);
  });

  it("rebinding to a key in use swaps it with the other action", () => {
    const b = rebind(defaultBindings(), "jump", 0, "KeyQ");
    expect(b.jump).toEqual(["KeyQ"]);
    expect(b.boost).toEqual(["Space"]);
    expect(actionFor(b, "KeyQ")).toBe("jump");
  });

  it("a second key adds to an action and takes it from the other", () => {
    const b = rebind(defaultBindings(), "melee", 1, "KeyV");
    expect(b.melee).toEqual(["KeyF", "KeyV"]);
    expect(b.view).toEqual([]);
    expect(bindingLabel(b, "view")).toBe("Unbound");
  });

  it("refuses reserved keys and leaves the original untouched", () => {
    const before = defaultBindings();
    expect(rebind(before, "jump", 0, "Escape")).toBe(before);
    rebind(before, "jump", 0, "KeyZ");
    expect(before.jump).toEqual(["Space"]);
  });

  it("unbinds one key of an action", () => {
    expect(unbind(defaultBindings(), "sprint", 1).sprint).toEqual(["ShiftLeft"]);
  });

  it("parses saved bindings leniently", () => {
    expect(parseBindings(undefined)).toEqual(defaultBindings());
    const b = parseBindings({ jump: ["KeyF", 7, "Escape"], nonsense: ["KeyX"] });
    expect(b.jump).toEqual(["KeyF"]);
    // Melee still defaults to F, but the player gave F to jump: theirs wins.
    expect(b.melee).toEqual([]);
    expect(b.view).toEqual([...ACTIONS.view.keys]);
  });

  it("labels keys and mouse buttons readably", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("ShiftLeft")).toBe("Left Shift");
    expect(keyLabel("Mouse2")).toBe("Right mouse");
    expect(keyLabel("Digit4")).toBe("4");
    expect(keyLabel("Space")).toBe("Space");
  });
});
