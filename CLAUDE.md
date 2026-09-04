# League Ledger

A contract, cap and auction manager for a nine-team NBA fantasy dynasty league.
Live at hopefullyitwill.work, hosted on Netlify.

The whole app is one file: `deploy/index.html`. All data, styles and logic are
inlined. There is no build step and no framework. Keep it that way unless there
is a strong reason not to — a single file is why a non-developer can deploy this
by dragging a folder.

---

## Layout

```
deploy/
  index.html                    the entire app
  netlify.toml                  drag-and-drop config
  package.json                  installs @netlify/blobs for the functions
  netlify/functions/
    state.mjs                   shared storage API
    notify.mjs                  POST /api/notify — outgoing mail
    daily.mjs                   scheduled — the daily digest
    lib/league.mjs              blobs + Resend + the send ceiling
    lib/format.mjs              pure formatting and date logic (no imports)
netlify.toml                    git-build config: base = "deploy"
tests/                          the DOM stub and the assertions
```

`lib/` is a subdirectory on purpose: Netlify makes every top-level file in the
functions directory its own function, and a subdirectory only becomes one if it
holds a file named after it. Nothing under `lib/` gets an endpoint.

Netlify's base and publish directories both point at `deploy`, functions at
`deploy/netlify/functions`.

---

## Storage architecture

League state is **split across five Netlify Blobs keys**, not one blob. This is
deliberate: it makes whole classes of write conflict structurally impossible
rather than something the merge logic has to be clever about.

| Key        | Written                            | Conflict handling |
|------------|------------------------------------|-------------------|
| `settings` | rarely (cap, tax, roster, phase)   | last write wins |
| `rosters`  | cuts, signings, trades             | per-club merge |
| `auction`  | constantly during a draft          | isolated; bid lists unioned, highest wins |
| `trades`   | offers                             | merged by offer id |
| `log`      | every action                       | **append-only** |

Several keys sit outside the five slices. `mailcount` and `digest` are written
only by the mail functions and never read by the client. `chat` holds the league
chat. `notes-<club>`, `proj-<club>` and `strat-<club>` hold one GM's own work,
encrypted — see "A GM's own work follows him between devices" below.

`KEYS` in `state.mjs` only gates `?key=all` — every other verb takes any cleaned
key, which is what makes those extras possible with no server change.

`GET /api/state?key=all` returns every slice in one round trip.
`PUT /api/state?key=X&rev=N` rejects a stale revision with 409 so the client can
re-read, merge and retry.
`POST /api/state?key=log&append=1` appends server-side with no revision check —
two GMs logging a move at the same instant both survive.

**A bid writes only the `auction` slice.** Do not widen that. It is why bidding
during a live draft cannot collide with someone editing a roster in another tab.

`commit(entry, only)` takes an optional slice list. `sliceGuess()` picks a
sensible default from the entry kind. Pass `['auction']` explicitly for bidding.

### Polling
Every 4 seconds while an auction is open, 12 otherwise, paused when the tab is
hidden. Only slices whose revision changed are applied.

### A GM's own work follows him between devices
Three things belong to one GM and nobody else: his **notes**, his
**projections** and his **auction strategy board**. All three live in the league
database, so they follow him from phone to laptop.

Projections used to be local-only, and this file used to say not to sync them.
That was reversed deliberately: work typed on a phone that the laptop cannot see
is work done twice. Do not reverse it back without asking.

All three go through one store, `cbox*` — "club box":

| | |
|---|---|
| `cboxLoad(kind)` | local mirror + server copy, newest wins; seeds the server if it is empty |
| `cboxSave(kind,d)` | stamps, mirrors locally, pushes; returns `{ok,synced}` |
| `cboxRefresh(kind)` | fetch only if the server copy is newer — called when a tab opens |
| `cboxPick(local,remote)` | **pure**, and the whole cross-device rule: newer `at` wins, remote on a tie |

Kinds are `notes`, `proj` and `strat`. Each is its own key, `<kind>-<club>`,
outside the five league slices, so none of it rides the payload the auction polls
every four seconds. localStorage mirrors under `<kind>_<club>`, so all three work
with no network and the toast says "synced" or "this device only".

**It goes up encrypted**, because `/api/state` has no auth: AES-GCM under a key
derived by PBKDF2 from the club's PIN, which the client already holds in the
rosters slice, so no new secret is stored and it survives a reload. A league-mate
who fetches `?key=proj-Osborn` gets ciphertext.

Do not present this as real confidentiality. It stops someone reading your work;
it does not stop someone who digs the PIN out of `rosters` first. Same
honour-system bar as everything else here.

Changing a PIN makes the stored copy undecryptable. `cboxFetch()` returns null,
`cboxPick()` therefore keeps the local copy, and `cboxLoad()` re-uploads it under
the new key — recovery, not data loss.

The **commissioner has no club and so no PIN** to derive a key from.
`cboxRemoteKey()` returns null for him, and his own notes and projections stay on
the device. There is nothing to sync them to.

`cboxReadLocal()` reads three shapes: the current `{at,d}`, the board's old
`{at,rows}`, and a bare value from before any of this synced — projections were
written that way for months. The older two come back stamped 0, which loses to
anything on the server and beats nothing at all. Notes have one extra fallback,
the local-only `ll_notes_<club>` key, read once and rewritten into the store.

### Three projection sources, one switch
The header toggle picks what every stats table in the app is showing. `useProj`
means "not raw 2025-26"; `PROJSRC` says which projection is in front of it:

| | |
|---|---|
| `act` | 2025-26 actuals — the record |
| `agg` | the 2026-27 aggregate, the same table for every GM |
| `mine` | that GM's own edits, over the 2025-26 baseline |

`projFor(name)` is the single place that decision is made, and `pstat()` is its
only important caller — everything else inherits. `usingMine()` and `usingAgg()`
exist so the amber "edited" marks stay on a GM's own numbers: on the aggregate
the numbers move but nothing is his, so nothing is marked.

`setProjMode()` normalises its argument, including the old `true`/`false` call
shape, because an unrecognised value silently meaning "some projection" is
exactly the bug worth not having. Anything unknown is `act`.

**`AGG` is a static table, not a feed.** It is the commissioner's own aggregate,
transcribed from a spreadsheet he assembled: LineupExperts' preseason set for the
per-game line, plus Hashtag Basketball's free top-30 for shooting percentages.
The app scrapes nothing. Replace the whole constant when a newer set arrives —
nothing reads anything but its twelve keys.

**Attempts in `AGG` are derived, and that matters.** The source publishes makes
(FGM, FTM) and no attempts, but the league scores FG% and FT% weighted by
attempts, so `FGA`/`FTA` had to come from somewhere: Hashtag's projected
percentage where it has one (30 players), otherwise the player's own 2025-26 rate
(305), and the pooled rate of everyone else (.474 / .787) for the two with no
2025-26 attempts on file. So a player's shooting *volume* is projected; his
*efficiency* is last season's unless Hashtag says otherwise. Do not present the
percentages as projected.

337 of the 390 players in `RATER` are covered; the rest fall back to their
2025-26 line, which is just what `pstat()` does with any missing key. Players in
the source who are not in `RATER` were dropped — there is no row to show them in.

### Nightly lineups
Once the season is live a club does not play everyone it owns. **Fifteen slots
start**: one C, four G, four F and six UTIL (`SLOTS` / `SLOTIDS`). Everyone else
is on the bench; the injured reserve is separate again.

Eligibility is `posSet(name)` — the roster entry's `p` read as a set of G/F/C.
The sheet writes `"G, F"`, `"F, C"` and one stray `"PG"`, so a two-letter guard
or forward reads as its family. `slotOk(id,name)`: UTIL takes anybody, every
other slot wants its own letter.

The lineup lives on the club, `S.teams[t].lu = {d,s}`, so it rides **rosters**
and merges per club — two GMs setting lineups at the same instant cannot
collide. `d` is the night it was last set and is informational: **a lineup
carries forward** until somebody changes it, which is what a GM on holiday needs.
Locks are computed from the clock, never from `d`.

**Only a started player's stats count for the night, and that accrual is NOT
built.** It needs the nightly stats feed. Everything up to that line is here, and
the screen says so rather than implying the standings move. When the feed lands
it reads `startedOn(club)` and adds the night's box scores; no screen has to
change. `clubTotals()` and `fullTotals()` are untouched and still count every
signed player, because there is nothing daily to count yet.

**The lock.** Once a player's game tips off he is frozen for the night, in the
lineup or out of it. `lockOf(name)` reads two sources in order:

1. `S.cfg.sched[day][NBA team]` — a tip-off time per team, written by the stats
   feed when it lands. Nothing populates it today. `NBATM` maps a player to his
   NBA club for exactly this reason: a tip-off belongs to the NBA team, not the
   fantasy one.
2. `S.cfg.lockAt` — a league-wide daily `HH:MM` in league time, set by the
   commissioner alongside the season phase. The stopgap, and the reason the rule
   is enforceable tonight rather than next season.

With neither set nothing locks and `lineupNote()` says so. Do not make the
screen imply a lock that is not there.

A locked player is rendered as text, not a disabled control — there is nothing
the GM may do with him, and a dead select invites a click. `clearLineup()` and
`autoLineup()` both step around locked men rather than failing.

**The IR sorts to the bottom of My Roster whatever the sort is set to**, and
carries `tr.isir` for the dimming. A man who cannot be started is not competing
with the ones who can.

### An expiring contract is a free agent
He is sitting on a roster this minute, but nobody has committed a dollar to him
for next season, and that is the only test the auction, the strategy board and
`faPool()` have ever used. Three functions say it in one place:

- `signedClub(name)` — the club with salary on him for next season, or null.
- `liveClub(name)` — whichever club carries him on its sheet today, expiring or
  not.
- `isFreeAgent(name)` — no `signedClub`. This is the predicate every "is he
  available" question must use.

`ownerOf()` renders the two together: `Osborn`, `Coulter (expiring)`, or
`Free agent`. `ownerLabel()` is the same in the lower case the player cards use.

The what-if roster's "free agents only" filter used to mean *unrostered*, which
hid every expiring player from the one screen built for planning around them.

**None of this reads `RATER`'s `t` field.** That is the club stamped on a player
when the 2025-26 numbers were transcribed; it does not follow a trade, a signing,
a cut or the draft. A screen showing `p.t` is showing last season, and the
Players tab, the projections table and all three player cards were doing exactly
that.

The commissioner's player table is the deliberate exception, and for a different
reason — see below: an expiring man is already listed under his club there, and
a second row would let the commissioner edit two of him.

### One free agent pool, read by every screen
`faPool()` is the single definition of the free agent class, and `stratPool()`
and `freeAgents()` both agree with it: a player counts as taken only when `y[1]`
is set, so the ~44 players in the last year of a deal are available even though
they sit on a roster today.

They did not always agree, and the three ways they diverged are worth knowing.
My Team read `faPool()`, which filtered `RATER` by **raw name** — so the two
spellings of Poeltl read as two players — and never saw an undrafted rookie,
because rookies are not in `RATER`. `freeAgents()`, which the Free agent classes
tab reads, pushed every expiring roster entry without asking whether the same
canon player was signed somewhere else, so Poeltl was a free agent there and
nowhere else. The two screens listed different people.

`faPool()` now returns `RATER` filtered through `canon()`, plus
`undraftedRookies()`, in RATER row shape. **A player with no box score carries
`g`, `s` and `tot` as null** — that is what `hasStats()` is for, and any table
reading `p.s.PTS` directly will throw on a rookie. `statVal()` is null-safe.
Rookies sort last everywhere, having no rating, so the free agent datalists are
deliberately uncapped: a `slice(0,300)` hid the entire class. Victor Wembanyama is Coulter's restricted free agent and
belongs on a rival's board with a note that Coulter gets to match.

`stratPool()` used to exclude anyone on any roster at all, which hid every
expiring contract — the board only ever showed unrostered players, and the pool
was 252 instead of 296. Do not reintroduce that. A player leaves the board when
someone commits salary to him for next season, not when he appears on a roster.

`stratHold()` tags each board row with the club that holds him and what it holds
him with (Bird, Early Bird, restricted), so the ranking is read against the
matching right. Both sides go through `canon()`; without it "Jakob Poetl" and
"Jakob Poeltl" read as two different players.

---

## League rules the code enforces

These come from the league rulebook. Several were implemented wrong on the first
attempt — check the rulebook before changing any of them.

**Salary cap** is soft ($165.00). Exceed it only via Bird rights, Early Bird, the
mid-level exception, or minimum contracts.

**Luxury tax** ($200.50) is a hard cap. Nothing beats it. Not Bird rights, not
anything.

**Bird rights**: three seasons with one club without clearing waivers or changing
teams as a free agent. Lets the club exceed the *cap* to re-sign its own player.
Travels with the player in a trade.

`p.b` is free text off the original spreadsheet: `Yes`, `Early`, `Min`, `MLE`,
`EBR`, `No`, empty. Read it through `birdKind()`, never directly. Only `Yes` is
full Bird rights; `No` and empty are *nothing*. The code used to treat any
non-empty string as Early Bird, which handed a $7.00 over-the-cap exception to
the three players marked `No`. The remaining labels describe how the club signed
him and are still read as Early Bird — that may or may not be right, and the
commissioner's player table is where the data itself gets corrected rather than
the code guessing.

**Early Bird**: signed mid-season before the deadline, finished the year on the
roster. Worth $7.00 over the cap.

**Restricted free agents**: only players who finished the final year of a team,
player, or rookie option. Their club sits out the bidding, then decides whether
to match. All cap rules apply to the match.

**Mid-level exception**: once a year. $5.50 over the cap, $3.25 under. Consumed
when used.

**Trades**, over the cap, incoming salary is limited by outgoing:
- $9.75 or less → 150% of outgoing
- $10.00–$19.50 → outgoing + $5.00
- $19.75 or more → 125% of outgoing

Matching applies only to a club that is over the cap before the trade or that the
trade pushes over. Re-validate at accept time — rosters move between offer and
acceptance.

A club can also trade the **rights** it holds to a player whose deal is expiring
— Bird, Early Bird, or restricted — and the rights travel with him. `tradeRight()`
decides: an expiring player with no rights at all is an unrestricted free agent
nobody can trade, and a player who has cleared waivers is gone.

Those players carry no salary for next season, so they move **$0**. Two things
follow, and both were wrong the first time:

- They are not in `headcount()`, so the roster delta must count contracts only.
  Counting selected players instead let a club at the roster limit send rights
  and take back a contract.
- `$0` is not the same as missing. Checking `y[1]` alone to confirm a club still
  has a player rejected every rights trade at accept time as though the player
  had left.

**The commissioner's player table** (`drawAllPlayers()`, Commissioner tab) lists
every contract in the league — club, salary now, salary next season and the two
after, years left, option, rights, year acquired, rating — *plus every unsigned
free agent in the pool*. Filterable and sortable, with an Edit button per row. It
is the only place expiring players can be edited or moved: the Move tool above it
lists only players with `y[1]` set, so before this there was no way to correct an
expiring player's club or rights without signing him first.

A **contract** row opens `openEdit()`. The commissioner-only block (`#edComm`)
adds club, `y[0]`, position, option and rights; a GM editing his own roster still
sees exactly the four contract fields he always had. Changing the club moves the
player and logs it as a trade rather than an edit.

An **unrostered** row has no contract to open, so `openPlayerEdit()` opens the
*same* dialog empty, with "— not on a roster —" selected in the club list. Give
him a club and a salary for next season and he is assigned; leave the club blank
and only his player record is saved. There is one dialog for every player in the
league — `fillComm()` fills the commissioner half either way.

"Not on a roster" is offered **only** to a player who is already unrostered, so
the dialog can never become a way to release somebody. That is what Cut is for,
and Cut carries the waiver rules this path does not.

**Saving the season phase asks first**, and the question says what will actually
happen — the IR and lineups opening or closing, how a release will be treated,
how many salaries come off the books tonight. It is the most consequential switch
on that page and the only one that changes the rules under every GM at once.

Assignment warns rather than blocks on the two limits it can break — past the
hard cap, and over the roster limit. This dialog exists to make the ledger match
reality, including a reality somebody already got wrong, so it confirms and
proceeds. The hard refusals stay where GMs act: `signPlayer()` and
`validateTrade()`, which still reject both outright.

The player record itself — the position shown for him, and the spelling the
league spreadsheet uses when it disagrees with the box scores — lives in the
settings slice as `S.cfg.pos` and `S.cfg.alias`, written through `saveRecord()`.
Both are mirrored into the module-level `POSFIX` and `ALIAS` maps by
`rebuildPlayerFixes()`, because `canon()` runs inside tight loops and must not
reach into `S.cfg` on every call. Call `rebuildPlayerFixes()` after anything that
replaces `S.cfg` — `applySlice()` and the boot sequence already do.

A position override is only kept for a player with no roster entry; once he is
rostered his own entry carries the position and the override is dropped, so there
is exactly one place to look. The alias is kept either way.

The alias field is the supported fix for the name-matching problem above: it maps
a roster spelling onto a RATER player so his stats stop reading as zero. A
commissioner alias beats the built-in `NAMEFIX`.

Stats are deliberately not editable here. They come from the season's box scores;
a GM's own numbers belong in projections, which never leave his browser.

**Exporting the table is `leagueCSV()`, not `tableToCSV()`.** The generic helper
scrapes rendered HTML, so it carries `$39.25` where a number belongs, an em dash
where a blank does, and none of the fields the table does not draw. `leagueCSV()`
writes the roster entry's own values — one row per contract, plus one per
unsigned free agent — with salaries as plain numbers and the raw `o` and `b` text
rather than what `birdKind()` makes of them. `key` is the canon name and is the
column that identifies a player; `player` is the club sheet's spelling, and six
of those differ from the box scores. Two buttons: one honours the filters, one
deliberately clears and restores them, because an export meant as a backup must
not silently inherit a filter somebody left set. `downloadCSV()` prepends a BOM
so Excel reads Jokic and Sengun as UTF-8.

Reading a CSV back in is **not built**, and it is the harder half: identity
(a typo makes a new player rather than editing one), a preview before any write,
a rule that a missing row never means "cut him", and a re-read before applying,
since the `rosters` merge replaces a club wholesale.

Free agents in this table are the *strict* reading — nobody on any roster —
unlike the strategy board. A man in the last year of a deal is already listed
under his club, and listing him twice would give the commissioner two rows for
one player. Duplicate *contract* rows are left visible on purpose: the sheet
really does carry Poeltl on two rosters, and hiding that would hide the problem.

**Adding a club** is on the same tab. A new club joins with an empty roster and
no PIN, so the first person to sign in as it claims it. Nothing else is
league-wide — the cap, the tax and the 920-game limit are all per club.

**The trade block** is one boolean, `p.blk`, on the roster entry — not a separate
list. It therefore rides the `rosters` slice and merges per club exactly like a
cut or a signing, so two GMs listing players at the same moment cannot collide.
A GM lists his own from the roster table on My Team; `toggleBlock()` enforces
that, and refuses a player `tradeable()` rejects — an expiring player with no
rights is an unrestricted free agent nobody can offer.

**Editing a signed contract is the commissioner's job, not a GM's.**
`canEditContract()` is `isComm()`, and `openEdit()` refuses anyone else — so does
the save handler, belt and braces. A GM still runs his own club: he signs free
agents, lists players on the block, uses the IR and releases anybody he likes.
What he cannot do is rewrite terms already on the books. Cut carries the waiver
rules; the edit dialog does not, which is exactly why it is not a GM's to reach
for. The Edit button is hidden for a GM on both My Team and the club page; Cut
stays.

**My roster is not in a `.scroller`.** `.scroller table` sets `min-width:760px`,
and the roster used to sit in a half-width `.twocol` column, so the action
column — cut, block, IR — was always off the right edge. It runs full width now
under `.rosterwrap`, which sizes to the page and wraps its buttons instead of
widening the row. Do not put it back in a `.scroller`.

**A listing does not travel with the player.** Bird rights do; a listing belongs
to the club that made it. Every point where a roster entry crosses clubs calls
`unlist()` — `applyTrade()`, the commissioner's Move tool, the club select on the
edit dialog, and `signPlayer()` when it moves an expiring man. Miss one and a
traded player arrives at his new club still advertised, on behalf of a GM who
never listed him.

The Trades tab opens with the block, filterable by club and name. "Add to trade"
loads the player into the builder: his club goes on the far side and yours on the
near one, so you are always looking at what you would give up.

**Stats in the trade machine.** Each pick-list row carries a line under the name —
games first, then points, rebounds, assists and threes. Games lead because of the
920-game cap: what a player costs in slots matters as much as what he does in
them.

Below the builder, `drawTradeCats()` shows what each side sends across all nine
categories and the net swing for each club. These are **season totals**, counted
the way `clubTotals()` and `standings()` count, because the league scores totals
rather than rates. Two things are easy to get backwards:

- **Turnovers invert.** A club shedding them is gaining ground, so `catGood()`
  reads a negative delta as good for `TOV` and bad for everything else.
- **Percentages do not net.** FG% and FT% are attempt-weighted and cannot be
  added across clubs, so they are shown per side and the net row leaves them
  blank rather than printing a meaningless number.

A player with no games on file counts as zero and is reported in a footnote, not
silently dropped.

**Cuts** depend on season phase, and this is the part that is easy to get wrong:
- **In season**: salary stays on the cap until the season ends, then clears. It
  never carries into the next year.
- **Offseason**: salary comes off immediately and all remaining years are voided.
- On a deal of **two years or more**, the releasing club cannot re-sign him
  during the first offseason after the release. He *may* be signed during the
  following season to a **one-year minimum contract**. A multi-year deal waits
  for the next offseason. Other clubs face no restriction at all.

**Escalation**: $0.75–$3.75 does not escalate. From $4.00 up, 4.5% normally or
7.5% with Bird rights. Raises never compound and always round **up** to the next
$0.25.

**Rookie draft**: one pick per club, in reverse order of finish — the champion
picks last. Three years with a rookie option on the last. First pick is 3.57% of
the cap rounded up to $0.25, each later pick $0.25 less. Rookies sign after the
auction and do not consume auction cap space, but the hard cap still binds: a
club with no room passes. Anyone undrafted is an ordinary free agent.

### How the draft is stored
Two pieces of state, in different slices on purpose:

| | | |
|---|---|---|
| `S.cfg.draft` | year, order, salary per slot, open/closed, how many future drafts are tradeable | commissioner input, written once → **settings**, last write wins |
| `S.teams[t].picks[]` | who holds which pick and what he did with it | written by nine GMs during the draft → **rosters**, which merges per club |

That split is why two clubs picking at the same instant cannot collide, exactly
like two GMs listing a player on the block.

**A pick is identified by its draft year plus the club it originally belonged
to, never by slot.** A slot only exists once the order is set, and picks are
traded years before that. A club that still holds its own pick has **no record
at all** — `pickHolder()` falls back to the origin club — so nothing has to be
seeded and an existing league needs no migration. `takePick()` materialises a
record the first time one is needed.

The commissioner enters the order and the salaries under **Rookie draft input**
on the Commissioner tab. `rookieScale()` fills the salary column from the
rulebook formula. Nothing is on the clock until the draft is opened, and the
draft cannot open until every slot has a salary.

`makePick()` writes `y:[null,sal,sal,sal]` with `o:'RO'`. A club that cannot fit
the pick passes; a pass consumes the pick. The commissioner can undo either.

**Protections are read, never applied.** `protTriggered()` is a pure function of
the order: "top N protected" means the pick stays with the club it came from if
it lands in the first N slots, and `effHolder()` is what every screen uses.
Re-saving the order re-reads it and nothing has to be unwound. The one place a
protection *moves* a pick is `closeDraft()`, which rolls an obligation marked
`roll` onto the next draft and stamps `rolled` on the record so it cannot happen
twice.

**Picks trade like any other asset.** They move $0, are not in `headcount()`, and
so touch neither salary matching nor the hard cap — an offer of picks alone is
still a real offer. The sending club sets the protection in the builder; it is
carried on the offer (`givePk`/`getPk`) and written onto the record only when the
trade executes. `recheckTrade()` rejects a pick the club no longer holds or has
already used.

**The rookie class is placeholder data** (`ROOKIES`, `ROOKIES_PLACEHOLDER`), and
every screen that shows it says so. When the stats feed lands, replace the array
wholesale — nothing in the draft code reads anything but `n` and `p`.

---

## The 920-game cap

The league caps each club at **920 total player-games per season**. This is the
single most important modelling constraint and it is easy to forget.

It means **per-game rate matters far more than availability**. A player who plays
78 games is not worth much more than one who plays 70 if you are already at the
cap — the marginal games are simply discarded.

`fullTotals()` allocates game slots to a club's highest-rate players first, then
fills any remainder at replacement level so a half-built roster is never compared
against a complete one. Do not remove the replacement fill; without it every
comparison against the current league is meaningless, because most clubs are only
partly signed during the offseason.

Replacement level is the median minimum-salary ($1.00–1.25) player of 2025-26.

---

## Player data

`RATER` holds 390 players: everyone on a league roster plus every free agent who
played 25+ games at 12+ minutes in 2025-26. Source: Basketball-Reference,
transcribed by hand. Treat any single surprising number as worth verifying.

`BENCH[cat][position]` is the real distribution of what finished 1st through 9th
in each category, averaged over the five full nine-team seasons (2022–2026). The
2021 COVID season is **excluded** — at 731 mean games played its totals sit far
below every other year and blending it in drags the benchmarks down.

Ratings are 9-category z-scores against the whole 390-player pool, with FG% and
FT% weighted by attempts so a high volume of bad free throws hurts proportionally.

### Name matching — this has bitten us
Roster names come from the league spreadsheet, stat names from box scores. Six
differ: Jokić/Jokic, Şengün/Sengun, Vučević/Vucevic, Poetl/Poeltl, Wendell Carter
(Jr.), IR-Kevin Porter Jr. Before `canon()` existed, those players silently
contributed **zero** to every projection — Osborn was missing 1,801 points because
the best player in the league was invisible.

**Always route player lookups through `canon()`.** It handles the alias map plus
an accent-stripping fallback.

`rightsOf()` compared raw strings and so was part of this: asked about "Jakob
Poeltl" (the box-score spelling) it never found "Jakob Poetl" on N. Fink's
roster, and told the club it held no Bird rights on its own expiring player.
It matches through `canon()` now.

The seed data carries Poeltl twice — expiring on N. Fink as "Jakob Poetl" and
signed on Christman as "Jakob Poeltl". `canon()` folds them into one player and
the signed deal wins. The commissioner's player table is where that gets fixed.

---

## Testing

**Do not ship on `node --check`.** Several of the worst bugs in this project were
syntactically perfect and completely broken:

- `const redraw={}` declared after code that assigned to it — a temporal dead
  zone error that killed the entire script on load. The page rendered styled and
  completely inert.
- `.moremenu{display:flex}` overriding the browser's `[hidden]{display:none}`,
  because author CSS beats the UA stylesheet. The menu was permanently open.
- `nav{overflow-x:auto}` clipping the absolutely-positioned dropdown, so it opened
  correctly every time and was never visible.
- `S.teams[t].pin` throwing inside a form-submit handler, so sign-in died silently
  and the dialog closed. Users reported "nothing happens."
- Deferring focus into the sign-in dialog by 50ms. `showModal()` focuses the club
  select, so anything typed in that window went into the dropdown — changing the
  club by type-ahead — and a field-blanking step on the same timer wiped the PIN.
  Typing "1234" the instant the box opened left "4". Nothing about opening that
  dialog may be deferred; the PIN carries `autofocus` and is focused synchronously.

The reliable method is a Node DOM stub that actually executes the script and
exercises the functions. It lives in `tests/`:

```
node tests/test.js        the app: 402 assertions against the real functions
node tests/smoke.js       renders every view in BOTH season phases, as signed-out,
                          commissioner and each GM — the live season is what opens
                          the lineup block, the IR and the lock
node tests/mail.test.js   the mail functions' pure logic, no Netlify runtime
```

If you are checking that code *parses* rather than *runs*, you are testing the
wrong thing.

Point it at an older build to prove a test is not vacuous:
`node tests/test.js /tmp/old.html`.

Watch for false negatives in the harness itself. Three have bitten already, all
in `tests/dom.js`:

- the app registers multiple document click listeners, and a stub that keeps only
  the last one reports working features as broken;
- `querySelectorAll` returning fresh objects on every call silently discards the
  handlers the app just bound to them, so every button looks dead;
- a plain `value` property does not coerce to a string the way a real input does,
  so `.value.trim()` throws on a number the app itself assigned;
- replacing a `<select>`'s options resets its value in a browser, and a stub that
  keeps the old string reports a correctly defaulted dropdown as holding a stale
  club;
- an attribute parser that only understands `k="v"` never sees `<option selected>`
  or a bare `hidden`, which are exactly the two things this app leans on most.

Note that top-level `let`/`const` do not land on a vm's global object. `run.js`
appends an epilogue exposing them as `ctx.__X`; add a name there if a test needs
one.

---

## Email

GMs can put an address on their club (`S.teams[t].email`) and opt into a daily
digest (`S.teams[t].daily`). Both live in the **rosters** slice, which means they
carry exactly the same exposure as the PINs: anyone who can reach `/api/state`
can read them. The Commissioner tab says so in a banner and the dialog repeats
it. Do not present these addresses as private.

Sending is Resend over plain `fetch` — no SDK, so `package.json` keeps its single
dependency. Everything is environment variables, set in Netlify under Site
configuration → Environment variables:

| Variable | | |
|---|---|---|
| `RESEND_API_KEY` | required | nothing is sent without it |
| `MAIL_FROM` | required | e.g. `League Ledger <ledger@yourdomain.com>`; the domain must be verified with Resend |
| `SITE_URL` | optional | links back into the app |
| `LEAGUE_TZ` | optional | defaults to `America/New_York` |
| `MAIL_DAILY_CAP` | optional | defaults to 200 sends a day |

**With no key set, every send returns `{ok:false, reason:"not configured"}` and
the caller carries on.** That is the deliberate default: a fresh deploy never
mails anyone. Keep it that way — no code path may assume mail is available.

`/api/notify` (`notify.mjs`) sends a trade-offer nudge and a test message. **It
never accepts an address.** It takes a club *name*, looks the address up in the
rosters slice, and sends there — so it cannot be turned into an open relay. It
checks the club's PIN, which is the same honour-system bar as the rest of the app
and stops accidents, not a league-mate who reads the source. The real protection
is the daily ceiling in `lib/league.mjs`, which is a cost control, not a security
control.

Mail is always a nudge, never the mechanism. A trade offer is saved and visible
on the other GM's Trades tab before `notify()` is called, and every failure is
soft — the toast says whether the mail went out. Do not make a move depend on a
send succeeding.

`daily.mjs` is a **scheduled** function (`export const config = {schedule}`), not
an endpoint. It mails every club that has an address and the digest switched on,
listing the league's transactions from the previous day, and writes the `digest`
key so a re-invocation cannot send twice. Scheduled functions only run on a
git-connected deploy — a drag-and-drop upload schedules nothing.

"Yesterday" means yesterday in `LEAGUE_TZ`, not UTC. A move made at 9pm Eastern
is stamped after midnight UTC and would otherwise be filed under the wrong day
and mailed a digest late. `dayIn()` in `lib/format.mjs` handles this and is the
single most test-worthy thing in the mail code.

**The digest carries no stats**, and that is not an oversight — the nightly stats
feed below is not built, so there is no `daily/<date>` key to read. The email
leaves a marked slot saying so. When the feed lands, the stats half drops into
`digestBody()` without redesigning the email.

`lib/format.mjs` imports nothing at all, so all of this is testable with no
Netlify runtime and no `@netlify/blobs` installed. Put new pure logic there
rather than in `league.mjs`.

## Chat and notes

Two things share the Chat & notes tab, and the split is the point.

**League chat** is public to anyone who can reach the app. It rides its own blob
key, `chat`, deliberately outside the five slices: it is written constantly and
read by nobody who cares about contracts, so putting it in `rosters` or
`settings` would race every roster write and grow the payload the auction polls
every four seconds. Its own key costs nothing and cannot collide.

Posting goes through the **same append endpoint the transaction log uses** —
`POST /api/state?key=chat&append=1` prepends server-side with no revision check,
so two GMs posting at the same instant both survive. The server keeps the last
5000 entries; at a few hundred bytes each that is about a megabyte at the very
worst, and the client draws only the newest `CHATSHOW`. Posts cap at
`CHATMAX` characters.

Deleting is the one operation that needs a revision, because it rewrites the list
rather than adding to it: a 409 re-reads and retries once. A GM may delete his
own posts, the commissioner anybody's.

Chat is **not** in `?key=all` and is not polled unless the tab is open — opening
it is what fetches it. Do not fold it into the slice poll.

Every post is escaped through `htmlEsc()` on the way to the screen. It is the one
place in the app where a league-mate types text that everyone else renders.

**My notes** is the opposite of the chat: nobody else can read it. It rides the
encrypted club-private store described above, so it follows the GM between
devices while a league-mate who fetches the key gets ciphertext.

## Auth

Honor-system PINs, stored in the `rosters` slice. Anyone who views source can read
them. This prevents accidents and gives an audit trail; it does not stop a
determined league-mate. Netlify's password protection is a paid feature.

Commissioner PIN defaults to `0000` and there is a warning banner until it is
changed.

Sign-in persists in `localStorage` (`ll_me`). It used to be `sessionStorage`,
which the host wipes on remount — that made saved projections look lost, because
the key fell back to `proj_anon`.

---

## Conventions

- Every table gets an `id` and `data-k` headers, wired via `sortable()`. Nulls
  sort last regardless of direction.
- Player names in tables carry `class="pname" data-player="<name>"`. A delegated
  handler opens the shared card, so projections can be edited from anywhere a
  player appears. A whole row may carry `data-player` instead, which is what the
  Free agent classes tab does — its rows used to render a card into a panel
  pinned under the entire grid, so reading the stats you had just asked for meant
  scrolling past four sorted tables. Prefer the modal.
- Two themes via `[data-theme]` on the root. Every colour is a token. There is a
  global `[hidden]{display:none!important}` because author CSS otherwise wins.
- Sentence case for headings and buttons, not tracked-out caps. Monospace for
  numbers — this is a ledger and tabular figures aid scanning.
- Six primary nav tabs; everything else lives in the More menu, which sits
  **outside** `<nav>` to escape its overflow clip and is positioned in JS from the
  button's bounding rect.

---

## Working on this together

**Before opening a pull request, and again before merging one, check that the
code you touched has not changed underneath you.** This applies to everyone —
human or Claude, every time, no exceptions for a small diff.

```
git fetch origin main
git log --oneline <your-branch>..origin/main            # has main moved?
git log --oneline <base-sha>..origin/main -- <files>    # did anyone touch what you touched?
git status --short                                      # is your tree clean?
```

If `main` has moved: merge it into your branch, re-run `node tests/test.js` and
`node tests/smoke.js`, and only then open or merge the PR. Never merge a branch
whose base has moved without re-running the tests — a clean textual merge of this
file proves nothing about whether the two changes still work together.

This matters more here than in a normal repo, and for one reason: **the whole app
is a single 333KB file.** Two people working on `deploy/index.html` for more than
a day or two will collide, and a conflict in that file is miserable to resolve by
hand. So:

- Keep branches short-lived. Merge within a day or two rather than letting a
  branch run for weeks.
- Pull `main` into your branch regularly while you work, not once at the end.
- Say what you are touching before you start, if someone else is active.

**Roster data is not a merge concern — it is a data-loss concern.** `deploy/index.html`
carries the `SEED` rosters and the PINs. Merging the file merges the *code*; league
data edited on two branches ends up an arbitrary mix of both. Roster changes belong
in the app, which writes them to Netlify Blobs. Edit `SEED` only to correct the
original spreadsheet, and never to record a transaction.

**Never merge a red or conflicted PR.** Netlify builds a deploy preview for every
PR (site `symphonious-elf-169404`). Open it and confirm the header chip reads
"shared · N transactions" rather than "this device only" — that is the one check
that proves the function bundled and the Blobs store is reachable. A preview that
renders correctly but says "this device only" is a broken deploy that looks fine.

---

## Not yet built

- The real rookie class. `ROOKIES` is placeholder data until the feed lands.
- CSV import. Export is built; see the commissioner's player table above for what
  reading a file back in would have to get right.
- Nightly stats feed. The rolling-15-day chart is built and waiting on a
  `daily/<date>` key per day. **Use the NBA's own stats endpoints**
  (`stats.nba.com`, e.g. `leaguegamelog` / `boxscoretraditionalv2`) — free, no
  key, one request a night for the whole league rather than a page per player.
  They want a browser-ish `Referer` and `User-Agent` or they hang, which is fine
  from a Netlify function. Do not scrape Basketball-Reference: it prohibits it,
  and 570 page fetches will not finish inside the function timeout.
- **Daily stat accrual.** The lineup structure is built — slots, eligibility,
  bench, IR, lock — but nothing counts a night's box score against a started
  player yet. That is the nightly feed's job. `startedOn(club)` is the hook.
- Optimising a lineup beyond `autoLineup()`'s "best available who fits, scarcest
  slot first". A real optimiser needs the daily feed and the schedule.
- Multi-year weighted projections and historical comps.
- Deriving rosters from the transaction log rather than storing them directly.
  The log is already a complete append-only record, so this is possible whenever
  it is worth the rewrite. Do not attempt it during a draft.
