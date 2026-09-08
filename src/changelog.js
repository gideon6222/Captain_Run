/* What changed, in the player's terms.

   The build stamp answers "did my update land". It cannot answer "what is
   actually different", which after a few sessions of work is the question that
   matters more - and a commit log is the wrong shape for it, being written for
   whoever maintains the code.

   Rules for entries: describe what the player can now do or see, not what was
   refactored; one line each; newest first. */

export const VERSION = '0.3.0';

export const CHANGELOG = [
  {
    version: '0.3.0', date: '2026-09-07', title: 'The mountain wakes up',
    notes: [
      'Brutes are real. Big purple draugr that take two of your crew - they were written into the game from the start and had never once spawned.',
      'Gates can hurt now. Some offer a genuine loss against a doubling, and the good side is no longer always the same side.',
      'Draugr, crates and shrines use the whole road instead of hugging the left.',
      'The warband fights the Jotunn instead of the stragglers in front of it.',
      'Axes fan out across the nearest few draugr rather than five into one.',
      'Trees and boulders along the trail, roughly twice as many as before.'
    ]
  },
  {
    version: '0.2.0', date: '2026-09-07', title: 'Built to be continued',
    notes: [
      'Updates now install themselves - no more stale builds after a deploy.',
      'A version number and this list, so you can see what changed.'
    ]
  },
  {
    version: '0.1.0', date: '2026-09-07', title: 'First ascent',
    notes: [
      'Lead a warband up the mountain, steer with one thumb.',
      'Gates that grow or cut the crew, draugr that charge, a jotunn at the top.',
      'Iron forges the axe within a run; gold buys upgrades at the camp.',
      'Runes and blessings, sealed until the fourth ascent.'
    ]
  }
];
