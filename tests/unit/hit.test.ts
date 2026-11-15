import { describe, expect, it } from "vitest";
import { FRAMES } from "../../src/data/frames";
import { raycastMech, splashSection } from "../../src/sim/hit";

const frame = FRAMES.medium;
const feet = { x: 10, y: 5, z: 20 };
const none = () => false;

describe("raycastMech", () => {
  it("hits the torso from the front at chest height", () => {
    const hit = raycastMech({ x: 10, y: 8.5, z: 60 }, { x: 0, y: 0, z: -1 }, 100, feet, 0, frame, none);
    expect(hit?.section).toBe("torso");
    expect(hit!.distance).toBeCloseTo(60 - 20 - 0.9, 3);
  });

  it("hits the legs low down", () => {
    const hit = raycastMech({ x: 10, y: 6, z: 60 }, { x: 0, y: 0, z: -1 }, 100, feet, 0, frame, none);
    expect(hit?.section).toBe("legs");
  });

  it("left arm is on the mech's own left, whichever way it faces", () => {
    // Facing +Z: the left arm is at -X.
    expect(raycastMech({ x: 8.5, y: 8.2, z: 60 }, { x: 0, y: 0, z: -1 }, 100, feet, 0, frame, none)?.section).toBe("armL");
    // Turned to face +X (yaw 90 degrees): the left arm is now at +Z.
    expect(raycastMech({ x: 60, y: 8.2, z: 21.5 }, { x: -1, y: 0, z: 0 }, 100, feet, Math.PI / 2, frame, none)?.section).toBe("armL");
  });

  it("shots pass through a destroyed arm", () => {
    const hit = raycastMech({ x: 8.5, y: 8.2, z: 60 }, { x: 0, y: 0, z: -1 }, 100, feet, 0, frame, (s) => s === "armL");
    expect(hit).toBeNull();
  });

  it("misses when aimed wide, too short, or pointing away", () => {
    expect(raycastMech({ x: 20, y: 8, z: 60 }, { x: 0, y: 0, z: -1 }, 100, feet, 0, frame, none)).toBeNull();
    expect(raycastMech({ x: 10, y: 8, z: 60 }, { x: 0, y: 0, z: -1 }, 20, feet, 0, frame, none)).toBeNull();
    expect(raycastMech({ x: 10, y: 8, z: 60 }, { x: 0, y: 0, z: 1 }, 100, feet, 0, frame, none)).toBeNull();
  });

  it("low explosions hit legs, high ones hit the torso", () => {
    expect(splashSection({ x: 10, y: 5.5, z: 20 }, feet, frame)).toBe("legs");
    expect(splashSection({ x: 10, y: 8.5, z: 20 }, feet, frame)).toBe("torso");
  });
});
