/* What changed, in the player's terms.

   The build stamp answers "did my update land". It cannot answer "what is
   actually different", which after a few sessions of work is the question that
   matters more - and a commit log is the wrong shape for it, being written for
   whoever maintains the code.

   Rules for entries: describe what the player can now do or see, not what was
   refactored; one line each; newest first. */

export const VERSION = '6.1.0';

export const CHANGELOG = [
  {
    version: '6.1.0', date: '2026-09-08', title: 'Standing in a row',
    notes: [
      'Fixed: the CANDLE and CASH cards could not be bought \u2014 tapping either one started the run instead.',
      'When the batch stands up it now stands in a ROW, every candle on its own feet, so the press can stamp them one at a time.',
      'Standing candles show their bands running up them, so you can finally read every colour you dipped.',
      'Every standing candle has its own wick and its own flame at the gift table.',
      'The wax flows, and it answers: rings spread where a candle goes in and where the ladle pours.',
      'The ladle follows your candles across the pool and down it, so the stream lands on the batch instead of on empty wax.',
      'The end-of-run screen is a plain continue now \u2014 what you earned and your best. The multiplier wheel is gone; it was a rewarded-video gamble and there are no adverts here.'
    ]
  },
  {
    version: '6.0.0', date: '2026-09-08', title: 'It stands up',
    notes: [
      'ROTATE now does what its name says: the whole batch rears up off the track into a tall tower of candles. It is the biggest thing that happens in a run.',
      'Standing up, every candle is a stripe in the tower, so a batch that wove through two pools comes out banded and one that held a line comes out plain.',
      'The press shows the shape it stamps \u2014 a fat die in the actual cross-section, flower, star or fluted \u2014 and slams to the deck instead of bobbing.',
      'Wax is a real vat now: a tank standing proud of the track with a darker rim, a chrome ladle hanging over it, a thick stream and a ring where the pour lands.',
      'Wrapping ties a ribbon round every candle and a bow at each end of the tower.',
      'The tower carries its glitter and its scent all the way to the gift table.'
    ]
  },
  {
    version: '5.0.0', date: '2026-09-08', title: 'The screens, from the video',
    notes: [
      'Six levels of the real game were watched frame by frame, and every screen here is rebuilt from what it actually does.',
      'The HUD is three things now \u2014 a settings gear, the level, and your money. The candle counter, the running value, the colour chips and the progress bar are gone; the real game has none of them.',
      'Between runs you sit on the runway itself, with a SHOP button and two boost cards: CANDLE for extra candles, CASH for a bigger payout. Swipe to begin.',
      'The end of a run is a money ruler with your own best marked on it in yellow, and the batch climbs it. Beat your best.',
      'Then a reward screen: what you earned, whether it was a new high score, the candle you made, and a multiplier fan to claim.',
      'Stars are gone. The goal is your own high score, which is what the real game asks.',
      'The shop sells SHOPS \u2014 Online, Scent, Boutique, Luxury \u2014 and nothing else. Bigger Batch, Steady Tray, Long Reach, Deeper Vats and the Glitter Cannon were invented for this build and appear nowhere in the real one.',
      'Barriers are red X X X walls of spikes now, not flat panels.'
    ]
  },
  {
    version: '4.2.0', date: '2026-09-08', title: 'Pause',
    notes: [
      'A pause button beside the level counter. Everything stops \u2014 the run, the camera, the confetti \u2014 and picks up exactly where it was.',
      'Sound and music have their own switches, so you can keep the smashes and drop the theme.',
      'A steering slider, for when the same swipe should move the tray further or less far.',
      'Clear save data, from the pause screen. It takes two taps and it says so, and your sound and steering settings survive it.',
      'Esc or P pauses too, if you are playing at a desk.'
    ]
  },
  {
    version: '4.1.0', date: '2026-09-08', title: 'The traps, drawn from life',
    notes: [
      'Every obstacle rebuilt from the real game\u2019s own screenshots instead of being carried over from the viking runner this repo used to hold.',
      'Barriers are coral panels with a darker rim and a white cross, and they are bigger \u2014 you can read one from further away.',
      'The spiked roller now stands on a post at the track edge and reaches part way across on a shaft, so the gap is always on the other side.',
      'The sweeper is a thin salmon bar with a big navy arrowhead showing which way it is sliding, and dashes trailing behind it.',
      'The circular saw is gone. It was never in the game we are modelling.',
      'Loose candles are gold with pale tips and lie at all angles, and money is a green price tag with a punched hole.',
      'Fewer obstacles overall: the runway lost the saw\u2019s share of the danger rather than redistributing it, so there is more room to work the pools.'
    ]
  },
  {
    version: '4.0.0', date: '2026-09-08', title: 'One long candle',
    notes: [
      'Your candles now lie flat along the track as one long slab, packed side by side with gold tips down one edge - the way the game this is modelled on does it.',
      'A white workshop under a flat cyan sky, with lilac rails and pale lavender stripes.',
      'New ROTATE plate: drive over it and the whole slab turns end for end, so the back of it goes through the next pool first.',
      'New SCENT station, bought once from the Scent Shop. It is a station rather than a number, and it stays for every run after.',
      'New sweeper: an orange bar that slides across the track. It is the one obstacle that moves, so a long slab has to start turning early.',
      'A stacked-candle skyline below the track, and shop fronts either side of the finish line.',
      'The end of a run measures the batch on a value gauge with a real scale, instead of only awarding stars.',
      'Fredoka throughout, so the signs and the HUD read like the real thing.',
      'Rebalanced: weaving both pools is now worth about 9x idling per candle.'
    ]
  },
  {
    version: '3.0.0', date: '2026-09-07', title: 'Dip them yourself',
    notes: [
      'Wax is now a POOL on the runway, not a gate you pass through - and every candle keeps its own colours.',
      'Sweep left and right through a pair of pools and different candles get dipped in each. Weaving is worth about 2.6x per candle over just driving through.',
      'Two pools side by side at every gantry: CANDLE, GLITTER, MOLD and WRAP, each with its own sign.',
      'The tray grows by collecting loose candles lying on the runway. The +N and x2 gates are gone.',
      'Machines that actually work: a ladle pours into the wax pools and the press rams up and down.',
      'The results screen reports the tray - colours per candle, how many got moulded, how many got wrapped, how many came out plain.',
      'Barriers, rollers and saws take fewer candles, to match the slower growth.'
    ]
  },
  {
    version: '2.0.1', date: '2026-09-07', title: 'The workshop scrolls',
    notes: [
      'Fixed: the upgrade list would not scroll on a phone, so there was no way to reach the rest of the upgrades - or the start button.',
      'START THE LINE is now pinned to the bottom of the workshop and is always reachable.',
      'Dragging over a menu scrolls it instead of steering the tray.'
    ]
  },
  {
    version: '2.0.0', date: '2026-09-07', title: 'Candle Gift',
    notes: [
      'The whole game is a candle factory now. Run a tray of candles down the line and sell them at the end.',
      'Your candles trail behind you in a line - the longer the stack, the earlier you have to start steering.',
      'Stations do the work: CANDLE vats dip a coloured band, GLITTER sprinkles, MOLD presses a shape, WRAP ties the bow.',
      'Gates add candles, +N or x2. Barriers, spike rollers and saws knock them off the back.',
      'Grab the banknotes on the runway - some of them are guarded.',
      'Every candle is lit one at a time on the gift table while the money counts up. Three stars a level.',
      'Bright purple runway in an open sky, hot pink signage, and a lot of confetti.',
      'Upgrades are stats you buy between levels: Bigger Batch, Earning Power, Steady Tray, and the stations themselves.'
    ]
  },
  {
    version: '1.0.0', date: '2026-09-07', title: 'Wick',
    notes: [
      'You are a candle. Dip through arches of coloured wax and carry the best candle you can to the chandler.',
      'Layers are visible: every dip is a ring on the candle, widest and newest at the bottom, wick at the top.',
      'Blades shave wax off one side and leave you crooked. Heat lamps melt you evenly. Water snuffs your wick.',
      'Your flame is the only real light in the room, and it dims as the candle shrinks.',
      'A snuffed wick relights in the heat of a lamp - the hazard you were dodging is the one you need.',
      'The chandler pays for bulk, for how many colours you carried, and for whether they actually contrast.',
      'Six scents to find, each hidden inside a hazard, each a permanent perk. They are never sold.',
      'Four workshops, and each one is darker than the last.'
    ]
  },
  {
    version: '0.3.0', date: '2026-09-07', title: 'Before this was Wick',
    notes: [
      'This repo used to hold Captain Run, a viking crowd-runner, through v0.3.0.',
      'The build, the tests and the shape of the game carried over; the vikings did not.'
    ]
  }
];
