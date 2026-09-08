# Candle Gift — the reference game, observed

Everything in this file was seen directly, not inferred. Written after two rebuilds that were
built on inference and got the presentation wrong both times. **Read this before changing how
the game looks or what a station does.**

## The game

**Candle Gift**, Rollic Games. Android package `com.TwoPageGames.CandleGift`, iOS id
`1602811087`. Last version **4.3.28, 21 Oct 2023**.

**It is delisted.** The US App Store and Google Play listings both 404 as of 2026-09-07, which
is why there is so little written about it and why the first two attempts had so little to go
on. The listing survives on APK mirrors.

## Sources

- **APKCombo listing** — `https://apkcombo.app/candle-gift/com.TwoPageGames.CandleGift/`
  Carries the 8 official store screenshots. (apkpure is behind a Cloudflare bot check.)
- **The 8 store screenshots**, on Google's CDN. Append `=w900` for full size:
  ```
  play-lh.googleusercontent.com/u8oKKRTLXpN2e7Iz0_UwLsojWrI4Dc0Djxm-pFW3enIIfSKQJi1Imu9uBIeYKRrHRaqI
  play-lh.googleusercontent.com/4Eu0khr2CvebwGRa3N9jGlHzRxi86q8hcIMP8_a3ppstCaFpwJdzifFkKDMwNS0ih9U
  play-lh.googleusercontent.com/rBPcB1q5xG4MpkPqfuBm2dd0gOMjU2hAYPCmVTagCGuSwP6N-p8FB4ExIOCa_F9RNw
  play-lh.googleusercontent.com/lJse651Kw2YIQlsVmPrcIy4u0uba78v1XOJVdJjrXOuVPqTnpaZFtSfjW_ovxs6wzFGW
  play-lh.googleusercontent.com/2vnpiUhF3htP608q6f3h0FYCm02hCxxz8oE52kZyWDg3BfzyMJQ8uOAA-GBcPN8s_IOf
  play-lh.googleusercontent.com/b7ez7U7tM1DqhkgIMobvNG_Wzgza6xrIrRzjp88nNobI7Lyh6KG6Iq-0MGlHK1ZGyRg
  play-lh.googleusercontent.com/LJUbVPNZZ6-604BsfC6jzyUs-vNk9iZ4UuUfAPLvbXMip4UzMGZhONzxmp2zHhklEg
  play-lh.googleusercontent.com/YupBWFtP1M9UHhTdwSmpvxH58pAHWuvQBaaBrUUCn8gIV3PRh-mfImPbCYR-YkOxKto
  ```
- **Gameplay videos.** These are the best source by a distance - the store screenshots show
  the runway and almost none of the UI.
  - `youtube.com/shorts/Zjr68UJqeTM` (@mimii_gaming), sent by Gideon. One run.
  - `youtube.com/watch?v=jXw01JHvA2s` — **"Gameplay Walkthrough Part 1 Level 1-6", 4m27s.**
    The important one: six whole levels, so it shows every between-level screen. Everything
    in "The screens" below came from it.
  - `youtube.com/watch?v=K5gi_OgYHH0` was a third; it is gone as of 2026-09-08. Expect the
    rest to go the same way - which is what this file is for.
- **How to read a frame.** Seek with the player API (`document.querySelector('#movie_player')
  .seekTo(t, true)`, then `pauseVideo()`); setting `video.currentTime` directly does nothing,
  the player puts it back and every frame you grab is the same one. Then `drawImage` the
  video into a canvas laid over the page and screenshot that. The canvas is tainted by the
  cross-origin video, which does not matter: it still *renders*, and rendering is all this
  needs. A contact sheet of six frames per screenshot covers a 4-minute video in eight steps.
- **Gamezebo strategy guide** — the only written source with real mechanics in it.

## What the player controls

A **long slab of wax lying along the track**, made of discrete segments, with small gold
candle wicks poking out along one edge. It **grows lengthwise** as you collect, which is what
the guide means by *"as your candle stack gets longer, you need to be aware of everything
happening in front of you, and sometimes you need to start moving well before an obstacle is
in reach"*. It is not a crowd and it is not a single candle.

**Each segment is coloured by the pool it passed through.** In one frame the back half of the
slab is pink and the front half is blue with glitter on it — because those parts of the slab
were in different places when they crossed the stations. That is the whole game.

## The player object has TWO FORMS, and a station changes it

This is the thing four rebuilds missed, and it is the reason the stations felt like power-ups
here and like machinery there.

1. **Lying down.** A long slab of candles along the track, gold wicks poking out one edge.
   This is how a level starts.
2. **Standing up.** A **tall vertical tower of discs**, one per wax layer, striped by colour,
   with the gold wick on top and a bow round the bottom once wrapped.

**`ROTATE` is what turns it from one into the other**, and the name means what it says: it
stands the batch upright. Watch `youtube.com/watch?v=jXw01JHvA2s` between **15.5s and 15.8s**
— flat slab, ROTATE plate, tower — and the plate is still visible behind the tower at 16.1s.
That is the single most dramatic moment in a run and it is a *station doing something to the
object*, not a multiplier.

The tower keeps snaking: at 104s and 201s it visibly leans and its discs are offset from one
another, and a tower that crosses a pool comes out **striped** (87.5s white → 89s orange on
some discs only). So the discs keep their trail positions; they are simply stacked in height
as well. Weaving still decides which disc gets which colour.

## Stations

All signed with a **hot-pink pill label** hanging from a thin dark **curved lamp-post arm**
at the edge of the track, pointing inward.

| Sign | What it is |
|---|---|
| **CANDLE** | A **RAISED TANK of wax sunk into the track**, roughly half the width, standing proud of the surface with a visible side wall and a swirled, marbled liquid top — not a decal. A big chrome **ladle**, a sphere on a stick, hangs low over it and tips to pour a thick stream in. Two often appear side by side in different colours — the guide says to swipe left and right to get all your candles into both. |
| **GLITTER** | A tilted **bottle** on an arm sprinkling multicoloured glitter over the track. The sparkle **sticks to the candles** and is still on them at the podium. |
| **ROTATE** | A white platform with a big curved white arrow. **It stands the batch upright** — see above. |
| **MOLD** | A fat **pink fluted column** with a big **yellow flower or star** on its face — that is the *die*, and the shape on it is the shape you get — under a pale pink **ram** that comes down. The standing discs come out with that **cross-section**: scalloped, star, flower. At 19s the press fills the screen and four freshly stamped fluted candles stand beside it. |
| **WRAP** | A giant **gift box with a bow** at the track edge. Puts a **ribbon and a bow** round the batch — at 110s a red bow is tied round the base of the tower. |

## Obstacles

Three, and every hazardous thing in the game is in the same **coral/salmon** family, so
"this hurts" is one colour the player learns once. Read off the store screenshots at full
size (crop and magnify them in a canvas — the detail is there, it is just small).

- **Hazard panel.** A coral slab standing across part of the track, with a **darker coral
  rim** around a slightly recessed face and **white cross markings** on it. Rounded corners.
  Seen edge-on the crosses foreshorten into dashes and dots, which is what they look like in
  the wide shots.
- **Spiked axle.** A **pale grey-mauve post standing outside the rail**, with a shaft
  reaching **part way across** the track carrying a row of **coral octahedral diamonds**
  that interlock rather than sit apart. It never spans the full width — the gap is always on
  the far side.
- **Sweeper.** A **thin salmon bar lying diagonally** across the track, close to the surface,
  with a **large dark-navy arrowhead** at its outer end and **short salmon dashes** trailing
  behind it. Sometimes two of them crossing in an X, both anchored on the same side. The
  arrowhead is the tell: it is the one obstacle that moves.

**There is no saw.** A circular blade on a post appears in none of the eight screenshots or
the video; ours had one for three versions, inherited from the viking runner this repo used
to hold.

## Pickups

- **Gold/yellow candles lying flat** on the track, scattered across the width and **at
  assorted angles**, each with a **pale, almost white tapered tip**. Body gold, tip pale —
  ours had that exactly inverted for three versions. This is how the slab grows.
- **Green price tags** reading `5 $`, `154 $`, `610 $` etc. A rounded deep-green tag with a
  **punched white hole at one end**, lying flat on the track.
- Floating **`+208$` / `+304$` / `+240$`** green text when value is added.

## End of a run

1. A **vertical value gauge** with a numeric scale (20/40/60/80/100/120/140) measures the
   finished product against a target.
2. The finished candles are shown **stacked on a dark podium**, wrapped, with bows and
   decorated tops.
3. The run ends in a **shop area with panels either side of the track**, bought with the
   money earned:
   - **SCENT SHOP — $4,000**
   - **ONLINE SHOP — $1,000**
   - **LUXURY SHOP — $?,000** (partially visible)
   Each has a green **+** button. These are the "extra stations like the boutique" that a
   store review mentions — **progression is buying new shops/stations, not stat upgrades.**

## The screens

All observed in the walkthrough video. **The reference has no upgrade sheet** — no list of
stats with buy buttons anywhere in six levels. What ours calls "the workshop" does not exist.

### Between runs (the home screen)

The game world is live behind it, and the run starts when you swipe.

- **Top left:** a white rounded-square button with a **grey gear** → settings.
- **Top centre:** a **`Level N`** pill, gold with a dark outline.
- **Top right:** a **money pill**, green with a coin icon: `540 $`.
- **Right edge, mid-height:** a **`SHOP`** button — a yellow rounded square with a shop-awning
  icon and the word under it.
- **Centre, two cards side by side:**
  - **`CANDLE`** — pink card, gold candle icon, caption **`EXTRA +1`**
  - **`CASH`** — green card, banknote icon, caption **`BONUS x1.0`**

  Each shows either **`▶ FREE`** (rewarded video) or a price — **`500`** with a coin icon.
  They are per-run boosts bought before the run, not permanent upgrades.
- **Below the cards:** a yellow **double-headed horizontal arrow** with a hand cursor. The
  swipe hint, and the only tutorial in the game.

### During a run

The HUD is **three things**: the gear, the `Level N` pill and the money pill. That is all.
No candle counter, no running value, no colour chips, no progress bar. Value arrives as
floating green **`+143$`** / **`+72$`** text, and money as green price tags lying on the track.

### End of a run

1. The finished candles stand on a **round pale podium**.
2. Beside it stands a tall **numeric ruler in absolute money** — `…1040, 1060, 1080, 1100,
   1120, 1140…` — not a fraction of a target and not a star rating.
3. The candles convert into a **stack that rises up the ruler**, so the bar *is* the product.
4. A **yellow `HIGH SCORE` band** crosses the ruler at the previous best, with a tab on the
   left. Beating it is the goal of a level.
5. A small green marker rides the top of the stack with the live figure: `1083`.

### The reward screen

A full-screen **magenta** modal:

- Coin icon and the amount at the top: `540`.
- **`NEW HIGH SCORE!`** when it was beaten.
- The finished product drawn large in silhouette with a white outline.
- A percentage: `%20`, `%50`, `%100`, `%25`.
- A **semicircular multiplier fan** — `x2 x3 x5 x3 x2`, green/blue/purple/blue/green — with a
  gold needle resting in one wedge.
- The bottom button is either **`▶ CLAIM 2700`** (rewarded video, = amount × the wedge) or
  **`TAKE 582`** (the plain amount).

## Art direction

- **Sky:** flat bright cyan.
- **Track:** two themes seen — **white with pale lavender stripes and lilac edge rails**, and
  **deep purple**. Both are in, as workshops one and two.
- **Signs:** hot-pink pills, white bold caps, on thin dark curved arms.
- **Skyline:** pale blue-white **stacked cylinder towers** (like giant candle stacks) and low
  boxy blocks either side, well below the track.
- **Wax pools:** strong flat colour with a swirled, marbled lighter texture.
- **Money:** a green tag shape with a hole, not a banknote.

## Where our build differs

Closed in v4.0.0 — every item on the previous list:

1. ~~We draw upright separate candles; it draws one long segmented slab lying down.~~ The
   player object is now one loaf lying along the track, one candle per row, each candle
   spanning the lane, gold tips down one edge.
2. ~~No ROTATE station.~~ A white plate with a curved arrow — though what it *does* was
   wrong until v6: it stands the batch upright, it does not turn it end for end.
3. ~~Progression is stat upgrades; theirs is buying shops.~~ The workshop sells the Online
   Shop, the Boutique, the Luxury Shop and the Scent Shop, at the two observed prices where
   we have them. **The Scent Shop adds a station**, which is the shape of theirs.
4. ~~Our track is purple only.~~ THE WORKSHOP is white with lavender stripes and lilac rails
   under a flat cyan sky; purple is NIGHT SHIFT, workshop two.
5. ~~No value gauge at the end.~~ A vertical gauge with a numeric scale drawn from `par`, with
   the stars kept underneath as the between-level goal.
6. ~~Signs sit on a gantry with posts.~~ Each hangs from a single thin dark curved arm.
7. ~~No swirled texture on the pool surface, no stacked-cylinder skyline.~~ Both in.
8. ~~Wrapped candles become gift boxes with bows; ours get a ribbon band.~~ Wrapping turns a
   candle into a box with a bow.

Also matched since: the sweeper (orange diagonal bar, dark blue chevrons), shop fronts either
side of the track past the finish line, and Fredoka for the type.

Closed in v4.1.0: all three obstacles rebuilt from the screenshots (rimmed hazard panel,
rail-anchored spiked axle, salmon sweeper with a navy arrowhead), the saw deleted, loose
candles turned gold with pale tips and scattered at angles, and money turned into a green
tag with a punched hole.

Still open, in rough order of how much they would move the resemblance:

1. **The shop fronts are scenery.** Theirs are bought in the track, with a green `+` per
   panel; ours draw the panels and open a sheet.
2. **The finished batch is not shown on a dark podium.** We light it in place on the runway.
   Screenshot 5 shows the podium clearly: **dark navy**, with the wrapped bundles standing on
   it and the value gauge rising behind.
3. **Price tags carry no number.** Theirs read `5 $`, `154 $`; ours are a blank tag.
4. **We have not seen their upgrade screen at all**, so ours is ours.

## Still unknown

- The **upgrade/shop screen** itself — only the in-track shop panels have been seen, not
  whatever menu they open. **A screenshot of it would settle the last real difference.**
- Whether levels are themed sets or a continuous ladder.
- Whether the slab can be lost entirely, and what failure looks like.
