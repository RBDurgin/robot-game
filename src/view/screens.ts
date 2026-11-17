import { FRAME_IDS, FRAMES, type FrameDef, type FrameId, type Trigger } from "../data/frames";
import { MODS } from "../data/mods";
import type { WeaponDef } from "../data/weapons";
import type { Settings } from "../game/save";
import type { SlotInfo } from "../game/saveStore";
import type { WorldModel } from "../sim/terrain";
import { drawMap, type MapSite, type MapTerritory } from "./mapView";
import { buyItem, buyPrice, isSpare, repairBill, sellItem, sellPrice, type Wallet } from "../sim/economy";
import { findItem, fitKit, fitProblems, fitToFrame, isPlatingItem, isWeaponItem, plainSpec, specKey, specName, tunedPlating, tunedWeapon, type Fit, type Item, type ItemSpec } from "../sim/items";
import { fitsMount, itemName, kitStats, type ItemId } from "../sim/loadout";
import { PRICES } from "../data/economy";
import { UNLOCK_IDS, UNLOCKS } from "../data/unlocks";
import { buyUnlock, canUnlock, frameUnlocked, lockProblems, mountUnlocked, unlockNeeds, type Progress } from "../sim/unlocks";

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
  ["H", "Hangar (at a base you hold, or an ally's)"],
  ["G", "Call allied pilots to your wing, or release them"],
  ["B", "Mission briefing (at a base, when one is on offer)"],
  ["C", "Contracts (at a base)"],
  ["L", "Mission log"],
  ["M", "World map and fast travel"],
  ["Esc", "Pause"],
];

export interface PauseOptions {
  /** True for the first screen shown on load. */
  isStart: boolean;
  settings: Settings;
  onSettings(settings: Settings): void;
  onResume(): void;
  /** The save slots, for the list on this screen. */
  slots(): Promise<SlotInfo[]>;
  /** Leave this game and load another slot. */
  onSlot(slot: number): void;
  /** Download the game in progress as a file. */
  onExport(): void;
  /** Replace the slot in use with the contents of a save file. Resolves to what went wrong, or null. */
  onImport(text: string): Promise<string | null>;
  /** Empty the slot in use and start again. */
  onReset(): void;
}

export interface HangarOptions {
  /** The frame the suit is built on now. */
  frame: FrameId;
  /** The build last deployed. Its parts cannot be sold, whatever is on the bench. */
  fit: Fit;
  /** The player's scrap, parts and unlocks. The shop changes all three in place. */
  wallet: Wallet & Progress;
  /** What a full repair of the suit costs, before the cap and what the player can pay. */
  repairCost: number;
  /** Called after each purchase or sale, to save it. */
  onTrade(): void;
  onDeploy(frame: FrameId, fit: Fit): void;
}

export interface MapOptions {
  model: WorldModel;
  player: { x: number; z: number; yaw: number };
  /** Name of the region the player is in. */
  region: string;
  /** The places the player knows about. */
  sites: MapSite[];
  /** Who controls each region. */
  territory: MapTerritory[];
  /** The factions at war and where the player stands with each. */
  factions: { name: string; style: string; color: string; standing: number; attitude: "hostile" | "neutral" | "allied"; sites: number }[];
  /** Number of places in the world, found or not. */
  total: number;
  /** Why fast travel is unavailable right now, or null if it is available. */
  travelBlocked: string | null;
  onTravel(siteId: string): void;
  onClose(): void;
}

const FIRE_KEYS: Record<Trigger, string> = { primary: "LMB", secondary: "RMB", tertiary: "E" };

/** One line of numbers for a weapon, in the units that suit its kind. */
function weaponNumbers(w: WeaponDef): string {
  if (w.kind === "beam") return `${w.damage} dmg/s · ${w.heat} heat/s · ${w.range} m · ${w.mass} t`;
  const damage = w.pellets ? `${w.pellets} x ${w.damage}` : String(w.damage);
  return `${damage} dmg · ${(1 / w.cooldown).toFixed(1)}/s · ${w.heat} heat · ${w.range} m · ${w.mass} t`;
}

/** What a part does, in a line: a weapon's numbers or a plating's armor and mass. */
function partNumbers(spec: ItemSpec): string {
  if (isWeaponItem(spec)) return weaponNumbers(tunedWeapon(spec));
  if (!isPlatingItem(spec)) return "";
  const p = tunedPlating(spec);
  return `${Math.round(p.armorScale * 100)}% armor · ${p.mass} t`;
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

export interface BriefingOptions {
  title: string;
  /** The kind of mission, for the line under the title. */
  type: string;
  /** Who is speaking. */
  from: string;
  text: string[];
  /** What it pays, a line each. */
  rewards: string[];
  onAccept(): void;
  onLater(): void;
}

export interface OfferOptions {
  offers: {
    name: string;
    role: string;
    motto: string;
    text: string[];
    /** The faction's colour, as CSS. */
    color: string;
    onTake(): void;
  }[];
  onLater(): void;
}

export interface ContractOptions {
  /** Why no contract can be taken now (a mission is in hand), or null. */
  busy: string | null;
  contracts: {
    title: string;
    from: string;
    text: string[];
    rewards: string[];
    /** The paying faction's colour, as CSS. */
    color: string;
    onAccept(): void;
  }[];
  onClose(): void;
}

export interface LogOptions {
  /** The mission in progress. */
  current: { title: string; objective: string } | null;
  /** What is waiting to be taken, in words. */
  next: string | null;
  patron: string | null;
  /** The campaign missions finished, in order. */
  done: { title: string; type: string; text: string }[];
  /** How many missions the campaign has. */
  total: number;
  onClose(): void;
}

export interface MissionSummary {
  /** What the mission paid, a line each. */
  rewards: string[];
  /** Heading and a line or two on how it went. */
  title: string;
  text: string;
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

    // The slots are read from storage, so the list fills in a moment after the screen opens.
    const slotList = el("ul", "slots");
    const saveNote = el("p", "dim", ["Progress saves by itself to the slot in use."]);
    void opts.slots().then((slots) => {
      slotList.replaceChildren(
        ...slots.map((s) => {
          const about = s.summary
            ? `${s.summary.frame} frame · ${s.summary.scrap} scrap · ${s.summary.parts} parts · ${s.summary.sites} sites cleared · ${new Date(s.summary.savedAt).toLocaleString()}`
            : "Empty";
          const use = button(s.summary ? "Load" : "New game", () => opts.onSlot(s.slot), "secondary");
          use.setAttribute("aria-label", `${s.summary ? "Load" : "New game in"} slot ${s.slot}`);
          return el("li", s.active ? "active" : "", [el("span", "", [`Slot ${s.slot}${s.active ? " (in use)" : ""}: ${about}`]), ...(s.active ? [] : [use])]);
        }),
      );
    });
    const file = el("input");
    file.type = "file";
    file.accept = "application/json,.json";
    file.hidden = true;
    file.setAttribute("aria-label", "Save file to import");
    file.addEventListener("change", () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      void chosen
        .text()
        .then((text) => opts.onImport(text))
        .then((problem) => {
          if (problem) {
            saveNote.textContent = problem;
            saveNote.className = "bad";
          }
          file.value = "";
        });
    });

    const panel = el("div", "panel", [
      el("h1", "", [opts.isStart ? "Ashfall Basin" : "Paused"]),
      ...(opts.isStart
        ? [
            el("p", "", [
              "The Kestrel Combine has fortified an outpost to the north-east. Clear out its garrison, salvage what they leave behind, and return to base. Beyond the basin four factions are fighting over the Marches. You fly for none of them: who shoots at you, and who fights beside you, depends on what you do.",
            ]),
          ]
        : []),
      el("h2", "", ["Controls"]),
      controls,
      el("h2", "", ["Settings"]),
      range("Mouse sensitivity", 0.0006, 0.005, 0.0002, settings.sensitivity, (v) => (settings.sensitivity = v)),
      range("Volume", 0, 1, 0.05, settings.volume, (v) => (settings.volume = v)),
      el("label", "row", [el("span", "", ["Starting view"]), view]),
      el("h2", "", ["Saved games"]),
      slotList,
      saveNote,
      el("div", "actions", [
        button("Export save", opts.onExport, "secondary"),
        button("Import save", () => file.click(), "secondary"),
        button("Reset this slot", opts.onReset, "secondary"),
        file,
      ]),
      el("div", "actions", [button(opts.isStart ? "Deploy" : "Resume", opts.onResume)]),
    ]);
    this.show(panel);
  }

  showHangar(opts: HangarOptions): void {
    const inventory = opts.wallet.inventory;
    let frameId = opts.frame;
    // The bench build: what is being put together, saved only on deploy.
    let fit: Fit = fitToFrame(FRAMES[frameId], opts.fit, inventory);
    const unlocks = opts.wallet.unlocks;

    const select = (label: string, options: Item[], current: number | undefined, allowEmpty: boolean, set: (uid: number | undefined) => void, locked = false): HTMLElement => {
      const input = el("select");
      if (locked) {
        input.disabled = true;
        input.append(el("option", "", ["Locked: see upgrades below"]));
        return el("label", "row", [el("span", "", [label]), input]);
      }
      if (allowEmpty) {
        const o = el("option", "", ["Empty"]);
        o.value = "";
        o.selected = current === undefined;
        input.append(o);
      }
      for (const item of options) {
        const o = el("option", "", [specName(item)]);
        o.value = String(item.uid);
        o.dataset.item = item.id;
        o.selected = item.uid === current;
        input.append(o);
      }
      input.addEventListener("change", () => set(input.value === "" ? undefined : Number(input.value)));
      return el("label", "row", [el("span", "", [label]), input]);
    };
    // Best parts first, so the pick of several of a kind is at the top.
    const ranked = (items: Item[]): Item[] => [...items].sort((a, b) => itemName(a.id).localeCompare(itemName(b.id)) || b.tier - a.tier || b.mods.length - a.mods.length || a.uid - b.uid);

    // The panel is rebuilt when the frame changes, because the frame decides which mounts exist,
    // and after a trade, because the parts on offer in each slot change.
    const render = (focusFrame: boolean, keepScroll = false): void => {
      const scroll = keepScroll ? (this.root.firstElementChild?.scrollTop ?? 0) : 0;
      const frame: FrameDef = FRAMES[frameId];
      const weaponsOwned = ranked(inventory.filter((item) => isWeaponItem(item)));
      const platingOwned = ranked(inventory.filter((item) => isPlatingItem(item)));
      const bill = repairBill(opts.repairCost, opts.wallet.scrap);
      const sells: [Item[], HTMLButtonElement][] = [];
      const spare = (items: Item[]): Item | undefined => items.find((item) => isSpare(item.uid, [fit, opts.fit]));
      const stats = el("div", "stats");
      const problems = el("ul", "problems");
      const deploy = button(bill > 0 ? `Repair and deploy · ${bill} scrap` : "Repair and deploy", () => opts.onDeploy(frameId, { weapons: { ...fit.weapons }, plating: fit.plating }));

      const refresh = (): void => {
        const kit = fitKit(fit, inventory);
        const s = kitStats(frame, kit);
        const fitted = (uid: number | undefined): string => {
          const item = findItem(inventory, uid);
          return item ? `${specName(item)} · ${partNumbers(item)}` : "empty";
        };
        stats.replaceChildren(
          el("div", s.overweight ? "bad" : "", [`Load ${s.mass.toFixed(1)} / ${s.capacity} t`]),
          el("div", "", [`Speed ${Math.round(s.mobility * 100)}%`]),
          el("div", "", [`Armor ${Math.round(s.armorScale * 100)}%`]),
          ...frame.hardpoints.map((h) => el("div", "dim", [`${h.name}: ${fitted(fit.weapons[h.id])}`])),
          el("div", "dim", [`Plating: ${kit.plating.description}`]),
        );
        const issues = [...lockProblems(frame, fit.weapons, unlocks), ...fitProblems(frame, fit, inventory)];
        problems.replaceChildren(...issues.map((p) => el("li", "", [p])));
        deploy.disabled = issues.length > 0;
        // A part fitted on the bench stops being spare.
        for (const [items, sell] of sells) sell.disabled = !spare(items);
      };

      const frameSelect = el("label", "row", [el("span", "", ["Frame"])]);
      const frameInput = el("select");
      for (const id of FRAME_IDS) {
        const open = frameUnlocked(unlocks, id);
        const o = el("option", "", [`${FRAMES[id].name} (${FRAMES[id].weightClass})${open ? "" : " · locked"}`]);
        o.value = id;
        o.disabled = !open;
        o.selected = id === frameId;
        frameInput.append(o);
      }
      frameInput.addEventListener("change", () => {
        frameId = frameInput.value as FrameId;
        fit = fitToFrame(FRAMES[frameId], fit, inventory);
        render(true);
      });
      frameSelect.append(frameInput);

      const slots = frame.hardpoints.map((h) =>
        select(
          `${h.name} · ${FIRE_KEYS[h.trigger]}`,
          weaponsOwned.filter((item) => isWeaponItem(item) && fitsMount(tunedWeapon(item), h.mount)),
          fit.weapons[h.id],
          true,
          (uid) => {
            // One item cannot be in two mounts: picking it here takes it off the other.
            const other = frame.hardpoints.find((o) => o.id !== h.id && uid !== undefined && fit.weapons[o.id] === uid);
            if (other) delete fit.weapons[other.id];
            if (uid !== undefined) fit.weapons[h.id] = uid;
            else delete fit.weapons[h.id];
            if (other) render(false, true);
            else refresh();
          },
          !mountUnlocked(unlocks, h.mount),
        ),
      );

      const trade = (done: boolean): void => {
        if (!done) return;
        opts.onTrade();
        render(false, true);
      };
      const forSale = el("table", "shop", [
        el("tbody", "", (Object.keys(PRICES) as ItemId[]).map((id) => {
          const buy = button(`Buy · ${buyPrice(id)}`, () => trade(buyItem(opts.wallet, id) !== null), "secondary");
          buy.disabled = opts.wallet.scrap < buyPrice(id);
          buy.setAttribute("aria-label", `Buy ${itemName(id)} for ${buyPrice(id)} scrap`);
          return el("tr", "", [el("th", "", [itemName(id)]), el("td", "about", [partNumbers(plainSpec(id))]), el("td", "", [buy])]);
        })),
      ]);
      // Frames and mounts still to be earned.
      const upgrades = UNLOCK_IDS.filter((id) => !unlocks.includes(id)).map((id) => {
        const u = UNLOCKS[id];
        const needs = unlockNeeds(id, opts.wallet);
        const buy = button(`Unlock · ${u.cost}`, () => trade(buyUnlock(opts.wallet, id)), "secondary");
        buy.disabled = !canUnlock(id, opts.wallet);
        buy.setAttribute("aria-label", `Unlock ${u.name} for ${u.cost} scrap`);
        return el("tr", "", [el("th", "", [u.name]), el("td", "about", [u.description, ...(needs.length > 0 ? [el("div", "needs", [needs.join(". ") + "."])] : [])]), el("td", "", [buy])]);
      });
      // Interchangeable parts share a row.
      const groups = new Map<string, Item[]>();
      for (const item of [...weaponsOwned, ...platingOwned]) groups.set(specKey(item), [...(groups.get(specKey(item)) ?? []), item]);
      const owned = el("table", "shop", [
        el("tbody", "", [...groups.values()].map((items) => {
          const first = items[0]!;
          const sell = button(`Sell · ${sellPrice(first)}`, () => {
            const item = spare(items);
            trade(item !== undefined && sellItem(opts.wallet, item.uid, [fit, opts.fit]));
          }, "secondary");
          sell.setAttribute("aria-label", `Sell ${specName(first)} for ${sellPrice(first)} scrap`);
          sells.push([items, sell]);
          const name = el("th", first.tier > 1 || first.mods.length > 0 ? "special" : "", [specName(first)]);
          name.title = first.mods.map((m) => `${MODS[m].name}: ${MODS[m].description}`).join(" ");
          return el("tr", "", [name, el("td", "count", [`x${items.length}`]), el("td", "about", [partNumbers(first)]), el("td", "", [sell])]);
        })),
      ]);

      const panel = el("div", "panel wide", [
        el("h1", "", [`Hangar · ${frame.name} frame`]),
        frameSelect,
        frameTable(frameId),
        el("h2", "", ["Loadout"]),
        ...slots,
        select("Plating", platingOwned, fit.plating, false, (uid) => {
          fit.plating = uid ?? fit.plating;
          refresh();
        }),
        stats,
        problems,
        el("h2", "", [`Your parts · ${opts.wallet.scrap} scrap`]),
        owned,
        ...(upgrades.length > 0 ? [el("h2", "", ["Upgrades"]), el("table", "shop", [el("tbody", "", upgrades)])] : []),
        el("h2", "", ["Parts store"]),
        el("p", "dim", ["Bases sell plain parts. Better marks and modified parts only come from salvage."]),
        forSale,
        el("div", "actions", [deploy]),
      ]);
      refresh();
      this.show(panel);
      panel.scrollTop = scroll;
      if (focusFrame) frameInput.focus({ preventScroll: true });
    };
    render(false);
  }

  showMap(opts: MapOptions): void {
    const canvas = el("canvas", "map");
    canvas.width = canvas.height = 720;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "World map");
    drawMap(canvas, opts);

    const bases = opts.sites.filter((s) => s.travel);
    const here = (s: MapSite): boolean => Math.hypot(opts.player.x - s.site.x, opts.player.z - s.site.z) < s.site.radius;
    const travel = bases.map((s) => {
      const b = button(`Travel to ${s.site.name}${s.held ? "" : ` (${s.owner})`}`, () => opts.onTravel(s.site.id), "secondary");
      b.disabled = opts.travelBlocked !== null || here(s);
      return b;
    });
    const known = [...opts.sites].sort((a, b) => a.site.name.localeCompare(b.site.name));
    const factions = opts.factions.map((f) => {
      const swatch = el("span", "swatch");
      swatch.style.background = f.color;
      const row = el("li", f.attitude, [swatch, `${f.name}: ${f.attitude} (${f.standing > 0 ? "+" : ""}${f.standing}) · ${f.sites} ${f.sites === 1 ? "site" : "sites"}`]);
      row.title = f.style;
      return row;
    });
    const tag = (s: MapSite): string => (s.held ? " (held)" : s.owner ? ` (${s.owner}${s.hostile ? ", hostile" : ""})` : "") + (s.raided ? " · raid incoming" : "");
    const side = el("div", "mapSide", [
      el("p", "", [`You are in ${opts.region}.`]),
      el("h2", "", ["The war"]),
      el("ul", "factions", factions),
      el("p", "dim", ["Regions take the colour of whoever holds most of them; stripes mean the region is fought over."]),
      el("h2", "", ["Fast travel"]),
      el("p", "dim", [opts.travelBlocked ?? "Travel to any base you hold, or an ally's."]),
      el("div", "travel", travel),
      el("h2", "", [`Places found · ${opts.sites.length} of ${opts.total}`]),
      el("ul", "places", known.map((s) => el("li", s.held ? "held" : s.hostile ? "hostile" : "", [`${s.site.name}${tag(s)}`]))),
      el("div", "actions", [button("Close map", opts.onClose)]),
    ]);
    this.show(el("div", "panel mapPanel", [el("h1", "", [opts.model.def.name]), el("div", "mapBody", [canvas, side])]));
  }

  showBriefing(opts: BriefingOptions): void {
    this.show(
      el("div", "panel", [
        el("h1", "", [opts.title]),
        el("h2", "", [`${opts.type} mission · ${opts.from}`]),
        ...opts.text.map((line) => el("p", "", [line])),
        ...(opts.rewards.length > 0 ? [el("h2", "", ["Pays"]), el("p", "", [opts.rewards.join(", ")])] : []),
        el("div", "actions", [button("Accept", opts.onAccept), button("Not now", opts.onLater, "secondary")]),
      ]),
    );
  }

  /** The patrons' offers at the midpoint of the campaign: read them all, take one. */
  showOffers(opts: OfferOptions): void {
    const cards = opts.offers.map((o) => {
      const card = el("div", "offer", [
        el("h2", "", [o.name]),
        el("p", "dim", [o.role]),
        ...o.text.map((line) => el("p", "", [line])),
        el("p", "motto", [`"${o.motto}"`]),
        el("div", "actions", [button(`Fly for ${o.name.split(" ").pop()}`, o.onTake)]),
      ]);
      card.style.borderTopColor = o.color;
      return card;
    });
    this.show(
      el("div", "panel offersPanel", [
        el("h1", "", ["The offers"]),
        el("p", "", ["Harbor asked for a crew, and everyone heard. These messages were waiting when you got in. Whoever you fly for briefs you from here on, and it cannot be undone."]),
        el("div", "offers", cards),
        el("div", "actions", [button("Decide later", opts.onLater, "secondary")]),
      ]),
    );
  }

  /** The contract board at a base: work the factions are paying for, as the war stands. */
  showContracts(opts: ContractOptions): void {
    const cards = opts.contracts.map((c) => {
      const card = el("div", "offer", [
        el("h2", "", [c.title]),
        el("p", "dim", [c.from]),
        ...c.text.map((line) => el("p", "", [line])),
        el("p", "motto", [`Pays ${c.rewards.join(", ")}`]),
        el("div", "actions", [button("Accept", c.onAccept)]),
      ]);
      const accept = card.querySelector("button")!;
      accept.disabled = opts.busy !== null;
      card.style.borderTopColor = c.color;
      return card;
    });
    this.show(
      el("div", "panel offersPanel", [
        el("h1", "", ["Contracts"]),
        el("p", "", [cards.length > 0 ? "Work on offer from the factions that will deal with you. The board changes as the war does." : "Nobody who will deal with you has work at the moment. Look again later."]),
        ...(opts.busy ? [el("p", "bad", [opts.busy])] : []),
        el("div", "offers", cards),
        el("div", "actions", [button("Close", opts.onClose, "secondary")]),
      ]),
    );
  }

  showLog(opts: LogOptions): void {
    this.show(
      el("div", "panel wide", [
        el("h1", "", ["Mission log"]),
        el("h2", "", ["Now"]),
        el("p", "", [opts.current ? `${opts.current.title}: ${opts.current.objective}` : (opts.next ?? "Nothing in hand. Contracts are posted at any base you hold.")]),
        ...(opts.patron ? [el("h2", "", ["You fly for"]), el("p", "", [opts.patron])] : []),
        el("h2", "", [`The Signal · ${opts.done.length} of ${opts.total}`]),
        ...(opts.done.length > 0 ? opts.done.flatMap((d, i) => [el("p", "", [`${i + 1}. ${d.title} (${d.type})`]), el("p", "dim", [d.text])]) : [el("p", "dim", ["Nothing finished yet."])]),
        el("div", "actions", [button("Close", opts.onClose)]),
      ]),
    );
  }

  /** The summary at the end of a mission. `onReplay` is null for missions that cannot be played again. */
  showComplete(summary: MissionSummary, onReplay: (() => void) | null, onContinue: () => void): void {
    const mins = Math.floor(summary.seconds / 60);
    const secs = Math.floor(summary.seconds % 60);
    const rows: [string, string][] = [
      ["Time", `${mins}:${String(secs).padStart(2, "0")}`],
      ["Hostiles destroyed", String(summary.kills)],
      ["Suits lost", String(summary.deaths)],
      ["Parts salvaged", String(summary.items)],
      ["Scrap", String(summary.scrap)],
    ];
    if (summary.rewards.length > 0) rows.unshift(["Paid", summary.rewards.join(", ")]);
    const list = el("dl", "controls");
    for (const [k, v] of rows) list.append(el("dt", "", [k]), el("dd", "", [v]));
    this.show(
      el("div", "panel", [
        el("h1", "", [summary.title]),
        el("p", "", [summary.text]),
        list,
        el("div", "actions", onReplay ? [button("Play again", onReplay), button("Keep exploring", onContinue, "secondary")] : [button("Continue", onContinue)]),
      ]),
    );
  }
}
