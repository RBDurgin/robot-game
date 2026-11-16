import { FRAME_IDS, FRAMES, type FrameDef, type FrameId, type Trigger } from "../data/frames";
import type { Loadout } from "../data/loadouts";
import { PLATING, type PlatingId } from "../data/parts";
import { WEAPONS, type WeaponId } from "../data/weapons";
import type { Settings } from "../game/save";
import type { WorldModel } from "../sim/terrain";
import { drawMap, type MapSite } from "./mapView";
import { fitsMount, fitToFrame, isWeaponId, itemName, loadoutProblems, loadoutStats, type Inventory, type ItemId } from "../sim/loadout";

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
  ["E / Middle mouse", "Fire shoulder weapons (heavy frame)"],
  ["F", "Melee strike"],
  ["V", "Switch third-person / cockpit view"],
  ["H", "Hangar (at a base you hold)"],
  ["M", "World map and fast travel"],
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
  /** The frame the suit is built on now. */
  frame: FrameId;
  loadout: Loadout;
  inventory: Inventory;
  scrap: number;
  onDeploy(frame: FrameId, loadout: Loadout): void;
}

export interface MapOptions {
  model: WorldModel;
  player: { x: number; z: number; yaw: number };
  /** Name of the region the player is in. */
  region: string;
  /** The places the player knows about. */
  sites: MapSite[];
  /** Number of places in the world, found or not. */
  total: number;
  /** Why fast travel is unavailable right now, or null if it is available. */
  travelBlocked: string | null;
  onTravel(siteId: string): void;
  onClose(): void;
}

const FIRE_KEYS: Record<Trigger, string> = { primary: "LMB", secondary: "RMB", tertiary: "E" };

/** One line of numbers for a weapon, in the units that suit its kind. */
function weaponLine(id: WeaponId | null): string {
  if (!id) return "empty";
  const w = WEAPONS[id];
  if (w.kind === "beam") return `${w.name} · ${w.damage} dmg/s · ${w.heat} heat/s · ${w.range} m · ${w.mass} t`;
  const damage = "pellets" in w ? `${w.pellets} x ${w.damage}` : String(w.damage);
  return `${w.name} · ${damage} dmg · ${(1 / w.cooldown).toFixed(1)}/s · ${w.heat} heat · ${w.range} m · ${w.mass} t`;
}

/** The three frames side by side, with the chosen one picked out. */
function frameTable(selected: FrameId): HTMLElement {
  const frames = FRAME_IDS.map((id) => FRAMES[id] as FrameDef);
  const armor = (f: FrameDef): number => Object.values(f.sections).reduce((sum, s) => sum + s.armor + s.structure, 0);
  const rows: [string, (f: FrameDef) => string][] = [
    ["Role", (f) => f.role.split(".")[0]!],
    ["Speed", (f) => `${f.walkSpeed} / ${f.sprintSpeed} m/s`],
    ["Armor", (f) => String(armor(f))],
    ["Capacity", (f) => `${f.loadCapacity} t`],
    ["Heat", (f) => `${f.heatCapacity} (-${f.heatDissipation}/s)`],
    ["Dash", (f) => `${f.boostCharges ?? 1} x ${Math.round(f.boostSpeed * f.boostDuration)} m`],
    ["Mounts", (f) => (f.hardpoints.some((h) => h.mount === "shoulder") ? "2 arms, 2 shoulders" : "2 arms")],
    ["Ability", (f) => (f.brace ? `Brace: -${Math.round((1 - f.brace.damageTaken) * 100)}% damage` : (f.boostCharges ?? 1) > 1 ? "Double dash" : "None")],
  ];
  const cell = (tag: "th" | "td", text: string, f?: FrameDef): HTMLElement => el(tag, f?.id === selected ? "selected" : "", [text]);
  const table = el("table", "frames", [
    el("thead", "", [el("tr", "", [el("th"), ...frames.map((f) => cell("th", f.name, f))])]),
    el("tbody", "", rows.map(([label, value]) => el("tr", "", [cell("th", label), ...frames.map((f) => cell("td", value(f), f))]))),
  ]);
  return table;
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
              "The Kestrel Combine has fortified an outpost to the north-east. Clear out its garrison, salvage what they leave behind, and return to base. Beyond the basin lie the Marches: salt flats, highlands and ruined cities, with bases to take and places to find.",
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
    let frameId = opts.frame;
    let loadout: Loadout = fitToFrame(FRAMES[frameId], opts.loadout);

    const owned = (Object.entries(opts.inventory) as [ItemId, number][]).filter(([, n]) => n > 0);
    const weaponsOwned = owned.filter(([id]) => isWeaponId(id)).map(([id]) => id as WeaponId);
    const platingOwned = owned.filter(([id]) => !isWeaponId(id)).map(([id]) => id as PlatingId);

    const select = <T extends string>(label: string, options: [T, string][], current: T | null, allowEmpty: boolean, set: (v: T | null) => void): HTMLElement => {
      const input = el("select");
      if (allowEmpty) {
        const o = el("option", "", ["Empty"]);
        o.value = "";
        o.selected = current === null;
        input.append(o);
      }
      for (const [id, text] of options) {
        const o = el("option", "", [text]);
        o.value = id;
        o.selected = id === current;
        input.append(o);
      }
      input.addEventListener("change", () => set(input.value === "" ? null : (input.value as T)));
      return el("label", "row", [el("span", "", [label]), input]);
    };
    const itemOption = <T extends ItemId>(id: T): [T, string] => [id, `${itemName(id)} (x${opts.inventory[id] ?? 0})`];

    // The panel is rebuilt when the frame changes, because the frame decides which mounts exist.
    const render = (focusFrame: boolean): void => {
      const frame: FrameDef = FRAMES[frameId];
      const stats = el("div", "stats");
      const problems = el("ul", "problems");
      const deploy = button("Repair and deploy", () => opts.onDeploy(frameId, { weapons: { ...loadout.weapons }, plating: loadout.plating }));

      const refresh = (): void => {
        const s = loadoutStats(frame, loadout);
        stats.replaceChildren(
          el("div", s.overweight ? "bad" : "", [`Load ${s.mass.toFixed(1)} / ${s.capacity} t`]),
          el("div", "", [`Speed ${Math.round(s.mobility * 100)}%`]),
          el("div", "", [`Armor ${Math.round(s.armorScale * 100)}%`]),
          ...frame.hardpoints.map((h) => el("div", "dim", [`${h.name}: ${weaponLine(loadout.weapons[h.id] ?? null)}`])),
          el("div", "dim", [`Plating: ${PLATING[loadout.plating].description}`]),
        );
        const issues = loadoutProblems(frame, loadout, opts.inventory);
        problems.replaceChildren(...issues.map((p) => el("li", "", [p])));
        deploy.disabled = issues.length > 0;
      };

      const frameSelect = select(
        "Frame",
        FRAME_IDS.map((id): [FrameId, string] => [id, `${FRAMES[id].name} (${FRAMES[id].weightClass})`]),
        frameId,
        false,
        (v) => {
          if (!v) return;
          frameId = v;
          loadout = fitToFrame(FRAMES[frameId], loadout);
          render(true);
        },
      );

      const slots = frame.hardpoints.map((h) =>
        select(
          `${h.name} · ${FIRE_KEYS[h.trigger]}`,
          weaponsOwned.filter((id) => fitsMount(WEAPONS[id], h.mount)).map(itemOption),
          loadout.weapons[h.id] ?? null,
          true,
          (v) => {
            if (v) loadout.weapons[h.id] = v;
            else delete loadout.weapons[h.id];
            refresh();
          },
        ),
      );

      const panel = el("div", "panel wide", [
        el("h1", "", [`Hangar · ${frame.name} frame`]),
        frameSelect,
        frameTable(frameId),
        el("h2", "", ["Loadout"]),
        ...slots,
        select("Plating", platingOwned.map(itemOption), loadout.plating, false, (v) => {
          loadout.plating = v ?? loadout.plating;
          refresh();
        }),
        stats,
        problems,
        el("h2", "", [`Salvage store · ${opts.scrap} scrap`]),
        el("ul", "inventory", owned.map(([id, n]) => el("li", "", [`${itemName(id)} x${n}`]))),
        el("div", "actions", [deploy]),
      ]);
      refresh();
      this.show(panel);
      if (focusFrame) frameSelect.querySelector("select")?.focus({ preventScroll: true });
    };
    render(false);
  }

  showMap(opts: MapOptions): void {
    const canvas = el("canvas", "map");
    canvas.width = canvas.height = 720;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "World map");
    drawMap(canvas, opts);

    const bases = opts.sites.filter((s) => s.held);
    const here = (s: MapSite): boolean => Math.hypot(opts.player.x - s.site.x, opts.player.z - s.site.z) < s.site.radius;
    const travel = bases.map((s) => {
      const b = button(`Travel to ${s.site.name}`, () => opts.onTravel(s.site.id), "secondary");
      b.disabled = opts.travelBlocked !== null || here(s);
      return b;
    });
    const known = [...opts.sites].sort((a, b) => a.site.name.localeCompare(b.site.name));
    const side = el("div", "mapSide", [
      el("p", "", [`You are in ${opts.region}.`]),
      el("h2", "", ["Fast travel"]),
      el("p", "dim", [opts.travelBlocked ?? "Travel to any base you hold."]),
      el("div", "travel", travel),
      el("h2", "", [`Places found · ${opts.sites.length} of ${opts.total}`]),
      el("ul", "places", known.map((s) => el("li", s.held ? "held" : s.hostile ? "hostile" : "", [`${s.site.name}${s.held ? " (held)" : s.hostile ? " (hostile)" : ""}`]))),
      el("div", "actions", [button("Close map", opts.onClose)]),
    ]);
    this.show(el("div", "panel mapPanel", [el("h1", "", [opts.model.def.name]), el("div", "mapBody", [canvas, side])]));
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
