/** Tuning for contracts: repeatable work the factions offer, generated from the state of the war (`src/sim/contracts.ts`). */
export const CONTRACTS = {
  /** Contracts on the board at once, at most. */
  max: 3,
  /** War ticks before the board turns over to other work. */
  refreshTicks: 72,
  /** Pay is multiplied by this for the danger (1 to 3) of the region the work is in. */
  dangerPay: [1, 1, 1.4, 1.8],
  raid: {
    /** Scrap per defender at the site when the contract was posted. */
    scrapPerPilot: 45,
    standing: 6,
  },
  defend: {
    scrap: 220,
    standing: 8,
    /** Leaving this many metres from the site fails the contract. */
    radius: 260,
    /** How far out the attackers appear, metres. */
    distance: 320,
  },
};
