/* What changed, in the player's terms.

   The build stamp answers "did my update land". It cannot answer "what is
   actually different", which after a few sessions of work is the question that
   matters more - and a commit log is the wrong shape for it, being written for
   whoever maintains the code.

   Rules for entries: describe what the player can now do or see, not what was
   refactored; one line each; newest first. */

export const VERSION = '2.0.0';

export const CHANGELOG = [
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
