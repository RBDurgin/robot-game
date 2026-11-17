import { BASE_PLACE, type Line, type MissionDef } from "../sim/mission";

/** The voices on the radio. The player is Magpie. */
const hale = (text: string): Line => ({ speaker: "Hale", text });
const magpie = (text: string): Line => ({ speaker: "Magpie", text });

/**
 * The scripted missions, in the order they are offered: the campaign in `docs/story-outline.md`.
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

export const missionById = (id: string): MissionDef | undefined => MISSIONS.find((m) => m.id === id);
