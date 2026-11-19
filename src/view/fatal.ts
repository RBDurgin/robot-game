/**
 * The screen shown when the game cannot run: no WebGL2 or WebAssembly, or a failure while
 * starting or playing. Plain DOM, so it works whatever state the engine is in.
 */
export interface FatalAction {
  label: string;
  run(): void | Promise<void>;
  primary?: boolean;
}

export function showFatal(title: string, paragraphs: string[], actions: FatalAction[] = [], detail?: string): void {
  const overlay = document.getElementById("overlay");
  if (!overlay) return;
  const panel = document.createElement("div");
  panel.className = "panel fatal";
  panel.setAttribute("role", "alertdialog");
  const h = document.createElement("h1");
  h.textContent = title;
  panel.append(h);
  for (const text of paragraphs) {
    const p = document.createElement("p");
    p.textContent = text;
    panel.append(p);
  }
  if (detail) {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = "Technical details";
    const pre = document.createElement("pre");
    pre.textContent = detail;
    d.append(s, pre);
    panel.append(d);
  }
  const row = document.createElement("div");
  row.className = "actions";
  for (const a of actions) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = a.primary ? "primary" : "secondary";
    b.textContent = a.label;
    b.addEventListener("click", () => void a.run());
    row.append(b);
  }
  if (actions.length > 0) panel.append(row);
  overlay.replaceChildren(panel);
  overlay.hidden = false;
  overlay.style.setProperty("zoom", "1");
  document.exitPointerLock?.();
  panel.querySelector<HTMLButtonElement>("button")?.focus();
}

/** What this browser lacks that the game needs, or an empty list. */
export function missingFeatures(): string[] {
  const missing: string[] = [];
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) missing.push("WebGL 2");
  } catch {
    missing.push("WebGL 2");
  }
  if (typeof WebAssembly !== "object" || typeof WebAssembly.instantiate !== "function") missing.push("WebAssembly");
  return missing;
}
