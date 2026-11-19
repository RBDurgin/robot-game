import type { WarFactionId } from "./factions";
import { patronOf } from "./patrons";
import { BASE_PLACE, type Action, type Condition, type Line, type MissionDef } from "../sim/mission";
import type { ItemSpec } from "../sim/items";
import type { PatronDef } from "../sim/patron";

/** The voices on the radio. The player is Magpie. */
const hale = (text: string): Line => ({ speaker: "Hale", text });
const magpie = (text: string): Line => ({ speaker: "Magpie", text });
const varga = (text: string): Line => ({ speaker: "Varga", text });

/**
 * The first half of the campaign in `docs/story-outline.md`, in the order it is offered: the
 * missions everyone plays, before choosing a patron. The rest are in `patronMissions`.
 * A mission is written entirely here: see `MissionDef` in `src/sim/mission.ts` for what a stage
 * can wait for and do. A unit test checks every place, site, squad and stage these refer to.
 */
export const MISSIONS: MissionDef[] = [
  {
    id: "first-outpost",
    title: "Clear Signal",
    type: "assault",
    requires: [],
    auto: true,
    replayable: true,
    stages: [
      // Training: the controls, taught at home before the first fight. Played once, by a new
      // pilot; a replay or a player with any mission done starts at "assault". Keys are written
      // as {key:action} so prompts follow the player's bindings.
      {
        id: "t-move",
        training: true,
        objective: "Walk the suit: {key:forward} {key:left} {key:back} {key:right} to move, the mouse to look",
        goals: [{ when: "did", act: "move", count: 6 }],
        enter: [
          {
            do: "say",
            lines: [
              hale("Magpie, Hale. The suit's been in pieces for a month. Before you take it anywhere, walk it round the yard for me."),
              hale("{key:forward} {key:left} {key:back} {key:right} to walk, the mouse to look. The legs follow where you look."),
            ],
          },
        ],
      },
      {
        id: "t-sprint",
        training: true,
        objective: "Sprint: {key:sprint} while moving",
        goals: [{ when: "did", act: "sprint", count: 6 }],
        enter: [{ do: "say", lines: [hale("Legs are good. Open it up: {key:sprint} to sprint. It costs nothing but noise.")] }],
      },
      {
        id: "t-jets",
        training: true,
        objective: "Jump with {key:jump}, and keep holding it in the air for jump jets",
        goals: [{ when: "did", act: "jets" }],
        enter: [
          {
            do: "say",
            lines: [hale("Jets. {key:jump} jumps; keep holding it and the jets carry you. They run on energy, the blue bar. Let it refill on the ground.")],
          },
        ],
      },
      {
        id: "t-boost",
        training: true,
        objective: "Boost dash: {key:boost} while moving, {left} more",
        goals: [{ when: "did", act: "boost", count: 2 }],
        enter: [{ do: "say", lines: [hale("Now the dash: {key:boost} while you move throws the suit sideways, out of a line of fire. Twice, so I know it's not a fluke.")] }],
      },
      {
        id: "t-fire",
        training: true,
        objective: "Fire your weapons: {key:firePrimary} for the right arm, {key:fireSecondary} for the left",
        goals: [{ when: "did", act: "fire", count: 8 }],
        enter: [{ do: "say", lines: [hale("Weapons. {key:firePrimary} fires the right arm, {key:fireSecondary} the left. Put a few rounds into the hillside; it won't mind.")] }],
      },
      {
        id: "t-heat",
        training: true,
        objective: "Keep firing until the heat warning shows",
        goals: [{ when: "did", act: "heatWarning" }],
        enter: [
          {
            do: "say",
            lines: [
              hale("Every shot heats the suit: the orange bar. Fill it and the weapons lock until it cools, and that is not a thing you want in a fight."),
              hale("Find the warning now, while nobody is shooting back. Hold both triggers."),
            ],
          },
        ],
      },
      {
        id: "t-hangar",
        training: true,
        objective: "Open the hangar with {key:hangar}",
        waypoint: { place: BASE_PLACE, label: "BASE" },
        goals: [{ when: "did", act: "hangar" }],
        enter: [
          {
            do: "say",
            lines: [
              hale("That's the line. Let go and it bleeds off."),
              hale("Last thing. At any base we hold, {key:hangar} opens the hangar: repairs, and parts off what you salvage. Have a look, then deploy."),
            ],
          },
        ],
      },
      {
        id: "assault",
        objective: "Clear the Combine outpost: {left} hostile{s} remaining",
        waypoint: { place: "kestrel-outpost", label: "OUTPOST" },
        enter: [
          {
            do: "say",
            lines: [hale("Magpie, Hale. The Kestrel outpost is sitting on our frequencies again. I can't hear a thing past the basin."), magpie("I'll go and switch it off.")],
          },
        ],
        goals: [{ when: "siteCleared", site: "kestrel-outpost" }],
      },
      {
        id: "return",
        objective: "Outpost cleared. Return to base{salvage}",
        waypoint: { place: BASE_PLACE, label: "BASE" },
        enter: [
          { do: "notify", text: "Outpost cleared! Collect salvage and return to base.", seconds: 6 },
          {
            do: "say",
            lines: [hale("Jammer's down. Hold on. There's something else on the band, and it isn't theirs."), hale("Come home. I want you to hear this.")],
          },
        ],
        goals: [{ when: "inArea", place: BASE_PLACE }],
      },
    ],
    debrief: {
      title: "Outpost cleared",
      text: "The Combine garrison is destroyed and you made it home. With the jammer gone, Hale has picked up a transmission that should not exist: the Listening Dish is sending.",
    },
    reward: { scrap: 0 },
  },
  {
    id: "listening-post",
    title: "Listening Post",
    type: "recon",
    requires: ["first-outpost"],
    briefing: {
      from: "Tamsin Hale, Drifters' Rest",
      text: [
        "The Listening Dish has been dead longer than either of us has been alive. As of this morning it is transmitting, on a band nobody uses.",
        "Go out to the north-west and tag the three relay masts around it, so I can read what it is sending. The Combine have a survey team on the site already. Whether you go round them or through them is your business.",
      ],
    },
    places: {
      "dish-ground": { x: -1250, z: -1500, radius: 420 },
      "mast-1": { x: -1140, z: -1450, radius: 22 },
      "mast-2": { x: -1330, z: -1400, radius: 22 },
      "mast-3": { x: -1290, z: -1620, radius: 22 },
    },
    stages: [
      {
        id: "travel",
        objective: "Go to the Listening Dish",
        waypoint: { place: "listening-dish", label: "DISH" },
        enter: [{ do: "spawn", tag: "survey", faction: "combine", members: ["line", "marksman", "scout"], at: "listening-dish" }],
        goals: [{ when: "inArea", place: "dish-ground" }],
      },
      {
        id: "mast-1",
        objective: "Tag the relay masts: 1 of 3",
        waypoint: { place: "mast-1", label: "MAST" },
        enter: [{ do: "say", lines: [hale("That's the Dish. Three masts around it. Get close to each and I'll do the rest."), magpie("Company on the site. Combine colours.")] }],
        goals: [{ when: "inArea", place: "mast-1" }],
      },
      {
        id: "mast-2",
        objective: "Tag the relay masts: 2 of 3",
        waypoint: { place: "mast-2", label: "MAST" },
        enter: [{ do: "say", lines: [hale("Got the first. It isn't broadcasting, Magpie. It's calling. The same few seconds, over and over.")] }],
        goals: [{ when: "inArea", place: "mast-2" }],
      },
      {
        id: "mast-3",
        objective: "Tag the relay masts: 3 of 3",
        waypoint: { place: "mast-3", label: "MAST" },
        enter: [{ do: "say", lines: [hale("Second one's in. One more.")] }],
        goals: [{ when: "inArea", place: "mast-3" }],
      },
      {
        id: "withdraw",
        objective: "Get clear of the Dish",
        waypoint: { place: BASE_PLACE, label: "BASE" },
        enter: [
          {
            do: "say",
            lines: [
              hale("That's all three. And something is answering it. The reply is coming through the Needle, down in the Sunken Quarter."),
              magpie("There's a suit on the ridge, watching. Kestrel markings, command fit. It's leaving."),
              hale("Then so are you. Get clear."),
            ],
          },
        ],
        goals: [{ when: "outsideArea", place: "dish-ground" }],
      },
    ],
    debrief: {
      title: "Listening Post",
      text: "The Dish is calling, and something is answering through the Needle. The Combine knew before you did, and one of their commanders has now seen your suit.",
    },
    reward: { scrap: 150, standing: { drifters: 5 } },
  },
  {
    id: "the-needle",
    title: "The Needle",
    type: "defend",
    requires: ["listening-post"],
    briefing: {
      from: "Tamsin Hale, Drifters' Rest",
      text: [
        "The answer to the Dish is being relayed through the Needle, the spire in the Sunken Quarter. I can pull it off the transmitter, but only with a suit standing next to it, and it will take a while.",
        "That is Syndicate ground and they will not like it. The Combine will not be far behind. Hold the spire until I have the whole message. If you leave it, I lose the link and we start again.",
      ],
    },
    places: {
      "needle-foot": { x: 150, z: -2550, radius: 60 },
      "needle-ground": { x: 150, z: -2550, radius: 240 },
    },
    stages: [
      {
        id: "travel",
        objective: "Go to the Needle",
        waypoint: { place: "the-needle", label: "NEEDLE" },
        goals: [{ when: "inArea", place: "needle-foot" }],
      },
      {
        id: "wave-1",
        objective: "Hold the Needle: {left} raider{s} closing",
        waypoint: { place: "the-needle", label: "NEEDLE" },
        enter: [
          { do: "say", lines: [hale("I have the link. Stay by the spire. Syndicate suits coming in from the east.")] },
          { do: "spawn", tag: "raiders-1", faction: "syndicate", members: ["line", "scout", "rifle"], at: "the-needle", distance: 320, bearing: 90, stance: "hostile", alert: true },
        ],
        goals: [{ when: "destroyed", tag: "raiders-1", count: 3 }],
        fail: [{ when: "outsideArea", place: "needle-ground" }, { when: "playerDestroyed" }],
      },
      {
        id: "wave-2",
        objective: "Hold the Needle: {left} raider{s} closing",
        waypoint: { place: "the-needle", label: "NEEDLE" },
        enter: [
          { do: "say", lines: [hale("Halfway. It's a voice, Magpie. There are words in this."), hale("More of them, from the south-west.")] },
          { do: "spawn", tag: "raiders-2", faction: "syndicate", members: ["line", "heavy", "lancer", "scout"], at: "the-needle", distance: 320, bearing: 215, stance: "hostile", alert: true },
        ],
        goals: [{ when: "destroyed", tag: "raiders-2", count: 4 }],
        fail: [{ when: "outsideArea", place: "needle-ground" }, { when: "playerDestroyed" }],
      },
      {
        id: "wave-3",
        objective: "Hold the Needle: {left} Combine suit{s} closing",
        waypoint: { place: "the-needle", label: "NEEDLE" },
        enter: [
          { do: "say", lines: [hale("Nearly there. Combine line coming down from the basin. They want the spire, not you. Don't let them have it.")] },
          { do: "spawn", tag: "combine-line", faction: "combine", members: ["line", "heavy", "marksman", "scout"], at: "the-needle", distance: 340, bearing: 10, stance: "hostile", alert: true },
        ],
        goals: [{ when: "destroyed", tag: "combine-line", count: 4 }],
        fail: [{ when: "outsideArea", place: "needle-ground" }, { when: "playerDestroyed" }],
      },
    ],
    complete: [
      {
        do: "say",
        lines: [
          hale("I have all of it. Listen."),
          { speaker: "Harbor", text: "This is Harbor, custodian of the carrier. The ship is intact and holding. I am ready to hand over to a crew. Is there a crew?" },
          magpie("That went out in the clear."),
          hale("Everyone with a radio heard it. Come home, Magpie."),
        ],
      },
    ],
    debrief: {
      title: "The Needle held",
      text: "The answer is a voice. Something calling itself Harbor is still running inside the Fallen Carrier, and it is asking for a crew. It asked in the clear: every faction in the Marches heard it.",
    },
    reward: { scrap: 250, standing: { drifters: 5 } },
  },
];

/** What each patron says about the missions they send the player on. Keyed by the patron's faction. */
interface PatronText {
  key: string[];
  keyFound: string;
  keyDebrief: string;
  /** The engineer who carries the key to the Carrier. */
  engineer: string;
  walk: string[];
  walkMeet: string;
  walkEnd: string;
  walkDebrief: string;
  /** What the patron says before the duel, and how it ends for them. */
  duel: string[];
  ending: Line[];
  endingDebrief: string;
  /** The part the patron hands over at the end. */
  gift: ItemSpec;
}

const PATRON_TEXT: Record<string, PatronText> = {
  drifters: {
    key: [
      "Hale has been through the Carrier's old traffic. It will only open for its own command key, and the key was last logged aboard an escort that went down at the Broken Span.",
      "The Combine have read the same logs: their salvage teams are already closing on the Span. Find the key in the wreckage and get out before they finish. We cannot buy another.",
    ],
    keyFound: "That's it. That little thing is four warm winters. Now bring it home.",
    keyDebrief: "The command key is in the Compact's hands. Brandt has it locked in the yard strongbox and an engineer already asking how soon she can leave.",
    engineer: "Pell",
    walk: [
      "The key is no use in a strongbox. Pell is the best grid engineer the Compact has, and she is walking it to the Carrier in a suit with a cable drum where the guns should be.",
      "Meet her at the Broken Span and take her east. The Combine have pickets across the basin road. She cannot fight, so you will. Some of our pilots will meet you at the hull.",
    ],
    walkMeet: "Magpie? Pell. I've got forty kilos of cable and no guns, so I'll walk when you're close and stop when you're not. Lead on.",
    walkEnd: "That's the hull. Look at the size of it. Give me a day and a quiet corner.",
    walkDebrief: "Pell and the key are at the Carrier, with Compact pilots dug in around her. One Combine suit did not join the fight. It watched from the ridge the whole time.",
    duel: [
      "Pell has the hatch ready and the key in the lock. She will not turn it, because a Combine command suit has walked down off the ridge and is standing in front of the hull, alone.",
      "That is Ilse Varga, Kestrel One. She has asked for you by name. Go and hear her out, and then do what you have to. The lights are on the other side of her.",
    ],
    ending: [
      hale("Pell's tied it in. Four settlements just came up on the grid at once. Brandt is pretending he isn't crying."),
      { speaker: "Harbor", text: "Crew aboard. Thank you. What watch is it, please?" },
      hale("It keeps asking that."),
      magpie("Somebody tell it."),
    ],
    endingDebrief: "Harbor's reactor is tied into the Compact's grid, and the settlements have light. Harbor has a crew again, of a sort. It keeps asking what watch it is.",
    gift: { id: "lanceBeam", tier: 3, mods: ["cooled", "longRange"] },
  },
  wardens: {
    key: [
      "The Carrier answers to a command key. Without it nobody gets in, which would suit me, except the Combine know where it is: an escort wreck at the Broken Span.",
      "Their salvage teams are closing on it now. Find the key first and get clear. A door is only shut if we hold what opens it.",
    ],
    keyFound: "Good. Do not plug it into anything. Walk it out.",
    keyDebrief: "The command key is with the Wardens. Sorrel has put it under guard and sent for an engineer who knows how to weld a hull shut.",
    engineer: "Aldous",
    walk: [
      "To seal the Carrier we must first open it, once, and shut down what is inside in the proper order. Sapper Aldous will carry the key and do the work.",
      "Meet him at the Broken Span and bring him east. The Combine have pickets across the basin road and his suit carries tools, not weapons. A Warden section will hold the hull for your arrival.",
    ],
    walkMeet: "Sapper Aldous. I move when you are near and hold when you are not. I would be obliged if nothing shot me.",
    walkEnd: "There she is. Forty years of other people's mistakes. I'll need the hatch and some quiet.",
    walkDebrief: "Aldous and the key are at the Carrier, with a Warden section around him. One Combine suit did not join the fight. It watched from the ridge the whole time.",
    duel: [
      "Aldous is ready to open the Carrier and shut it down. He cannot begin: a Combine command suit has come down off the ridge and is standing before the hull, alone.",
      "Commander Varga. Kestrel One. She has asked for you by name. Hear her, then remove her. That door closes today.",
    ],
    ending: [
      { speaker: "Sorrel", text: "Aldous is welding the last hatch. It is done." },
      { speaker: "Harbor", text: "Understood. Standing down. Will someone tell me when it is safe to wake?" },
      magpie("We'll tell you."),
      hale("Will we?"),
    ],
    endingDebrief: "Sorrel's engineers have sealed the hull, and the Wardens stand watch on it. Harbor asked to be told when it is safe to wake, and Magpie said they would. Nobody believes it.",
    gift: { id: "heavyPlating", tier: 3, mods: ["light", "reinforced"] },
  },
  syndicate: {
    key: [
      "My buyers want proof the ship opens. The proof is a command key, and it is lying in an escort wreck at the Broken Span.",
      "The Combine's salvage teams are on their way to pick it up. Be quicker. If you bring it back in one piece there is a bonus; if you bring it back at all I will be pleasantly surprised.",
    ],
    keyFound: "Lovely. The price just doubled. Do try not to drop it.",
    keyDebrief: "The command key is with Lys, who has photographed it from every side and named a figure that made Hale put her cup down.",
    engineer: "Quill",
    walk: [
      "My buyers will not pay for a locked box. Quill appraises things for me; he will carry the key to the Carrier and tell me what is actually in there.",
      "Meet him at the Broken Span and walk him east. The Combine have pickets on the basin road and Quill is not a fighter, whatever he tells you. I have hired some hands to meet you at the hull.",
    ],
    walkMeet: "You're the escort? Quill. I walk when you're near, I stop when you're not, and I bill by the hour either way.",
    walkEnd: "Oh, that is a lot of ship. Lys is going to need a bigger number.",
    walkDebrief: "Quill and the key are at the Carrier, with Lys's hired suits around him. One Combine suit did not join the fight. It watched from the ridge the whole time.",
    duel: [
      "Quill says the ship is worth more than he can count, which I have never heard him say. He cannot get in: a Combine command suit is standing in front of the hull, alone.",
      "Ilse Varga, Kestrel One. She asked for you by name, which is flattering. Hear what she is offering. Then remember that I am offering more.",
    ],
    ending: [
      { speaker: "Lys", text: "Sold. The buyer's people are already on their way. Your tenth is in your account, Magpie, and it is a very large tenth." },
      { speaker: "Harbor", text: "I do not recognise this crew. Is this the crew?" },
      magpie("Hale? You there?"),
      magpie("Hale."),
    ],
    endingDebrief: "Lys had a buyer before the dust settled. You have been paid very well. Hale did not speak to you on the walk home.",
    gift: { id: "scatterGun", tier: 3, mods: ["cooled", "rapid"] },
  },
};

/** The second half of the campaign, as the patron the player chose would have it. */
export function patronMissions(patron: PatronDef): MissionDef[] {
  const text = PATRON_TEXT[patron.faction]!;
  const boss = (line: string): Line => ({ speaker: patron.speaker, text: line });
  const pays = (scrap: number): MissionDef["reward"] => ({ scrap: Math.round(scrap * patron.scrapRate), standing: { [patron.faction]: patron.standingPay } });
  const tech = (line: string): Line => ({ speaker: text.engineer, text: line });
  // The suit under escort lasts the whole mission: each stage names it, with where it would be by then.
  const engineer = (at: string, route: string[]): Action => ({ do: "spawn", tag: "engineer", faction: patron.faction, members: ["scout"], at, route, stance: "allied", passive: true, waitFor: 110, tough: 2.5, keep: true });
  const lost: Condition = { when: "destroyed", tag: "engineer", count: 1 };
  return [
    {
      id: "dead-reckoning",
      title: "Dead Reckoning",
      type: "salvage",
      requires: ["the-needle"],
      briefing: { from: `${patron.name}, ${patron.role}`, text: text.key },
      places: {
        "span-ground": { x: -1500, z: 1250, radius: 380 },
        "hull-1": { x: -1585, z: 1300, radius: 24 },
        "hull-2": { x: -1420, z: 1345, radius: 24 },
        "hull-3": { x: -1455, z: 1165, radius: 24 },
      },
      stages: [
        {
          id: "travel",
          objective: "Go to the Broken Span",
          waypoint: { place: "broken-span", label: "SPAN" },
          enter: [{ do: "spawn", tag: "salvagers", faction: "combine", members: ["line", "rifle", "scout"], at: "broken-span" }],
          goals: [{ when: "inArea", place: "span-ground" }],
        },
        {
          id: "hull-1",
          objective: "Search the escort's wreckage: bow section",
          waypoint: { place: "hull-1", label: "WRECK" },
          enter: [{ do: "say", lines: [hale("The escort broke in three when it came down. The key was on the bridge, wherever the bridge ended up."), magpie("Combine salvagers under the arch. They've started without us.")] }],
          goals: [{ when: "inArea", place: "hull-1" }],
        },
        {
          id: "hull-2",
          objective: "Search the escort's wreckage: midships",
          waypoint: { place: "hull-2", label: "WRECK" },
          enter: [{ do: "say", lines: [magpie("Bow section. Crew racks and not much else."), hale("Then try midships. East of you.")] }],
          goals: [{ when: "inArea", place: "hull-2" }],
        },
        {
          id: "key",
          objective: "Recover the command key from the stern section",
          waypoint: { place: "hull-3", label: "KEY" },
          enter: [
            { do: "say", lines: [magpie("Nothing here either."), hale("I have a transponder, very faint. Stern section, south of the arch. That's it, Magpie.")] },
            { do: "drop", tag: "command-key", name: "Carrier command key", at: "hull-3" },
          ],
          goals: [{ when: "collected", tag: "command-key", count: 1 }],
        },
        {
          id: "escape",
          objective: "Get clear of the Span before the ring closes: {time}s",
          waypoint: { place: BASE_PLACE, label: "BASE" },
          enter: [
            { do: "say", lines: [boss(text.keyFound), hale("Two more Combine teams, north and south-east, closing fast. They know you have it. Go.")] },
            { do: "spawn", tag: "ring-north", faction: "combine", members: ["line", "heavy", "scout"], at: "broken-span", distance: 330, bearing: 350, stance: "hostile", alert: true },
            { do: "spawn", tag: "ring-south", faction: "combine", members: ["line", "marksman", "lancer"], at: "broken-span", distance: 330, bearing: 140, stance: "hostile", alert: true },
          ],
          goals: [{ when: "outsideArea", place: "span-ground" }],
          fail: [{ when: "elapsed", seconds: 150 }, { when: "playerDestroyed" }],
        },
      ],
      complete: [{ do: "say", lines: [magpie("Clear of the Span. Key's aboard."), hale("Then come home before they work out which way you went.")] }],
      debrief: { title: "Key recovered", text: text.keyDebrief },
      reward: pays(350),
    },
    {
      id: "long-walk",
      title: "Long Walk",
      type: "escort",
      requires: ["dead-reckoning"],
      briefing: { from: `${patron.name}, ${patron.role}`, text: text.walk },
      places: {
        "span-meet": { x: -1440, z: 1245, radius: 70 },
        "picket-1": { x: -600, z: 1220, radius: 70 },
        "picket-2": { x: 350, z: 1190, radius: 70 },
        "carrier-approach": { x: 1260, z: 1150, radius: 30 },
        "carrier-ground": { x: 1350, z: 1150, radius: 130 },
      },
      stages: [
        {
          id: "meet",
          objective: `Meet ${text.engineer} at the Broken Span`,
          waypoint: { place: "span-meet", label: "MEET" },
          enter: [engineer("span-meet", ["picket-1", "picket-2", "carrier-approach"])],
          goals: [{ when: "inArea", place: "span-meet" }],
          fail: [lost],
        },
        {
          id: "leg-1",
          objective: `Escort ${text.engineer} east: clear the first picket`,
          waypoint: { place: "picket-1", label: "PICKET" },
          enter: [
            engineer("span-meet", ["picket-1", "picket-2", "carrier-approach"]),
            { do: "say", lines: [tech(text.walkMeet), hale("First picket is about nine hundred metres east of you, on the road. Go ahead and clear it, then bring them through.")] },
            { do: "spawn", tag: "picket-1", faction: "combine", members: ["line", "scout", "rifle"], at: "picket-1", stance: "hostile" },
          ],
          goals: [{ when: "arrived", tag: "engineer", place: "picket-1" }],
          fail: [lost],
        },
        {
          id: "leg-2",
          objective: `Escort ${text.engineer} east: clear the second picket`,
          waypoint: { place: "picket-2", label: "PICKET" },
          enter: [
            engineer("picket-1", ["picket-2", "carrier-approach"]),
            { do: "say", lines: [hale("That's one. The second is heavier: they have a siege suit sitting on the road."), magpie("Then it can sit somewhere else.")] },
            { do: "spawn", tag: "picket-2", faction: "combine", members: ["line", "heavy", "marksman"], at: "picket-2", stance: "hostile" },
          ],
          goals: [{ when: "arrived", tag: "engineer", place: "picket-2" }],
          fail: [lost],
        },
        {
          id: "leg-3",
          objective: `Escort ${text.engineer} to the Fallen Carrier`,
          waypoint: { place: "fallen-carrier", label: "CARRIER" },
          enter: [
            engineer("picket-2", ["carrier-approach"]),
            { do: "say", lines: [boss("My people are coming in on the hull from the south. The Combine got there first. Help them."), hale("You can see it from there, Magpie. It really is the size of a town.")] },
            { do: "spawn", tag: "hull-guard", faction: "combine", members: ["line", "heavy", "scout", "marksman"], at: "fallen-carrier", stance: "hostile" },
            { do: "spawn", tag: "friends", faction: patron.faction, members: ["line", "line", "rifle"], at: "fallen-carrier", distance: 260, bearing: 180, stance: "allied", alert: true },
          ],
          goals: [{ when: "arrived", tag: "engineer", place: "carrier-ground" }],
          fail: [lost],
        },
      ],
      complete: [{ do: "say", lines: [tech(text.walkEnd), magpie("Hale. There's a Combine command suit on the ridge. Same one as at the Dish. It isn't shooting."), hale("Kestrel One. She's waiting for something. Come home; I don't like it.")] }],
      debrief: { title: "The long walk", text: text.walkDebrief },
      reward: pays(450),
    },
    {
      id: "kestrel-one",
      title: "Kestrel One",
      type: "duel",
      requires: ["long-walk"],
      briefing: { from: `${patron.name}, ${patron.role}`, text: text.duel },
      places: { "carrier-ground": { x: 1350, z: 1150, radius: 130 } },
      stages: [
        {
          id: "travel",
          objective: "Go to the Fallen Carrier",
          waypoint: { place: "fallen-carrier", label: "CARRIER" },
          goals: [{ when: "inArea", place: "carrier-ground" }],
        },
        {
          id: "parley",
          objective: "Hear Varga out",
          waypoint: { place: "fallen-carrier", label: "CARRIER" },
          enter: [
            {
              do: "say",
              lines: [
                varga("Magpie. Varga. You have been a step ahead of me since the Dish, and I have not minded."),
                varga("Walk away. The Combine pays your salvage rate for a year and nobody on this field is hurt."),
                magpie("I gave my word to someone."),
                varga("So did I. Then let's be quick about it."),
              ],
            },
          ],
          goals: [{ when: "elapsed", seconds: 20 }],
          fail: [{ when: "playerDestroyed" }],
        },
        {
          id: "duel",
          objective: "Defeat Kestrel One",
          waypoint: { place: "fallen-carrier", label: "VARGA" },
          enter: [
            {
              do: "spawn",
              tag: "varga",
              faction: "combine",
              members: ["line"],
              ace: { name: "Kestrel One", member: { frame: "medium", loadout: "kestrelOne", role: "skirmisher" }, deadly: 1.5 },
              tough: 3,
              at: "fallen-carrier",
              distance: 150,
              bearing: 0,
              stance: "hostile",
              alert: true,
            },
          ],
          goals: [{ when: "destroyed", tag: "varga", count: 1 }],
          fail: [{ when: "playerDestroyed" }],
        },
      ],
      complete: [{ do: "say", lines: [varga("Well flown. Keep your word, then."), { speaker: "Harbor", text: "Command key accepted. Opening. Welcome aboard." }, ...text.ending] }],
      debrief: { title: "The Carrier opens", text: text.endingDebrief },
      reward: { ...pays(600), items: [text.gift] },
    },
  ];
}

/** How many missions the whole campaign has, whoever the patron is. */
export const CAMPAIGN_LENGTH = 6;

/** The campaign as it stands for a player: the shared missions, then their patron's once they have one. */
export function campaign(patron: WarFactionId | null): MissionDef[] {
  const def = patronOf(patron);
  return def ? [...MISSIONS, ...patronMissions(def)] : MISSIONS;
}

const CAMPAIGNS = new Map<WarFactionId | null, MissionDef[]>();

/** `campaign`, built once per patron: the game asks every frame. */
export function campaignOf(patron: WarFactionId | null): MissionDef[] {
  let missions = CAMPAIGNS.get(patron);
  if (!missions) CAMPAIGNS.set(patron, (missions = campaign(patron)));
  return missions;
}
