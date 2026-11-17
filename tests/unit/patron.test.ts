import { describe, expect, it } from "vitest";
import { PATRON_OFFER, PATRONS } from "../../src/data/patrons";
import { REPUTATION } from "../../src/data/war";
import { patronsOffering, takePatron } from "../../src/sim/patron";
import { attitudeOf, startingStanding } from "../../src/sim/reputation";
import { parseSave } from "../../src/game/save";

const factions = (standing = startingStanding()) => patronsOffering(PATRONS, standing).map((p) => p.faction);

describe("patrons", () => {
  it("offer when their faction is not hostile; the Syndicate's broker always does", () => {
    expect(factions()).toEqual(["drifters", "wardens", "syndicate"]);
    expect(factions({ ...startingStanding(), wardens: REPUTATION.hostileAt })).toEqual(["drifters", "syndicate"]);
    expect(factions({ ...startingStanding(), syndicate: REPUTATION.min })).toContain("syndicate");
  });

  it("always leave someone to work for", () => {
    const hated = { ...startingStanding(), drifters: -90, wardens: -60, syndicate: -80 };
    expect(patronsOffering(PATRONS.filter((p) => !p.always), hated).map((p) => p.faction)).toEqual(["wardens"]);
  });

  it("taking one makes an ally of them and costs standing with the others who asked", () => {
    const standing = { ...startingStanding(), wardens: 10, syndicate: -80 };
    const before = { ...standing };
    takePatron(standing, patronsOffering(PATRONS, standing), "syndicate", PATRON_OFFER);
    expect(attitudeOf(standing, "syndicate")).toBe("allied");
    expect(standing.drifters).toBe(before.drifters + PATRON_OFFER.loss);
    expect(standing.wardens).toBe(before.wardens + PATRON_OFFER.loss);
    expect(standing.combine).toBe(before.combine);

    // Someone already well thought of gains the usual amount; one who made no offer loses nothing.
    const friend = { ...startingStanding(), wardens: REPUTATION.hostileAt };
    takePatron(friend, patronsOffering(PATRONS, friend), "drifters", PATRON_OFFER);
    expect(friend.drifters).toBe(startingStanding().drifters + PATRON_OFFER.gain);
    expect(friend.wardens).toBe(REPUTATION.hostileAt);
  });

  it("is kept in the save, with the missions only that patron gives", () => {
    const missions = { done: ["first-outpost", "listening-post", "the-needle", "dead-reckoning"], active: null, patron: "wardens" };
    expect(parseSave({ version: 5, missions }).missions).toEqual({ ...missions, contract: null });
    // Without a patron (or with a faction that makes no offer) there are no such missions.
    expect(parseSave({ version: 5, missions: { ...missions, patron: "combine" } }).missions).toEqual({ done: missions.done.slice(0, 3), active: null, patron: null, contract: null });
    expect(parseSave({ version: 4, missions: { done: ["first-outpost"], active: null } }).missions.patron).toBeNull();
  });
});
