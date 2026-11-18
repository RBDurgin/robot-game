// Generates the game's own glTF models into public/models/. Run with `npm run models`.
//
// Each part is described in game coordinates with the same origin and attachment points as its
// procedural counterpart in src/view/parts/proceduralParts.ts, which stays underneath as the
// rig. A node named `joint.<name>` follows the procedural node of that name, so its contents
// are written relative to that joint. Materials named primary, secondary, accent, metal and
// dark are replaced in game by the owning faction's; the colours here are for viewing only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eulerToQuat, Node, writeGlb } from "./models/glb.mjs";

const OUT = "public/models";

const MATERIALS = {
  primary: { color: [0.36, 0.42, 0.36], metallic: 0.35, roughness: 0.55 },
  secondary: { color: [0.22, 0.25, 0.22], metallic: 0.4, roughness: 0.6 },
  accent: { color: [1, 0.6, 0.2], metallic: 0, roughness: 0.3, emissive: [1, 0.6, 0.2] },
  metal: { color: [0.42, 0.44, 0.47], metallic: 0.85, roughness: 0.4 },
  dark: { color: [0.08, 0.08, 0.09], metallic: 0.5, roughness: 0.7 },
};

/** Frame proportions, as in FrameDef.look in src/data/frames.ts. */
const FRAMES = {
  light: { bulk: 0.8, hipHeight: 2.45, head: "mast", mounts: false },
  medium: { bulk: 1, hipHeight: 2.2, head: "visor", mounts: false },
  heavy: { bulk: 1.3, hipHeight: 2.0, head: "dome", mounts: true },
};

const SIDES = [-1, 1];
const sideName = (s) => (s < 0 ? "l" : "r");

/** Legs. Origin on the ground between the feet; joints pelvis, hip_l/r, knee_l/r. */
function legs({ bulk: b, hipHeight }) {
  const root = new Node("legs");
  const seg = hipHeight / 2;

  const pelvis = root.child("joint.pelvis", [0, hipHeight, 0]);
  pelvis.box("secondary", [1.35 * b, 0.42, 0.95 * b], [0, 0.15, 0], { bevel: 0.1 });
  pelvis.box("dark", [0.7 * b, 0.5, 0.75 * b], [0, -0.05, 0], { bevel: 0.06 });
  pelvis.wedge("primary", [0.85 * b, 0.32, 0.4], [0, -0.12, 0.42 * b], 0.12);
  pelvis.box("metal", [0.5 * b, 0.22, 0.25], [0, 0.05, -0.5 * b], { bevel: 0.04 });
  for (const s of SIDES) pelvis.cyl("metal", { r: 0.3 * b, h: 0.3, axis: "x", sides: 14 }, [s * 0.5 * b, 0, 0]);

  for (const s of SIDES) {
    const hip = root.child(`joint.hip_${sideName(s)}`, [s * 0.62 * b, hipHeight, 0]);
    hip.cyl("dark", { r: 0.24 * b, h: 0.5 * b, axis: "x", sides: 12 }, [0, 0, 0]);
    hip.box("primary", [0.6 * b, seg * 0.78, 0.74 * b], [0, -seg * 0.46, 0.02], { bevel: 0.1 });
    hip.box("secondary", [0.14 * b, seg * 0.68, 0.82 * b], [s * 0.34 * b, -seg * 0.45, 0], { bevel: 0.04 });
    hip.box("secondary", [0.5 * b, 0.12, 0.6 * b], [0, -seg * 0.86, 0.02], { bevel: 0.03 });
    hip.cyl("metal", { r: 0.065, h: seg * 0.6, sides: 8 }, [0, -seg * 0.5, -0.42 * b]);
    hip.cyl("dark", { r: 0.1, h: 0.12, sides: 8 }, [0, -seg * 0.18, -0.42 * b]);
    hip.cyl("dark", { r: 0.21 * b, h: 0.58 * b, axis: "x", sides: 12 }, [0, -seg, 0]);

    const knee = root.child(`joint.knee_${sideName(s)}`, [s * 0.62 * b, seg, 0]);
    knee.box("metal", [0.56 * b, 0.36, 0.42 * b], [0, 0.04, 0.3 * b], { bevel: 0.1, rot: [0.25, 0, 0] });
    knee.box("secondary", [0.48 * b, seg - 0.25, 0.58 * b], [0, -(seg - 0.2) / 2, -0.02], { bevel: 0.08 });
    knee.box("primary", [0.42 * b, (seg - 0.3) * 0.78, 0.12], [0, -(seg - 0.2) * 0.45, 0.33 * b], { bevel: 0.04, rot: [-0.06, 0, 0] });
    knee.cyl("metal", { r: 0.07, h: seg * 0.55, sides: 8 }, [0, -seg * 0.48, -0.34 * b]);
    knee.cyl("dark", { r: 0.15 * b, h: 0.5 * b, axis: "x", sides: 10 }, [0, -seg + 0.34, 0]);
    // Foot: a dark sole, a sloped upper, a toe cap and a heel spur.
    knee.box("dark", [0.78 * b, 0.1, 1.3 * b], [0, -seg + 0.05, 0.2 * b], { bevel: 0.03 });
    knee.wedge("primary", [0.7 * b, 0.24, 1.15 * b], [0, -seg + 0.22, 0.2 * b], 0.32 * b);
    knee.box("secondary", [0.6 * b, 0.15, 0.26], [0, -seg + 0.14, 0.2 * b + 0.64 * b], { bevel: 0.04 });
    knee.box("metal", [0.3 * b, 0.18, 0.3], [0, -seg + 0.13, -0.4 * b], { bevel: 0.04 });
  }
  return root;
}

/** Torso. Origin is the hip joint. Matches ProceduralTorso's attachment points. */
function torso({ bulk: b, mounts }) {
  const d = 0.6 + 0.4 * b;
  const root = new Node("torso");
  const front = 0.675 * d;

  // Abdomen: a dark core wrapped in metal rings, so the waist reads as a joint.
  root.box("dark", [0.8 * b, 0.5, 0.7 * d], [0, 0.22, 0], { bevel: 0.06 });
  for (const y of [0.08, 0.24, 0.4]) root.box("metal", [0.95 * b, 0.07, 0.82 * d], [0, y, 0], { bevel: 0.03 });

  // Chest shell: a bevelled block with a sloped lower front and a raised spine.
  root.box("primary", [2.0 * b, 0.95, 1.35 * d], [0, 1.15, 0], { bevel: 0.14 });
  root.wedge("primary", [1.8 * b, 0.35, 1.25 * d], [0, 0.5, -0.02], 0.22);
  root.box("secondary", [1.7 * b, 0.12, 1.2 * d], [0, 0.68, 0], { bevel: 0.04 });
  root.box("secondary", [0.5 * b, 0.35, 1.1 * d], [0, 1.6, -0.1], { bevel: 0.06 });

  // Front armour: a sloped plate under the canopy, with intake grilles either side.
  root.box("secondary", [1.3 * b, 0.62, 0.22], [0, 0.88, front + 0.05], { bevel: 0.06, rot: [-0.18, 0, 0] });
  for (const s of SIDES) {
    const x = s * 0.62 * b;
    root.box("dark", [0.38 * b, 0.32, 0.08], [x, 0.58, front - 0.02], { bevel: 0.02 });
    for (let i = 0; i < 4; i++) root.box("metal", [0.34 * b, 0.035, 0.06], [x, 0.47 + i * 0.075, front + 0.02], { bevel: 0.01 });
    root.box("accent", [0.16, 0.06, 0.05], [s * 0.82 * b, 1.48, front + 0.01], { bevel: 0.015 });
    root.cyl("metal", { r: 0.3, h: 0.3, axis: "x", sides: 14 }, [s * 1.08 * b, 1.4, 0]);
    root.cyl("dark", { r: 0.18, h: 0.34, axis: "x", sides: 10 }, [s * 1.1 * b, 1.4, 0]);
    root.box("secondary", [0.12, 0.7, 1.0 * d], [s * 0.98 * b, 0.95, 0], { bevel: 0.04 });
  }

  // Canopy: glazing in a dark frame with a brow above it.
  root.box("dark", [0.98, 0.52, 0.18], [0, 1.35, front + 0.02], { bevel: 0.05 });
  root.box("accent", [0.8, 0.36, 0.1], [0, 1.35, front + 0.1], { bevel: 0.04 });
  root.box("primary", [1.1, 0.1, 0.35], [0, 1.64, front - 0.02], { bevel: 0.03, rot: [0.2, 0, 0] });

  // Collar ring and the back plate the thruster pack bolts to.
  root.box("secondary", [2.3 * b, 0.28, 1.0 * d], [0, 1.72, -0.05], { bevel: 0.08 });
  root.box("metal", [1.2 * b, 0.85, 0.16], [0, 1.0, -front], { bevel: 0.04 });
  for (const s of SIDES) root.cyl("dark", { r: 0.07, h: 0.1, axis: "z", sides: 8 }, [s * 0.42 * b, 1.3, -front - 0.1]);

  if (mounts) {
    for (const s of SIDES) {
      root.box("metal", [0.45, 0.5, 0.6], [s * 0.75 * b, 2.05, -0.2], { bevel: 0.05 });
      root.box("dark", [0.5, 0.1, 0.66], [s * 0.75 * b, 2.32, -0.2], { bevel: 0.02 });
      root.cyl("dark", { r: 0.16, h: 0.12, sides: 12 }, [s * 0.75 * b, 2.42, -0.2]);
    }
  }
  return root;
}

/** Head on the neck. Three styles, as FrameLook.head. */
function head({ head: style }) {
  const root = new Node("head");
  root.cyl("dark", { r: 0.2, h: 0.25, sides: 10 }, [0, -0.02, 0]);
  if (style === "mast") {
    root.box("primary", [0.5, 0.42, 0.8], [0, 0.21, 0.05], { bevel: 0.08 });
    root.box("dark", [0.44, 0.18, 0.1], [0, 0.24, 0.44], { bevel: 0.03 });
    root.box("accent", [0.38, 0.1, 0.06], [0, 0.24, 0.48], { bevel: 0.02 });
    root.box("secondary", [0.56, 0.08, 0.5], [0, 0.44, 0.0], { bevel: 0.02 });
    root.cyl("metal", { r: 0.04, h: 1.3, sides: 8 }, [0, 1.0, -0.25]);
    root.cyl("dark", { r: 0.14, rTop: 0.06, h: 0.08, sides: 12 }, [0, 0.75, -0.25]);
    root.box("accent", [0.5, 0.08, 0.22], [0, 1.45, -0.25], { bevel: 0.02 });
    root.box("metal", [0.06, 0.2, 0.06], [0, 1.6, -0.25], { bevel: 0.01 });
  } else if (style === "dome") {
    root.box("primary", [1.0, 0.36, 0.95], [0, 0.18, 0], { bevel: 0.1 });
    root.box("secondary", [1.1, 0.12, 0.5], [0, 0.4, 0.2], { bevel: 0.04 });
    root.box("dark", [0.86, 0.15, 0.08], [0, 0.2, 0.47], { bevel: 0.02 });
    root.box("accent", [0.78, 0.07, 0.05], [0, 0.2, 0.5], { bevel: 0.015 });
    for (const s of SIDES) root.cyl("metal", { r: 0.1, h: 0.14, axis: "x", sides: 10 }, [s * 0.55, 0.2, 0.1]);
  } else {
    root.box("primary", [0.7, 0.5, 0.75], [0, 0.25, 0], { bevel: 0.1 });
    root.box("dark", [0.62, 0.2, 0.1], [0, 0.28, 0.36], { bevel: 0.03 });
    root.box("accent", [0.55, 0.11, 0.06], [0, 0.28, 0.4], { bevel: 0.02 });
    for (const s of SIDES) root.box("secondary", [0.08, 0.32, 0.5], [s * 0.37, 0.2, 0.05], { bevel: 0.02 });
    root.cyl("metal", { r: 0.025, h: 0.6, sides: 6 }, [0.3, 0.7, -0.2]);
    root.cyl("dark", { r: 0.08, h: 0.06, sides: 10 }, [-0.15, 0.52, 0.05]);
  }
  return root;
}

/** One arm, origin at the shoulder. Joints pivot (shoulder pitch) and forearm (recoil). */
function arm({ bulk: b }, s) {
  const root = new Node(`arm${s < 0 ? "L" : "R"}`);
  const p = b * b;
  root.box("primary", [0.75 * p, 0.7 * p, 1.0 * p], [s * 0.1, 0.1, 0], { bevel: 0.12 });
  root.box("secondary", [0.8 * p, 0.1, 1.06 * p], [s * 0.1, 0.1 - 0.3 * p, 0], { bevel: 0.03 });
  root.box("accent", [0.04, 0.22 * p, 0.55 * p], [s * (0.1 + 0.38 * p), 0.15, 0], { bevel: 0.01 });

  const pivot = root.child("joint.pivot", [s * 0.15, 0, 0]);
  pivot.cyl("dark", { r: 0.22, h: 0.5 * b, axis: "x", sides: 12 }, [0, 0, 0]);
  pivot.box("secondary", [0.45 * b, 0.9, 0.5 * b], [0, -0.55, 0], { bevel: 0.07 });
  pivot.cyl("metal", { r: 0.055, h: 0.65, sides: 8 }, [0, -0.55, -0.28 * b]);
  pivot.cyl("dark", { r: 0.2, h: 0.5 * b, axis: "x", sides: 12 }, [0, -1.0, 0.1]);

  const forearm = root.child("joint.forearm", [s * 0.15, -1.0, 0.1]);
  forearm.box("primary", [0.5 * b, 0.5 * b, 0.95], [0, 0, 0.4], { bevel: 0.08 });
  forearm.box("secondary", [0.42 * b, 0.1, 0.75], [0, 0.27 * b, 0.42], { bevel: 0.03 });
  for (let i = 0; i < 3; i++) forearm.box("dark", [0.04, 0.05, 0.4], [s * 0.26 * b, 0.1 - i * 0.1, 0.35], { bevel: 0.01 });
  forearm.box("dark", [0.4 * b, 0.4 * b, 0.15], [0, 0, 0.9], { bevel: 0.04 });
  return root;
}

/** Thruster pack on the upper back. Joints jet_l/r carry the nozzles; vent flaps open with thrust. */
function backpack({ bulk: b }) {
  const root = new Node("backpack");
  root.box("secondary", [1.5 * b, 1.1, 0.6], [0, 0.1, -0.3], { bevel: 0.1 });
  root.box("primary", [1.3 * b, 0.8, 0.12], [0, 0.2, -0.62], { bevel: 0.04 });
  for (let i = 0; i < 4; i++) root.box("dark", [1.0 * b, 0.04, 0.06], [0, 0.0 + i * 0.12, -0.7], { bevel: 0.01 });
  for (const s of SIDES) {
    root.box("dark", [0.42 * b, 0.06, 0.38], [s * 0.4 * b, 0.66, -0.3], { bevel: 0.01 });
    const flap = root.child(`flap_${sideName(s)}`, [s * 0.4 * b, 0.68, -0.49]);
    flap.box("primary", [0.44 * b, 0.05, 0.4], [0, 0, 0.19], { bevel: 0.015 });
  }
  if (b < 0.9) {
    for (const s of SIDES) root.box("primary", [0.08, 1.5, 0.55], [s * 0.75, 0.55, -0.55], { bevel: 0.03, rot: [-0.35, 0, -s * 0.45] });
  }
  for (const s of SIDES) {
    const jet = root.child(`joint.jet_${sideName(s)}`, [s * 0.45 * b, -0.45, -0.45]);
    jet.cyl("metal", { r: 0.25, rTop: 0.17, h: 0.5, sides: 14 }, [0, -0.25, 0]);
    jet.cyl("secondary", { r: 0.2, h: 0.1, sides: 14 }, [0, -0.02, 0]);
    jet.cyl("dark", { r: 0.2, h: 0.04, sides: 14 }, [0, -0.49, 0]);
  }
  return root;
}

/** The vent flaps lift as thrust rises: `pose.thrust` is scrubbed by the thruster level. */
function backpackClips() {
  const open = eulerToQuat([-0.9, 0, 0]);
  return [
    {
      name: "pose.thrust",
      channels: ["flap_l", "flap_r"].map((node) => ({ node, path: "rotation", times: [0, 1], values: [0, 0, 0, 1, ...open] })),
    },
  ];
}

/** Weapon held in the hand: origin at the grip, barrel along +Z, muzzle where the procedural one is. */
function weapon(shape) {
  const root = new Node(`weapon-${shape}`);
  root.box("dark", [0.2, 0.35, 0.22], [0, -0.22, 0.05], { bevel: 0.04, rot: [0.25, 0, 0] });
  if (shape === "rifle") {
    root.box("metal", [0.35, 0.42, 1.3], [0, 0, 0.35], { bevel: 0.05 });
    root.box("secondary", [0.28, 0.12, 0.9], [0, 0.26, 0.3], { bevel: 0.03 });
    root.box("dark", [0.12, 0.12, 0.4], [0, 0.38, 0.2], { bevel: 0.02 });
    root.box("accent", [0.08, 0.08, 0.03], [0, 0.38, 0.41], { bevel: 0.01 });
    root.box("metal", [0.24, 0.24, 0.6], [0, 0.05, 1.15], { bevel: 0.03 });
    root.cyl("secondary", { r: 0.08, h: 1.3, axis: "z", sides: 10 }, [0, 0.05, 1.7]);
    root.box("dark", [0.22, 0.2, 0.2], [0, 0.05, 2.32], { bevel: 0.03 });
    root.box("dark", [0.18, 0.35, 0.25], [0, -0.32, 0.55], { bevel: 0.03, rot: [0.2, 0, 0] });
  } else if (shape === "emitter") {
    root.box("metal", [0.4, 0.5, 1.1], [0, 0, 0.3], { bevel: 0.06 });
    root.box("dark", [0.26, 0.3, 0.5], [0, -0.3, 0.3], { bevel: 0.04 });
    root.cyl("secondary", { r: 0.11, rTop: 0.07, h: 1.7, axis: "z", sides: 12 }, [0, 0.05, 1.6]);
    for (const z of [1.0, 1.35, 1.7]) root.cyl("accent", { r: 0.15, h: 0.05, axis: "z", sides: 12 }, [0, 0.05, z]);
    root.box("dark", [0.34, 0.34, 0.1], [0, 0.05, 2.38], { bevel: 0.03 });
    root.box("accent", [0.26, 0.26, 0.08], [0, 0.05, 2.45], { bevel: 0.03 });
  } else if (shape === "scatter") {
    root.box("metal", [0.45, 0.5, 1.1], [0, 0, 0.3], { bevel: 0.06 });
    root.box("secondary", [0.7, 0.4, 0.7], [0, 0.05, 1.15], { bevel: 0.07 });
    for (const x of [-0.2, 0, 0.2]) root.cyl("dark", { r: 0.09, h: 0.06, axis: "z", sides: 10 }, [x, 0.05, 1.51]);
    root.box("dark", [0.3, 0.18, 0.4], [0, -0.3, 0.8], { bevel: 0.03 });
    root.box("metal", [0.74, 0.06, 0.5], [0, 0.27, 1.1], { bevel: 0.02 });
  } else {
    root.box("metal", [0.6, 0.6, 1.5], [0, 0.05, 0.5], { bevel: 0.07 });
    root.box("secondary", [0.5, 0.5, 0.3], [0, 0.05, 1.4], { bevel: 0.05 });
    for (const x of [-0.12, 0.12]) for (const y of [-0.07, 0.17]) root.cyl("dark", { r: 0.09, h: 0.06, axis: "z", sides: 10 }, [x, y, 1.56]);
    for (const s of SIDES) root.box("dark", [0.06, 0.12, 1.2], [s * 0.32, 0.05, 0.5], { bevel: 0.02 });
    root.box("accent", [0.1, 0.06, 0.03], [0.18, 0.37, 1.2], { bevel: 0.01 });
  }
  return root;
}

const MODELS = {};
for (const [id, frame] of Object.entries(FRAMES)) {
  MODELS[`${id}-legs`] = () => [legs(frame)];
  MODELS[`${id}-torso`] = () => [torso(frame)];
  MODELS[`${id}-head`] = () => [head(frame)];
  MODELS[`${id}-armL`] = () => [arm(frame, -1)];
  MODELS[`${id}-armR`] = () => [arm(frame, 1)];
  MODELS[`${id}-backpack`] = () => [backpack(frame), backpackClips()];
}
for (const shape of ["rifle", "launcher", "emitter", "scatter"]) MODELS[`weapon-${shape}`] = () => [weapon(shape)];

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, build] of Object.entries(MODELS)) {
  const [node, clips] = build();
  const glb = writeGlb(node, MATERIALS, clips);
  writeFileSync(`${OUT}/${name}.glb`, glb);
  total += glb.byteLength;
}
// Credit every generated file in the attribution table, between its markers.
const CREDITS = `${OUT}/ATTRIBUTION.md`;
const rows = Object.keys(MODELS).map((name) => `| ${name}.glb | Generated by \`scripts/make-models.mjs\` in this repository | Robot Game project | Same as the project |`);
writeFileSync(
  CREDITS,
  readFileSync(CREDITS, "utf8").replace(/(<!-- generated:start -->\n)[\s\S]*?(<!-- generated:end -->)/, `$1${rows.join("\n")}\n$2`),
);
console.log(`${Object.keys(MODELS).length} models, ${(total / 1024).toFixed(0)} KB in ${OUT}/`);
