// A tiny glTF 2.0 (.glb) writer for hard-surface parts built from bevelled boxes and cylinders.
// No dependencies. Shapes are given in game (Babylon, left-handed) coordinates: +Y up, +Z
// forward, +X right. They are written in glTF's right-handed space by mirroring X, which
// Babylon's loader mirrors back, so a part comes out exactly as described here.

/** A node in the part: holds geometry by material, child nodes and an optional rotation. */
export class Node {
  constructor(name, at = [0, 0, 0]) {
    this.name = name;
    this.at = at;
    /** Euler angles in radians, applied X then Y then Z. */
    this.rot = null;
    this.children = [];
    /** material name -> flat list of polygons: { points: [[x,y,z]...], normal: [x,y,z] } */
    this.polys = new Map();
  }

  child(name, at = [0, 0, 0]) {
    const n = new Node(name, at);
    this.children.push(n);
    return n;
  }

  /** An empty node other parts attach to; the game looks these up by name. */
  attach(name, at) {
    return this.child(`att.${name}`, at);
  }

  add(mat, polys) {
    if (!this.polys.has(mat)) this.polys.set(mat, []);
    this.polys.get(mat).push(...polys);
    return this;
  }

  /** A box with bevelled edges. `size` is full width, height and depth. */
  box(mat, size, at, opts = {}) {
    return this.add(mat, transform(bevelBox(size, opts.bevel ?? 0.05), at, opts.rot));
  }

  /** A cylinder (or cone) along an axis: `r` bottom and `rTop` top radius. */
  cyl(mat, { r, rTop = r, h, sides = 12, axis = "y" }, at, opts = {}) {
    const rot = axisRotation(axis, opts.rot);
    return this.add(mat, transform(cylinder(r, rTop, h, sides), at, rot));
  }

  /** A wedge: a box whose top face is pulled back by `slope` metres at the front. */
  wedge(mat, size, at, slope, opts = {}) {
    return this.add(mat, transform(wedge(size, slope), at, opts.rot));
  }
}

// ---------- Shapes (polygons in local space, convex, any winding) ----------

function bevelBox([w, h, d], bevel) {
  const half = [w / 2, h / 2, d / 2];
  const r = Math.min(bevel, ...half.map((v) => v * 0.45));
  if (r <= 0) return plainBox(half);
  // Each corner is cut into three points, one on each face that meets there.
  const corner = (sx, sy, sz, axis) => {
    const p = [sx * (half[0] - r), sy * (half[1] - r), sz * (half[2] - r)];
    p[axis] = [sx, sy, sz][axis] * half[axis];
    return p;
  };
  const signs = [-1, 1];
  const polys = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const s of signs) {
      const pts = [];
      for (const a of signs) for (const b of signs) {
        const c = [0, 0, 0];
        c[axis] = s;
        c[(axis + 1) % 3] = a;
        c[(axis + 2) % 3] = b;
        pts.push(corner(c[0], c[1], c[2], axis));
      }
      const n = [0, 0, 0];
      n[axis] = s;
      polys.push({ points: pts, normal: n });
    }
  }
  // Edge strips: between face `a` and face `b` (axes), along the third axis.
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const along = 3 - a - b;
    for (const sa of signs) for (const sb of signs) {
      const pts = [];
      for (const t of signs) {
        const c = [0, 0, 0];
        c[a] = sa;
        c[b] = sb;
        c[along] = t;
        pts.push(corner(c[0], c[1], c[2], a), corner(c[0], c[1], c[2], b));
      }
      const n = [0, 0, 0];
      n[a] = sa;
      n[b] = sb;
      polys.push({ points: pts, normal: normalize(n) });
    }
  }
  for (const sx of signs) for (const sy of signs) for (const sz of signs) {
    polys.push({ points: [0, 1, 2].map((axis) => corner(sx, sy, sz, axis)), normal: normalize([sx, sy, sz]) });
  }
  return polys;
}

function plainBox(half) {
  const polys = [];
  for (let axis = 0; axis < 3; axis++) for (const s of [-1, 1]) {
    const pts = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const p = [0, 0, 0];
      p[axis] = s * half[axis];
      p[(axis + 1) % 3] = a * half[(axis + 1) % 3];
      p[(axis + 2) % 3] = b * half[(axis + 2) % 3];
      pts.push(p);
    }
    const n = [0, 0, 0];
    n[axis] = s;
    polys.push({ points: pts, normal: n });
  }
  return polys;
}

function wedge([w, h, d], slope) {
  const x = w / 2, y = h / 2, z = d / 2;
  const top = z - slope;
  const v = {
    lbb: [-x, -y, -z], rbb: [x, -y, -z], lbf: [-x, -y, z], rbf: [x, -y, z],
    ltb: [-x, y, -z], rtb: [x, y, -z], ltf: [-x, y, top], rtf: [x, y, top],
  };
  const front = normalize([0, slope, h]);
  return [
    { points: [v.lbb, v.rbb, v.rbf, v.lbf], normal: [0, -1, 0] },
    { points: [v.ltb, v.rtb, v.rtf, v.ltf], normal: [0, 1, 0] },
    { points: [v.lbb, v.rbb, v.rtb, v.ltb], normal: [0, 0, -1] },
    { points: [v.lbf, v.rbf, v.rtf, v.ltf], normal: front },
    { points: [v.lbb, v.lbf, v.ltf, v.ltb], normal: [-1, 0, 0] },
    { points: [v.rbb, v.rbf, v.rtf, v.rtb], normal: [1, 0, 0] },
  ];
}

function cylinder(r, rTop, h, sides) {
  const polys = [];
  const ring = (radius, y) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [Math.cos(a) * radius, y, Math.sin(a) * radius];
  });
  const bottom = ring(r, -h / 2);
  const top = ring(rTop, h / 2);
  const flare = (r - rTop) / h;
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    const pts = [bottom[i], bottom[j], top[j], top[i]].filter((p, k, all) => all.findIndex((q) => dist(p, q) < 1e-6) === k);
    if (pts.length >= 3) polys.push({ points: pts, normal: normalize([Math.cos(a), flare, Math.sin(a)]) });
  }
  if (r > 0) polys.push({ points: bottom, normal: [0, -1, 0] });
  if (rTop > 0) polys.push({ points: top, normal: [0, 1, 0] });
  return polys;
}

function axisRotation(axis, extra) {
  const base = axis === "x" ? [0, 0, Math.PI / 2] : axis === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  if (!extra) return base;
  return [base[0] + extra[0], base[1] + extra[1], base[2] + extra[2]];
}

// ---------- Vector helpers ----------

function normalize(v) {
  const l = Math.hypot(...v) || 1;
  return v.map((c) => c / l);
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a, b) => Math.hypot(...sub(a, b));

function rotate(p, rot) {
  if (!rot) return p;
  let [x, y, z] = p;
  const [rx, ry, rz] = rot;
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x, y, z];
}

function transform(polys, at, rot) {
  return polys.map(({ points, normal }) => ({
    points: points.map((p) => {
      const q = rotate(p, rot);
      return [q[0] + at[0], q[1] + at[1], q[2] + at[2]];
    }),
    normal: rotate(normal, rot),
  }));
}

// ---------- Triangulation ----------

/** Mirror into glTF space and fan-triangulate, counter-clockwise about the face normal. */
function triangulate(polys) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (const poly of polys) {
    const n = [-poly.normal[0], poly.normal[1], poly.normal[2]];
    const pts = poly.points.map((p) => [-p[0], p[1], p[2]]);
    const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = normalize(cross(ref, n));
    const v = cross(n, u);
    pts.sort((a, b) => Math.atan2(dot(sub(a, c), v), dot(sub(a, c), u)) - Math.atan2(dot(sub(b, c), v), dot(sub(b, c), u)));
    // Planar UVs in metres on the face's dominant plane, so a tiling surface texture keeps its scale.
    const ax = Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2]) ? 0 : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
    const [ua, va] = ax === 0 ? [2, 1] : ax === 1 ? [0, 2] : [0, 1];
    const base = pos.length / 3;
    for (const p of pts) {
      pos.push(...p);
      nrm.push(...n);
      uv.push(p[ua], -p[va]);
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const tri = [base, base + i, base + i + 1];
      const [a, b, cc] = tri.map((k) => pos.slice(k * 3, k * 3 + 3));
      if (dot(cross(sub(b, a), sub(cc, a)), n) < 0) tri.reverse();
      idx.push(...tri);
    }
  }
  return { pos, nrm, uv, idx };
}

// ---------- GLB writer ----------

/**
 * Write a part to a GLB buffer.
 * `materials`: name -> { color: [r,g,b], metallic, roughness, emissive?: [r,g,b] }.
 * `animations`: [{ name, channels: [{ node, path: "rotation"|"translation", times, values }] }],
 * values flat (4 per key for rotation quaternions in game space, 3 for translation).
 */
export function writeGlb(rootNode, materials, animations = []) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [], accessors = [];
  const pushData = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      byteLength += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const accessor = (typed, type, componentType, target, minMax = false) => {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: pushData(typed, target), componentType, count: typed.length / size, type };
    if (minMax) {
      acc.min = Array.from({ length: size }, (_, k) => Math.min(...Array.from({ length: acc.count }, (_, i) => typed[i * size + k])));
      acc.max = Array.from({ length: size }, (_, k) => Math.max(...Array.from({ length: acc.count }, (_, i) => typed[i * size + k])));
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const matNames = Object.keys(materials);
  const gltfMaterials = matNames.map((name) => {
    const m = materials[name];
    return {
      name,
      pbrMetallicRoughness: { baseColorFactor: [...m.color, 1], metallicFactor: m.metallic ?? 0.3, roughnessFactor: m.roughness ?? 0.6 },
      ...(m.emissive ? { emissiveFactor: m.emissive } : {}),
    };
  });

  const nodes = [], meshes = [];
  const nodeIndex = new Map();
  const visit = (node) => {
    const index = nodes.length;
    const out = { name: node.name };
    nodes.push(out);
    nodeIndex.set(node.name, index);
    if (node.at.some((v) => v !== 0)) out.translation = [-node.at[0], node.at[1], node.at[2]];
    if (node.rot) out.rotation = mirrorQuat(eulerToQuat(node.rot));
    if (node.polys.size) {
      const primitives = [];
      for (const [mat, polys] of node.polys) {
        if (!(mat in materials)) throw new Error(`unknown material ${mat} on ${node.name}`);
        const g = triangulate(polys);
        const big = g.pos.length / 3 > 65535;
        primitives.push({
          attributes: {
            POSITION: accessor(new Float32Array(g.pos), "VEC3", 5126, 34962, true),
            NORMAL: accessor(new Float32Array(g.nrm), "VEC3", 5126, 34962),
            TEXCOORD_0: accessor(new Float32Array(g.uv), "VEC2", 5126, 34962),
          },
          indices: accessor(big ? new Uint32Array(g.idx) : new Uint16Array(g.idx), "SCALAR", big ? 5125 : 5123, 34963),
          material: matNames.indexOf(mat),
        });
      }
      meshes.push({ name: node.name, primitives });
      out.mesh = meshes.length - 1;
    }
    if (node.children.length) out.children = node.children.map(visit);
    return index;
  };
  visit(rootNode);

  const gltfAnimations = animations.map((anim) => {
    const samplers = [], channels = [];
    for (const ch of anim.channels) {
      const node = nodeIndex.get(ch.node);
      if (node === undefined) throw new Error(`animation ${anim.name} targets unknown node ${ch.node}`);
      const values = ch.path === "rotation" ? quatsToGltf(ch.values) : translationsToGltf(ch.values);
      samplers.push({
        input: accessor(new Float32Array(ch.times), "SCALAR", 5126, undefined, true),
        output: accessor(new Float32Array(values), ch.path === "rotation" ? "VEC4" : "VEC3", 5126),
        interpolation: "LINEAR",
      });
      channels.push({ sampler: samplers.length - 1, target: { node, path: ch.path } });
    }
    return { name: anim.name, samplers, channels };
  });

  const json = {
    asset: { version: "2.0", generator: "robot-game scripts/models" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials: gltfMaterials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
    ...(gltfAnimations.length ? { animations: gltfAnimations } : {}),
  };
  const bin = new Uint8Array(byteLength + ((4 - (byteLength % 4)) % 4));
  let offset = 0;
  for (const c of chunks) {
    bin.set(c, offset);
    offset += c.byteLength;
  }
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  jsonBytes = Uint8Array.from([...jsonBytes, ...Array(jsonPad).fill(0x20)]);

  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  view.setUint32(binStart, bin.length, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  out.set(bin, binStart + 8);
  return out;
}

/** Euler X then Y then Z (as `rotate` applies them) to a quaternion [x, y, z, w]. */
export function eulerToQuat([rx, ry, rz]) {
  const q = (axis, a) => {
    const s = Math.sin(a / 2);
    return [axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0, Math.cos(a / 2)];
  };
  // Applied X first, so the product is Z * Y * X.
  return mul(mul(q(2, rz), q(1, ry)), q(0, rx));
}

function mul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** A rotation in game space, expressed in X-mirrored glTF space. */
function mirrorQuat([x, y, z, w]) {
  return [x, -y, -z, w];
}

function quatsToGltf(values) {
  const out = [];
  for (let i = 0; i < values.length; i += 4) out.push(...mirrorQuat(values.slice(i, i + 4)));
  return out;
}

function translationsToGltf(values) {
  const out = [];
  for (let i = 0; i < values.length; i += 3) out.push(-values[i], values[i + 1], values[i + 2]);
  return out;
}
