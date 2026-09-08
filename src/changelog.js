/* What changed, in the player's terms.

   The build stamp answers "did my update land". It cannot answer "what is
   actually different", which after a few sessions of work is the question that
   matters more - and a commit log is the wrong shape for it, being written for
   whoever maintains the code.

   Rules for entries: describe what the player can now do or see, not what was
   refactored; one line each; newest first. */

export const VERSION = '3.0.0';

export const CHANGELOG = [
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
