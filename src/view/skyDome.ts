import { Color3, MeshBuilder, ShaderMaterial, type Mesh, type Scene } from "../babylon";

const VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec3 vDir;
uniform vec3 horizon;
uniform vec3 zenith;
uniform float stars;
void main(void) {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 c = mix(horizon, zenith, pow(h, 0.6));
  if (stars > 0.0) {
    vec3 cell = floor(d * 320.0);
    float n = fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
    float star = step(0.9975, n) * (0.5 + 0.5 * fract(n * 911.0));
    c += vec3(star * stars * smoothstep(0.03, 0.25, h));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * A gradient sky with stars, around the camera at any distance. Its horizon is the fog colour, so
 * far terrain fades into it; without it (Low quality) the sky is the plain clear colour.
 */
export class SkyDome {
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly horizon = new Color3();
  private readonly zenith = new Color3();

  constructor(scene: Scene) {
    this.material = new ShaderMaterial(
      "skyDome",
      scene,
      { vertexSource: VERTEX, fragmentSource: FRAGMENT },
      { attributes: ["position"], uniforms: ["worldViewProjection", "horizon", "zenith", "stars"] },
    );
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.mesh = MeshBuilder.CreateSphere("skyDome", { diameter: 3000, segments: 16 }, scene);
    this.mesh.material = this.material;
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.renderingGroupId = 0;
  }

  set enabled(on: boolean) {
    this.mesh.setEnabled(on);
  }

  /** `horizon` is the fog colour; `zenith` multiplies it overhead. */
  update(horizon: { r: number; g: number; b: number }, zenith: readonly [number, number, number], stars: number): void {
    this.horizon.set(horizon.r, horizon.g, horizon.b);
    this.zenith.set(horizon.r * zenith[0], horizon.g * zenith[1], horizon.b * zenith[2]);
    this.material.setColor3("horizon", this.horizon);
    this.material.setColor3("zenith", this.zenith);
    this.material.setFloat("stars", stars);
  }
}
