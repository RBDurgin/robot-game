import type { FrameDef } from "../data/frames";
import type { Loadout } from "../data/loadouts";
import { PLATING, type PlatingId } from "../data/parts";
import { WEAPONS, type WeaponId } from "../data/weapons";
import type { Settings } from "../game/save";
import { isWeaponId, itemName, loadoutProblems, loadoutStats, type Inventory, type ItemId } from "../sim/loadout";

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", children: Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

function button(label: string, onClick: () => void, className = "primary"): HTMLButtonElement {
  const b = el("button", className, [label]);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

const CONTROLS: [string, string][] = [
  ["W A S D", "Move"],
  ["Mouse", "Aim"],
  ["Shift", "Sprint"],
  ["Space", "Jump, hold for jump jets"],
  ["Q", "Boost dash"],
  ["Left / Right mouse", "Fire right / left arm weapon"],
  ["F", "Melee strike"],
  ["V", "Switch third-person / cockpit view"],
  ["H", "Hangar (at base)"],
  ["Esc", "Pause"],
];

export interface PauseOptions {
  /** True for the first screen shown on load. */
  isStart: boolean;
  settings: Settings;
  onSettings(settings: Settings): void;
  onResume(): void;
  onReset(): void;
}

export interface HangarOptions {
  frame: FrameDef;
  loadout: Loadout;
  inventory: Inventory;
  scrap: number;
  onDeploy(loadout: Loadout): void;
}

export interface MissionSummary {
  seconds: number;
  kills: number;
  deaths: number;
  scrap: number;
  items: number;
}

/** Full-screen menus, built as plain HTML over the game canvas. */
export class Screens {
  constructor(private readonly root: HTMLElement) {}

  get open(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  private show(panel: HTMLElement): void {
    this.root.replaceChildren(panel);
    this.root.hidden = false;
    panel.querySelector<HTMLButtonElement>("button.primary")?.focus({ preventScroll: true });
    panel.scrollTop = 0;
  }

  showPause(opts: PauseOptions): void {
    const settings = { ...opts.settings };
    const range = (label: string, min: number, max: number, step: number, value: number, apply: (v: number) => void): HTMLElement => {
      const input = el("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.addEventListener("input", () => {
        apply(Number(input.value));
        opts.onSettings({ ...settings });
      });
      return el("label", "row", [el("span", "", [label]), input]);
    };
    const view = el("select");
    for (const [value, label] of [
      ["third", "Third person"],
      ["cockpit", "Cockpit"],
    ] as const) {
      const o = el("option", "", [label]);
      o.value = value;
      o.selected = settings.defaultView === value;
      view.append(o);
    }
    view.addEventListener("change", () => {
      settings.defaultView = view.value === "cockpit" ? "cockpit" : "third";
      opts.onSettings({ ...settings });
    });

    const controls = el("dl", "controls");
    for (const [key, action] of CONTROLS) controls.append(el("dt", "", [key]), el("dd", "", [action]));

    const panel = el("div", "panel", [
      el("h1", "", [opts.isStart ? "Ashfall Basin" : "Paused"]),
      ...(opts.isStart
        ? [
            el("p", "", [
              "The Kestrel Combine has fortified an outpost to the north-east. Clear out its garrison, salvage what they leave behind, and return to base.",
            ]),
          ]
        : []),
      el("h2", "", ["Controls"]),
      controls,
      el("h2", "", ["Settings"]),
      range("Mouse sensitivity", 0.0006, 0.005, 0.0002, settings.sensitivity, (v) => (settings.sensitivity = v)),
      range("Volume", 0, 1, 0.05, settings.volume, (v) => (settings.volume = v)),
      el("label", "row", [el("span", "", ["Starting view"]), view]),
      el("div", "actions", [
        button(opts.isStart ? "Deploy" : "Resume", opts.onResume),
        button("Reset saved progress", opts.onReset, "secondary"),
      ]),
    ]);
    this.show(panel);
  }

  showHangar(opts: HangarOptions): void {
    const loadout: Loadout = { ...opts.loadout };
    const stats = el("div", "stats");
    const problems = el("ul", "problems");
    const deploy = button("Repair and deploy", () => opts.onDeploy({ ...loadout }));

    const owned = (Object.entries(opts.inventory) as [ItemId, number][]).filter(([, n]) => n > 0);
    const weaponsOwned = owned.filter(([id]) => isWeaponId(id)).map(([id]) => id as WeaponId);
    const platingOwned = owned.filter(([id]) => !isWeaponId(id)).map(([id]) => id as PlatingId);

    const refresh = (): void => {
      const s = loadoutStats(opts.frame, loadout);
      const weaponLine = (side: string, id: WeaponId | null): string => {
        if (!id) return `${side}: empty`;
        const w = WEAPONS[id];
        return `${side}: ${w.name} · ${w.damage} dmg · ${(1 / w.cooldown).toFixed(1)}/s · ${w.heat} heat · ${w.mass} t`;
      };
      stats.replaceChildren(
        el("div", s.overweight ? "bad" : "", [`Load ${s.mass.toFixed(1)} / ${s.capacity} t`]),
        el("div", "", [`Speed ${Math.round(s.mobility * 100)}%`]),
        el("div", "", [`Armor ${Math.round(s.armorScale * 100)}%`]),
        el("div", "dim", [weaponLine("Right arm", loadout.armR)]),
        el("div", "dim", [weaponLine("Left arm", loadout.armL)]),
        el("div", "dim", [`Plating: ${PLATING[loadout.plating].description}`]),
      );
      const issues = loadoutProblems(opts.frame, loadout, opts.inventory);
      problems.replaceChildren(...issues.map((p) => el("li", "", [p])));
      deploy.disabled = issues.length > 0;
    };

    const slot = <T extends string>(label: string, options: T[], current: T | null, allowEmpty: boolean, set: (v: T | null) => void): HTMLElement => {
      const select = el("select");
      if (allowEmpty) {
        const o = el("option", "", ["Empty"]);
        o.value = "";
        o.selected = current === null;
        select.append(o);
      }
      for (const id of options) {
        const o = el("option", "", [`${itemName(id as ItemId)} (x${opts.inventory[id as ItemId] ?? 0})`]);
        o.value = id;
        o.selected = id === current;
        select.append(o);
      }
      select.addEventListener("change", () => {
        set(select.value === "" ? null : (select.value as T));
        refresh();
      });
      return el("label", "row", [el("span", "", [label]), select]);
    };

    const inventory = el("ul", "inventory", owned.map(([id, n]) => el("li", "", [`${itemName(id)} x${n}`])));

    const panel = el("div", "panel", [
      el("h1", "", [`Hangar · ${opts.frame.name} frame`]),
      slot("Right arm", weaponsOwned, loadout.armR, true, (v) => (loadout.armR = v)),
      slot("Left arm", weaponsOwned, loadout.armL, true, (v) => (loadout.armL = v)),
      slot("Plating", platingOwned, loadout.plating, false, (v) => (loadout.plating = v ?? loadout.plating)),
      stats,
      problems,
      el("h2", "", [`Salvage store · ${opts.scrap} scrap`]),
      inventory,
      el("div", "actions", [deploy]),
    ]);
    refresh();
    this.show(panel);
  }

  showComplete(summary: MissionSummary, onReplay: () => void, onContinue: () => void): void {
    const mins = Math.floor(summary.seconds / 60);
    const secs = Math.floor(summary.seconds % 60);
    const rows: [string, string][] = [
      ["Time", `${mins}:${String(secs).padStart(2, "0")}`],
      ["Hostiles destroyed", String(summary.kills)],
      ["Suits lost", String(summary.deaths)],
      ["Parts salvaged", String(summary.items)],
      ["Scrap", String(summary.scrap)],
    ];
    const list = el("dl", "controls");
    for (const [k, v] of rows) list.append(el("dt", "", [k]), el("dd", "", [v]));
    this.show(
      el("div", "panel", [
        el("h1", "", ["Outpost cleared"]),
        el("p", "", ["The Combine garrison is destroyed and you made it home."]),
        list,
        el("div", "actions", [button("Play again", onReplay), button("Keep exploring", onContinue, "secondary")]),
      ]),
    );
  }
}
