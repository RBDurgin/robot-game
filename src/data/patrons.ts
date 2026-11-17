import type { PatronDef, PatronTerms } from "../sim/patron";
import { REPUTATION } from "./war";

/**
 * The three who want the Carrier and will pay the player to reach it for them (see
 * `docs/story-outline.md`). The Combine makes no offer.
 */
export const PATRONS: PatronDef[] = [
  {
    faction: "drifters",
    name: "Ojo Brandt",
    speaker: "Brandt",
    role: "Quartermaster, Drifter Compact",
    motto: "Keep the lights on.",
    offer: [
      "You heard it and so did I. A reactor that size, still running. Do you know what the Compact burns to keep four settlements warm through a winter?",
      "Get us into that ship and we tie it to the grid. No speeches. People stop freezing. You fly out of our yard already; fly for it.",
    ],
    scrapRate: 1,
    standingPay: 8,
  },
  {
    faction: "wardens",
    name: "Captain Brenna Sorrel",
    speaker: "Sorrel",
    role: "Captain, Greywall Wardens",
    motto: "Some doors stay shut.",
    offer: [
      "That hull was built for a war that ended the world once. Whatever is awake in there has been waiting to hand it to somebody.",
      "I want it handed to nobody. Help my engineers reach it and we seal it, and the Wardens stand watch on the door. You will be paid fairly, and you will sleep better.",
    ],
    scrapRate: 1,
    standingPay: 8,
  },
  {
    faction: "syndicate",
    name: "Lys",
    speaker: "Lys",
    role: "Broker, Emberline Syndicate",
    motto: "Everything has a buyer.",
    offer: [
      "Magpie. You have cost my associates several suits this week, and I am calling anyway, which should tell you what that ship is worth.",
      "I have buyers. You have a head start. Bring me the Carrier and you take a tenth of the sale; the unpleasantness at the Needle is forgotten the moment you say yes.",
    ],
    // Business is business: the Syndicate's raiders shoot at the player, and its broker still calls.
    always: true,
    scrapRate: 1.6,
    standingPay: 4,
  },
];

/** When the offers are made and what taking one does to the player's standing. */
export const PATRON_OFFER: PatronTerms & { after: string } = {
  /** The mission that must be done first. */
  after: "the-needle",
  gain: 25,
  loss: -10,
  // The patron's pilots fight beside the player from here on.
  floor: REPUTATION.alliedAt,
};

export const patronOf = (faction: string | null): PatronDef | null => PATRONS.find((p) => p.faction === faction) ?? null;
