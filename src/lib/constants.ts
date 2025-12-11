// src/lib/constants.ts

export const APP_NAME = "Circles";

export const CATEGORIES = ["All", "Games", "Study", "Outdoors"] as const;

export const GAME_LIST = [
  {
    id: "hokm",
    name: "Hokm",
    blurb: "Classic Persian card game",
    tag: "Games",
    online: 120,
    groups: 8,
    image: "🎴",
    howTo: [
      "Play in teams of two; dealer picks a trump suit after seeing their cards.",
      "Players must follow suit if possible; trump wins the trick, otherwise highest of the led suit wins.",
      "First team to 7 tricks wins the hand; rotate dealer each round."
    ]
  },
  {
    id: "takhtenard",
    name: "Takhte Nard",
    blurb: "Traditional backgammon",
    tag: "Games",
    online: 95,
    groups: 6,
    image: "🎲",
    howTo: [
      "Each turn roll two dice and move checkers forward the total pips; doubles play twice.",
      "A blot (single checker) can be hit and re-entered; you must enter any checkers on the bar before other moves.",
      "When all your checkers are in home board, bear them off; first to clear all wins."
    ]
  },
  {
    id: "mafia",
    name: "Mafia",
    blurb: "Social deduction party game",
    tag: "Games",
    online: 210,
    groups: 12,
    image: "🕵️",
    howTo: [
      "Assign hidden roles (mafia, civilians, optional doctor/detective) and close eyes at night.",
      "At night mafia pick a target; doctor may save one; detective may ask about a player.",
      "By day everyone debates and votes out a suspect; civilians win if mafia are all eliminated, mafia win if they equal civilians."
    ]
  },
  {
    id: "mono",
    name: "Monopoly",
    blurb: "Buy, sell, and trade properties",
    tag: "Games",
    online: 180,
    groups: 10,
    image: "💰",
    howTo: [
      "Roll and move; buy unowned properties you land on or auction them if you pass.",
      "Collect rent when others land on your sets; build houses/hotels once you own a full color set.",
      "Use trades, mortgages, and cash to avoid bankruptcy; last player solvent wins."
    ]
  },
  {
    id: "uno",
    name: "Uno",
    blurb: "Colorful card matching fun",
    tag: "Games",
    online: 250,
    groups: 15,
    image: "🃏",
    howTo: [
      "Deal 7 cards each; flip one card to start the discard pile.",
      "On your turn match the top card by color, number, or symbol; play Wilds any time, draw one if you cannot play.",
      "Call “UNO” with one card left; action cards (Skip, Reverse, Draw 2/4) apply immediately."
    ]
  },
  {
    id: "chess",
    name: "Chess",
    blurb: "Classic strategy board game",
    tag: "Games",
    online: 130,
    groups: 9,
    image: "♟️",
    howTo: [
      "White moves first; each piece moves with its own pattern (pawns forward, bishops diagonally, rooks straight, knights L-shape, queen any direction, king one square).",
      "Protect your king while attacking the opponent; deliver checkmate so the king cannot escape.",
      "Special moves: castle once per side if clear; en passant for pawns; promote a pawn on the last rank."
    ]
  },
  {
    id: "mathematics",
    name: "Mathematics",
    blurb: "Study numbers",
    tag: "Study",
    online: 75,
    groups: 5,
    image: "📐",
    howTo: [
      "Pick a topic or problem set and set a 45–60 minute focus window.",
      "Rotate explaining solutions; share steps out loud so others can follow and check.",
      "Capture tricky questions to research together or ask a mentor later."
    ]
  },
  {
    id: "biology",
    name: "Biology",
    blurb: "Explore life sciences",
    tag: "Study",
    online: 60,
    groups: 4,
    image: "🧬",
    howTo: [
      "Agree on a subtopic (cells, genetics, ecology) and share a short intro source.",
      "Do a quick read, then discuss key terms and diagrams together.",
      "End with 3–5 review questions or flashcards to lock in the concepts."
    ]
  },
  {
    id: "chemistry",
    name: "Chemistry",
    blurb: "Chemicals and reactions",
    tag: "Study",
    online: 50,
    groups: 3,
    image: "⚗️",
    howTo: [
      "Choose a reaction or chapter; note safety basics even for virtual demos.",
      "Work through the mechanism or equations step by step; balance and label units.",
      "Summarize takeaways and common mistakes (limiting reagent, state symbols, lab etiquette)."
    ]
  },
  {
    id: "history",
    name: "History",
    blurb: "Past events and cultures",
    tag: "Study",
    online: 45,
    groups: 3,
    image: "📜",
    howTo: [
      "Pick a period/event and assign someone to give a 5 minute overview.",
      "Compare 2–3 sources; note causes, key figures, and outcomes.",
      "Discuss takeaways or parallels to today; end with a mini timeline everyone agrees on."
    ]
  },
  {
    id: "hiking",
    name: "Hiking",
    blurb: "Join a hike up the mountain",
    tag: "Outdoors",
    online: 40,
    groups: 3,
    image: "⛰️",
    howTo: [
      "Pick a trail that matches the group’s fitness; check weather and daylight.",
      "Pack water, layers, snacks, and a small first aid kit; share the route with someone.",
      "Hike together at the pace of the slowest, respect closures, and leave no trace."
    ]
  },
  {
    id: "visit",
    name: "Visiting",
    blurb: "Cultural and city visits",
    tag: "Outdoors",
    online: 55,
    groups: 4,
    image: "🏛️",
    howTo: [
      "Agree on stops (museum, cafe, landmark) and set a simple timeline with a meetup point.",
      "Buy tickets in advance if needed and share any access needs with the group.",
      "Travel together or in small pods; regroup after each stop and keep a contact thread."
    ]
  },
  {
    id: "camp",
    name: "Camping",
    blurb: "Overnight outdoor trips",
    tag: "Outdoors",
    online: 35,
    groups: 2,
    image: "🏕️",
    howTo: [
      "Reserve a site or confirm local rules; share a packing list (tent, bag, stove, water).",
      "Arrive before dark to set up; keep food secured and follow fire regulations strictly.",
      "Assign chores (setup, cooking, cleanup) and pack out all trash when you leave."
    ]
  },
  {
    id: "kayak",
    name: "Kayaking",
    blurb: "Water adventures",
    tag: "Outdoors",
    online: 30,
    groups: 2,
    image: "🛶",
    howTo: [
      "Wear a PFD, check weather/tide, and choose calm water if you are new.",
      "Learn forward, sweep, and reverse strokes; keep three points of contact when getting in/out.",
      "Stay in pairs or a pod, keep distance from obstacles, and head back with energy to spare."
    ]
  },
];
