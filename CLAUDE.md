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
    schedule.mjs                GET /api/schedule — NBA tip-off times, cached daily
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
| `rosters`  | cuts, signings, trades             | per-club **three-way** merge |
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

### The three-way rosters merge
`mergeSlice('rosters')` compares three copies, not two. `BASE[k]` holds the last
state **the server gave us** — anchored on the first read, on every poll that
applies a slice, and after every successful write — and a club is taken from
`mine` only where mine differs from that base, which is a change I actually made.
A club I did not touch is left as the server has it.

Comparing only mine against theirs meant any club that differed was taken as
mine, so a write from a tab whose copy of another club was a few seconds stale
**silently overwrote that GM's signing**. With no base copy — a first write
before any read — every club reads as changed and the writer wins outright,
which is the old behaviour and the right default for a league never read.

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

### A contract is money against a named season
`p.y` used to be a four-slot array where `y[1]` meant "the season being built or
played" and `y[0]` the one before it. **The window WAS the model**, and nothing
ever moved — so contracts never progressed, tenure was measured against a league
year that never advanced, and a release stamped with the current season could
never lapse, because the season it compared against was frozen.

A contract is now a **map from season to money owed**:

    p.y = {'2026-27': 5.00, '2027-28': 5.25}

A season with nothing owed is simply absent. That makes advancing the league the
cheapest operation in the app rather than the most dangerous: it is
`S.cfg.season = the next one` and **no contract is rewritten**. There is no
destructive shift to get wrong, running it twice cannot age a roster twice, it is
reversible by setting the year back, and a season already played keeps its
numbers instead of falling off the end.

| | |
|---|---|
| `seasonKey(v)` | anything → `'2026-27'`; the seed's en dash, a hyphen, a bare year or a number |
| `seasonAt(k,n)` / `seasonNext` / `seasonPrev` | walk the calendar |
| `curSeason()` | the season the league is on |
| `normContract(y,cur)` | array **or** map → map; shape-driven and idempotent |
| `salIn(p,key)` / `salNow` / `salPrev` / `salOff(p,n)` | what he is owed, when |
| `contracted(p)` | owed something in the current season — **the "is he signed" predicate** |
| `yrsLeft(p)` | seasons still owed, counting this one |
| `termFrom(price,years)` | a run of seasons from now — what a signing writes |

**Never index `p.y` positionally again.** `salNow(p)` replaced 72 uses of `y[1]`
and `contracted(p)` most of them. The four-slot array is still *read* —
`normContract()` converts it — because the live blob is full of them until each
club is next written, and `tests/test.js` deliberately keeps a case proving it.

**In the offseason `curSeason()` is already the season being BUILT.** The 2026
offseason carries `'2026-27'`, which is why an auction signing writes that season
and not the one just played. So the cycle is: play 2026-27 → close to the
offseason → **advance the year** → auction and draft for 2027-28 → open it.

`normCfg()` canonicalises `S.cfg.season`, or the header would change punctuation
the first time the league rolled and a hand-typed season would not match the keys
on a contract.

### Advancing the league year
`rollSeason()` on the Commissioner tab. `rollPreview()` is **pure** — it computes
what would change without writing — and the confirmation says it: how many deals
owe nothing in the new season and become expiring, how many players reach
`birdYears()` completed seasons, how many release bars lapse, how much dead money
comes off.

**The roll writes `S.cfg.season` and nothing else**, so `unrollSeason()` steps it
straight back and restores everything exactly. Getting there needed dead money to
stop being a stored flag: `c.live` is now only the *fact* that a release was made
mid-season, written once at the cut and never mutated, and `stillCharged(c)`
derives whether it is on the cap — an in-season release, in the season the league
is on, while that season is live. Clearing that flag was the one destructive
thing the roll did.

Everything else follows from the same data being read against a different year.
Bird vests because `leagueYear()` finally moves; contracts expire because the new
season is absent from the map. Nothing is migrated.

**"Reset to the original spreadsheet" is not an undo for the roll.** It restores
the rosters and deliberately keeps the commissioner's settings — cap, tax, PINs,
deputies. The league year is one of those settings, and `SEED`'s contracts are
keyed to the season it was written in, so handing them back a year later left
every one of them reading as expired. The reset therefore restores the year with
them and says so in the confirmation. To undo an advance, step the year back;
the reset also wipes every transaction.

### The roster limit is on ACTIVE players
**15 active, 1 injured-reserve slot.** That is the rulebook's "sixteen men, and
only while one of them is hurt", and it works because `headcount()` has always
excluded the IR. `S.cfg.roster` is therefore the *active* limit, not the number
of bodies — `signPlayer()` and `validateTrade()` both already read it that way.

The offseason has no injured reserve at all, so the same number means 15 flat.

**Activating a man off the IR when the club is full is a swap, not a move.**
`toggleIR()` hands off to `openSwap()`, which asks which active player goes and
runs him through `releaseRecord()` — the release factored out of `cutPlayer()` so
every path that drops somebody writes the same `cuts` entry and carries the same
waiver rules. The release happens *before* the activation: the other order leaves
the roster illegal for the length of a statement, and a merge or a poll reading
it in between would see a club one over.

**Closing the season empties the IR**, which can leave a club at 16 active. It is
told, not fixed — which player goes is the GM's call, not the commissioner's. The
same step drops every stored lineup, since there is no season to have one for.

A league saved before any of this carries the old 16-and-2. `drawAdmin()` shows a
banner when `roster !== 15 || ir !== 1` rather than rewriting a commissioner's
settings behind his back.

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

**The lock is per game, never league-wide.** A player freezes the moment *his
own* game tips off: a five o'clock game locks that man at five and leaves his
team-mate on a half-seven game free for another two and a half hours. So the
lock hangs off the NBA club, and `NBATM` is what turns a player into the club
whose game it is.

    S.cfg.sched[day][NBA team] = 'HH:MM' in league time

`tipOf()` finds a player's game, `lockOf()` compares it to the clock. A club with
no line is not playing — nothing of his locks. A full timestamp is still parsed,
so anything written before this keeps working.

**Tip-off times arrive on their own.** `/api/schedule` (`schedule.mjs`) reads the
NBA's own published schedule —
`cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json` — condenses it to
`day -> club -> "HH:MM"` in league time, and caches that in the `nbasched` blob.
The source file is several megabytes and changes rarely, so it is fetched at most
once a day and only the derived ~30KB is kept. The client fetches one day at boot
and again when the league date rolls over. Nobody types anything in.

Every failure returns 200 with empty `tips` and a `reason`, exactly like the mail
functions: a missing schedule degrades to "nothing is locked", never to a broken
lineup screen.

`tipFor(team,day)` resolves a club: **the commissioner's override first, then the
feed**, and it looks a code up both ways. The workbook writes six clubs shorter
than the NBA's tricodes (`SA`/`SAS`, `GS`/`GSW`, `NY`/`NYK`, `NO`/`NOP`,
`UTAH`/`UTA`, `WSH`/`WAS`) and `TRICODE` folds them together rather than editing
336 rows of `NBATM`.

The commissioner's box is therefore an **override**, not the way tip-offs arrive:
one club per line to correct a wrong time or run a night the feed is down, and it
beats the feed for that club and nothing else. An unparseable line is reported
and dropped rather than silently ignored — a line nobody notices is a club that
never locks.

With nothing on file `lineupNote()` says so, and distinguishes "no games tonight"
from "could not fetch". Do not make the screen imply a lock that is not there.

A locked player is rendered as text, not a disabled control — there is nothing
the GM may do with him, and a dead select invites a click. `clearLineup()` and
`autoLineup()` both step around locked men rather than failing. An unlocked
starter whose game is still to come shows the time instead, so a GM knows his
deadline without doing the arithmetic.

**The row is a stat table, not a list of names.** One grid shared by the header
and every row, so the nine categories line up as columns: PTS, REB, AST, 3P, STL,
BLK, TO, then FG% and FT% last because they are rates and everything else is a
count.

**The table is capped at 1040px, not stretched to the page.** That cap is what
makes the rest work: a per-game number is four characters, so the stat tracks are
held to 60px, and the name takes the slack. Stretch the table to a 1300px screen
and one of two things has to give — either the stat columns bloat to 90px of
white space around "27.7", or the name track stays capped and strands the row in
a void between the dropdown and PTS. Both were tried; the cap is the fix.

`.lurowctl .luname` carries `min-width:120px` and ellipsises. Without a real
minimum it collapses to one letter per line the moment a control beside it wants
room — the bench row has a name, a position tag, a Start select and an IR button
in one flex line, and "Shai Gilgeous-Alexander" set vertically one character at a
time is what a `min-width:0` there looks like. `luLine()` reads `S.daily[day][player]` when
the feed writes one and falls back to the per-game line until then; a live number
renders amber so the two can never be confused.

**Lineup, bench and injured reserve are one stacked table**, not three boxes in
two columns. They share the `.lurow` grid, so the nine stat columns line up all
the way down and a GM reads who is in, who is out and who cannot play as one
thing. Each section gets its own header row and its own chip — the slot letter,
`BN`, or `IR`.

Every row carries the moves that make sense from where it is:

- a **slot** row: the eligible-player select, plus **IR** for the man in it
- a **bench** row: a select of the open slots he actually fits, plus **IR**
- an **IR** row: **Activate**, which is `toggleIR()` and therefore opens the
  release swap when the club is full

No open slot fits a bench man and it says so rather than offering a control that
cannot work. **Start all** fills every open slot from the bench, scarcest first;
**Bench all** is its opposite.

**Moving a man to the IR clears his slot in the same write.** Leaving it filled
would start a player who cannot play. A locked man cannot go to the IR either —
his game has started and the injured reserve is not a way around that.

`drawMe()`'s club switch redraws the lineup as well as the roster. The lineup
block reads `meTeam()` but `render()` owns it, not `drawMe()`, so the
commissioner switching clubs used to leave the previous club's lineup on screen.

**The in-season header drops three cells** — average historical place, categories
at a winning level, and the mid-level exception. They are offseason
roster-building numbers; once games are being played they are noise above a
lineup.

**The IR sorts to the bottom of My Roster whatever the sort is set to**, and
carries `tr.isir` for the dimming. A man who cannot be started is not competing
with the ones who can.

**Three tabs are offseason-only** (`OFFSEASON_TABS`): the auction, the free agent
classes that feed it, and the rookie draft that follows it. `markPhaseTabs()`
hides them once the season is live and moves anyone standing on one somewhere
real — a hidden tab whose panel is still open is worse than either state.

### Free agency is a season activity
In the **offseason** a club adds players by winning them at auction or drafting
them, so a GM signing a free agent directly would be going round the room. Both
paths refuse him: the Sign button on My Team's free agent list only appears when
`canSignFA()` is true, and Quick sign's Record is disabled. The commissioner is
not bound by either — his tools exist to make the ledger match reality, including
recording what the auction did.

**In season** a GM signs from the free agent list on My Team. Every such signing
is one year at `S.cfg.minSal`, and the calendar decides the rights:

- **before `S.cfg.deadline`** — Early Bird. The club finishes the year with him,
  which is what the rulebook asks of Early Bird.
- **after it** — nothing. A rental: one year, no rights, gone in the summer.

`deadlinePassed()` compares league dates. With no deadline set nothing has passed
it, so every in-season signing earns rights — which is the safer default when the
commissioner has not said otherwise.

`signPlayer()` takes an optional `{bird, why}`. Only the in-season path passes it;
the auction and the draft set `p.b` themselves, so everything else leaves it
alone.

**Quick sign is the same signing, not a second one.** `v-draft` is in
`SEASON_TABS` and is hidden in the offseason, the mirror of `OFFSEASON_TABS`.
There is no salary or term to type: an in-season signing is one year at the
minimum and the calendar decides the rights, so the form shows fixed terms and
calls `signFA()`. The free inputs it used to carry invited a deal the rulebook
does not allow.

**My Team's free agent table is not in a `.scroller`.** Its Sign button is the
last cell, and `.scroller table{min-width:760px}` inside `.twocol` put that cell
60-220px past the right edge at every screen size — the button rendered, bound
its handler and could not be reached. It runs full width under `.rosterwrap` with
the impact card below. This is the third time that combination has hidden an
action column; the first two were My Roster's Cut and the Builder's Drop.

### Bird rights are earned, not written down
Three seasons with one club. It does not matter how he arrived — a free agent
pickup, the rookie draft and the auction all start the clock — and the rights
**travel with him in a trade**. Any other way of changing clubs starts it again.
That is what `p.acq` records, and it is why the year acquired sits on every
roster entry.

So tenure is the answer and the spreadsheet's rights column is not:

| | |
|---|---|
| `leagueYear()` | the first year of `S.cfg.season` — `'2026–27'` is 2026 |
| `tenureOf(p)` | seasons with his current club, or **null** when `acq` is missing |
| `birdRight(p)` | `''`, `'Early'` or `'Yes'` — **the predicate every caller must use** |
| `birdKind(b)` | still reads the free-text label, and is now only a helper |

Tenure is **completed** seasons, `leagueYear() - acq`, which is why a 2024
signing has two in the 2026-27 league year and three once it rolls to 2027-28 —
advancing the year is what vests Bird, and `rollPreview()` counts who.

`birdRight()` returns `'Yes'` at `birdYears()` seasons or more, whatever the
label says. Below that a label of `Yes` buys **nothing** — `rightsOf()` reads
`birdRight()`, so a phantom Bird no longer widens `bidCeiling()`. `p.b` is still
read for **Early Bird**, which is a mid-season signing before the deadline and
has nothing to do with three years.

The one exception is an entry with **no acquisition year at all** — twelve in the
seed. Tenure cannot be computed, so the label is all there is and it is honoured,
which errs towards leaving a club the rights it believes it has.

**The seed disagrees, loudly: 63 players marked `Yes` have served under three
seasons.** They are not rewritten. `birdMismatch()` lists every row where the
column and the earned answer differ and `drawAdmin()` banners it, the same choice
the roster-size banner makes — the fix is the year acquired on the edit dialog,
not the code guessing. Trades preserve `acq` because `applyTrade()` moves the
whole entry; `signPlayer()` stamps `leagueYear()` on a player arriving from
another club, and the league year is used everywhere rather than
`new Date().getFullYear()`, so a January signing belongs to the season it was
made in.

### Awarding is the commissioner's, not the room's
The GM who nominated a player used to be able to close his own lot, which let him
end the bidding the moment he was in front. **Only `hasComm()` sees the Award
button**, and `closeAuction()` refuses anyone else. Everybody else gets a line
saying the commissioner awards him when the bidding is done.

An award goes one of two ways: the winning club signs him, or he is
**restricted** and the club holding matching rights is asked first.

That question is put to *that GM in the app* — not answered on his behalf by a
`confirm()` in front of the commissioner, which is what it used to be. He is the
one with the decision and the commissioner is not sitting next to him. So the lot
parks in a third status, **`match`**, until he answers:

    open  ->  match  ->  closed

`placeBid()` only accepts `open`, so nobody can slip a bid in while the rights
holder is thinking, and `mergeSlice('auction')` ranks the three so a further-along
copy beats a stale one outright rather than being decided on bid count.
`matchOffer()` is the pending offer; `canAnswerMatch()` is the rights holder **or**
`hasComm()` — a GM who has gone quiet cannot hold the room up for ever.
`answerMatch(true|false)` resolves it.

**Nothing is written unless the contract fits.** `signBlock(team,name,price)`
returns the one-sentence reason a club may not put that deal on its books, or
null. It is asked before every award *and before the match is even offered* — a
club that could not honour the contract is never asked to match; the lot goes
straight to the winner and the log says why. It enforces the same rules
`signPlayer()` does (waiver restriction, roster limit, hard cap, `bidCeiling()`);
keep the two in step.

`awardTo()` is the single write, and it passes `{force:true}` to `signPlayer()` —
the only caller that does. That skips `canEdit()`, because the actor has already
been established (a commissioner or deputy awarding, or the rights holder
declining and so sending the player to somebody else's club) and the contract has
already been checked.

### The auction nominates on a snake
`S.cfg.nomOrder` is the commissioner's round-one order. Round two runs it
backwards, round three forwards again, so the club at each end nominates twice in
a row — a snake. `nomSlot(i)` is the pure function; `nomOnClock()` is what the
screens read.

**How far through the order we are is counted from the transaction log**, not
stored. Every nomination writes one line, so `nomCount()` reads the append-only
record of what actually happened: there is no counter to drift, nothing to reset,
and two GMs cannot race it.

**A full club is skipped, not waited on.** It cannot sign anybody, so blocking the
room on it would stall the auction; `nomOnClock()` walks forward to the first club
with space and reports how many it stepped over. With every club full there is no
clock and the auction is over.

With `nomOrder` empty, nomination is the free-for-all it was before — that is the
migration path, not a bug.

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
unsigned free agent. **The salary columns are named for the seasons they hold**
(`salary_2026-27`), not their position, because position stopped meaning anything
when contracts became season-keyed; `csvSeasonCols()` is evaluated per export so
the headings move with the league. Salaries are plain numbers and the raw `o` and `b` text
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

**Anyone may build any trade; only the clubs in it may propose it.**
`tradeSideOf(v)` returns the signed-in GM's side or null, and both `drawTrade()`
(which disables the button and says why) and the click handler check it — a
disabled button is a signpost, not a rule, and a stale render leaves it
clickable. The machine is for working out what a deal between two rivals would do
as much as one of your own, so building stays open to everybody. The commissioner
has no club, so he answers for whichever club he is acting as on My Team.

**The Stats button in the pick lists opens the shared modal**, like every other
clickable player name. It used to render a card into a panel below the builder,
so reading the stats you had just asked for meant scrolling past both pick lists
and losing your place — the same fault the Free agent classes tab had, and the
same fix. `#tradeDetail` is gone.

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

### A club cannot buy back what it paid to release
Two rules sit on a release and they are **not the same rule**:

1. **Above the minimum.** A club that releases a man for more than `S.cfg.minSal`
   cannot sign him back **for the rest of that season and the following
   offseason**. That window is one release cycle, so it is the same test either
   side of the phase switch — a **hard bar in both phases**. Cutting a $13.75
   contract and buying it back at $1.00 is a renegotiation, not a release.
   Without the in-season half a club could cut a $4.00 man in February and
   re-sign him at $1.00 the same afternoon: the dead money makes that cost more
   for the year, but it still clears his books for next season.
2. **A multi-year deal**, the rulebook's own rule below: hard in the first
   offseason after the release, minimum-only during the season that follows.

A **minimum** release bars nothing: a GM parking an injured minimum player must
not be locked out of his own club, and there is no salary to renegotiate.

Neither rule restricts any **other** club. A released player is a free agent to
the other eight and always was, which is exactly what makes the barred list worth
showing — those players are still available, just not to you. `drawBarred()`
therefore renders in **both** phases.

| | |
|---|---|
| `cutRecords(team,name)` | every release of him by that club, matched through `canon()` |
| `cutCurrent(c)` | is this release in the current cycle? |
| `cutAboveMin(c)` | released for more than today's minimum |
| `paidCut(team,name)` | his dearest release in this cycle, or null |
| `cutRestriction(team,name)` | `null`, `{hard,why}` or `{minOnly,maxYears,why}` |
| `unsignableFor(team)` | one row per barred player, dearest first |

`cutRestriction()` carries a **`why`**, and every refusal prints it —
`signPlayer()`, `signBlock()`, `placeBid()`, `nominate()` and `restrictionNote()`
all say the same sentence. Nomination is blocked too: a nomination opens with the
nominator's own bid, so a club that cannot sign him cannot put him up.

**The old rule was inert.** `cutRecord()` required `x.blocked`, and **no seed cut
record carries `blocked`, `live` or `at` at all** — so it matched nothing and the
whole restriction did nothing against the only cut list this league has. It also
compared raw strings, and the cut list spells one man "Wendall Carter Jr" where
the box scores say "Wendell".

**The window is the rest of the season he was cut in, plus the offseason after
it** — then it lapses. Because `curSeason()` during an offseason is already the
season being built, "the offseason after 2025-26" is `season='2026-27'` with the
phase still offseason. So Payton Pritchard, released during 2025-26, is out of
N. Daman's reach at the 2026 auction and **free to them the moment 2026-27 goes
live**. That is the whole reason the league year has to be able to move.

`normRosters()` stamps a release that has none with the season just **played**,
not the one being built, and writes `cv` so a stamp from the version that got
this wrong can be told from a real one and corrected. `releaseRecord()` stamps
`cv` at birth. Multiple releases of the same man resolve to the **dearest**:
cutting again at the minimum must not clear the bar.

The seed bars seven players across three clubs — D. Fink (Brook Lopez $5.75, Kon
Knueppel $4.50, Dereck Lively II $3.25), N. Fink (Myles Turner $13.75, Derik
Queen $3.75, Jalen Green $1.25) and N. Daman (Payton Pritchard $1.25) — all
released during 2025-26, so all seven lapse when 2026-27 opens.

`drawBarred()` is the panel on the auction tab; the club page's release
history tags each barred row; the strategy board tags them too.

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
node tests/test.js        the app: 891 assertions against the real functions
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

**`querySelectorAll` only understands attribute selectors.** `#tabs button` finds
nothing, so anything reached that way — `goTab()`, `markPhaseTabs()` — cannot be
asserted in Node. Test the rule there and verify the DOM in a browser.

**Chromium is available in this sandbox** at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, with `playwright-core`
installable. Load `deploy/index.html` over `file://`, drive it through the
globals — `applySlice('settings',{...fresh().cfg,phase:'season'})`, `render()`,
`goTab()` are all function declarations and therefore on `window` — and measure
or screenshot. Three lineup layouts were rejected that way before one shipped,
and the tab hiding above was confirmed there rather than guessed. `S` and `me`
are top-level `let`s and are **not** reachable; go through `applySlice()` and
`localStorage.ll_me`.

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

### Commissioner access is not the commissioner login
Two people run this league and one of them also has a club, so the tools cannot
hang off the commissioner login alone. A club named in **`S.cfg.deputies`** signs
in as itself — its own roster, its own encrypted notes, its own turn on the
auction's nomination snake — and *additionally* carries the Commissioner tab and
every power on it. `DEPUTY_SEED` is `A. Daman` and `N. Daman`.

The app asks two different questions and they are not the same question:

| | |
|---|---|
| `isComm()` | am I the commissioner login, with no club of my own? |
| `hasComm()` | may I use the commissioner's tools? |

Everything meaning **"acting as a GM"** must keep asking `isComm()`: the club
switcher on My Team, nominating, `cboxRemoteKey()`, who a log line is attributed
to. Everything meaning **"may I do this"** asks `hasComm()`. Do not widen
`isComm()` itself — that would give a deputy the commissioner's clubless identity
and strand him from his own team.

`canGrantComm()` is `isComm()`: only the commissioner login hands access out or
takes it back, so a deputy can neither promote himself nor demote the man who
appointed him. `toggleDeputy()` writes the **settings** slice and logs it.

`normCfg()` seeds the list **only when the key is missing**, never when it is
present and empty — otherwise revoking the last deputy would silently re-grant
him on the next load. It runs in `applySlice('settings')` and at boot.

### Who runs a club, as opposed to what it is called
A club name is a label, and labels change — clubs get renamed, sold and handed
on. **`S.teams[t].gm = {first,last,at}`** is the person behind it, written once
and then fixed. That is the whole point: a name its holder can edit is not an
identity.

It rides the **rosters** slice, so it merges per club like a cut or a signing,
and `renameClub()` carries it across for free — the rename moves the whole club
object, which is exactly the case this record exists for.

| | |
|---|---|
| `gmOf(team)` | the record, or null |
| `gmName(team)` | `'Nathan Daman'`, or `''` |
| `clubWho(team)` | `'Osborn (Nathan Daman)'`, or just the club |
| `gmNameError(f,l)` | why this pair cannot be recorded, or null |
| `saveGmName(team,f,l)` | the one writer; confirms, because it is permanent |

**Fixed means fixed *to the GM*.** `saveGmName()` refuses a second write unless
`hasComm()`, so the commissioner can still correct a typo — an identity nobody
can repair is worse than one its owner cannot casually rewrite, and he is
already the reset path for a forgotten PIN. A correction keeps the original
`at`; only the names change, and both writes are logged.

Once it is on file the Settings form is **replaced by the record** rather than
left editable-looking and then refused on save. The club page carries a
`.gmpill` and the commissioner's GM access list shows it under the club name,
which is where you go to ask who a club actually is.

`nameClean()` collapses whitespace and trims; beyond "both names present, under
40 characters, contains a letter" the app does not second-guess what somebody is
called.

### A GM's own settings
`v-settings` is his club's name, the address the league mails, and his PIN —
three things he used to have to ask the commissioner for. The tab is hidden for
the commissioner login, which has no club; a deputy sees it for his own club, as
`isComm()` is false for him.

Changing his own PIN needs the **current** one; the commissioner's GM access list
stays the reset path for a GM who has forgotten it. A PIN change re-keys the
encrypted `cbox*` stores by reloading them — the server copies can no longer be
opened, `cboxPick()` therefore keeps the local mirror, and `cboxLoad()` re-uploads
it under the new key. Recovery, not loss.

**A rename is a migration, because the club's name IS its key.** `renameClub()`
moves, in one write: the `S.teams` key, `picks[].from` on *every* club (a pick is
identified by its origin club), `trades[].a`/`.b` and the picks inside them, the
live auction (`by`, `leader`, `winner`, every bid, the proxy `max` keys, a
pending `match`), `cfg.nomOrder`, `cfg.deputies` and `cfg.draft.order`.
`moveClubLocals()` carries this browser's `<kind>_<club>` mirrors across.

**The transaction log is deliberately left alone**, and so is `HIST`. The log is
the append-only record of what happened under the name the club had at the time;
rewriting it to match a new name would make the ledger lie about its own history.

**A rename REMOVES a key, and the rosters merge could not express a removal.**
It started from the server's copy and only ever added or overwrote, so the old
name came straight back and the league showed the club under *both* names on
every screen that lists clubs — reported from a phone, on Contracts.
`cfg.renames` is the fact the merge was missing: `renameClub()` and
`removeClub()` both call `noteRename()`, and the merge drops a club only when
`renamedAway()` says it went **and** my own copy agrees it is gone, so a name
legitimately used again is never swept up. `renamedAway()` walks the journal in
order, so a club renamed away and later renamed back reads as present.

**The merge was only half of it. Boot put the club straight back.** `seedTopUp()`
tops up any `SEED` club the stored league is missing — a league never written, or
one saved before a club joined the seed, needs that — and losing a key is exactly
what a rename does. So the old name returned on the very next page load, carrying
the full seed roster and an empty PIN, and the league showed the club under both
names again. Worse, once the ghost is in `S.teams` the merge *keeps* it: `mine[t]`
exists, so the removal pass steps around it — that is the guard protecting a name
legitimately used again — and this browser's next write pushes the ghost to the
league database for everybody. `seedTopUp()` therefore asks `renamedAway()` too,
which covers `removeClub()` as well, since it writes `noteRename(t,null)`.
A club that is genuinely missing is still topped up; only a deliberate removal is
protected.

**The base copy has to be anchored on the MIGRATED shape.** `Store.get()` can only
anchor on the raw slices — `normRosters()` reads `curSeason()` and so needs an `S`
that does not exist until boot assigns it — and `normCfg()`/`normRosters()` then
migrate **in place**. That left `BASE` holding the pre-migration shape while `S`
held the migrated one, and `mergeSlice()` tells "I changed this club" from "I am
out of date about it" by comparing serialised copies: every club carrying a legacy
four-slot contract read as *mine*. It stole a league-mate's signing on the next
409 — the exact bug the third copy was added to prevent — and it re-added a club
that had been renamed away. `anchorBase()` re-anchors after the migrations, and
only when there is a read to re-anchor on: with no base at all the first write
wins outright, and overwriting that with a seeded roster would quietly give the
league away.

**Removing a club** is `removeClub()` on the Commissioner tab, and it exists
because the app could add a club and never remove one — survivable until a
rename could leave two. It sweeps exactly what `renameClub()` moves: picks whose
origin was that club (on every club, not just its own), offers it is part of, a
live auction lot it is in, and its place in `nomOrder`, `deputies` and the draft
order. `clubRemovalCost()` is pure and is what the confirmation counts. The last
club cannot be removed, and the log is left alone.

`clubNameError()` is the check: blank, over 40 characters, `__comm__`, unchanged,
or a name another club already has (case-insensitively).

**Anything holding a club NAME must be re-checked against `S.teams`, never
trusted** — a rename arrives in every other browser on the poll. `render()`
re-resolves `activeTeam`, signs out a `me` whose club is gone (as the boot
sequence has always done), and rebuilds the trade machine's `#tA`/`#tB` and the
commissioner's `#meAs` whenever the club list changes. Those selects were keyed
on option *count*, which a rename does not change, and `drawTradeLists()` reads
`S.teams[select.value].r` straight off one.

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

## A shooting rate is never shown without its volume

FG% and FT% are scored **weighted by attempts**, so a percentage on its own is
half the fact: .900 on two free throws a night and .900 on nine are worth very
different amounts, and only the second wins the category. Every screen that
shows one of these rates therefore shows the makes and attempts it came from.

`RATER` always carried all four numbers (`s.FG`/`s.FGA`, `s.FT`/`s.FTA`) — it
was only the tables that dropped them. Seven of the ten stat tables did not
show FG% or FT% at all, and none of them showed volume anywhere.

| | |
|---|---|
| `shotPct(m,a)` | the rate, or **null** — never a divide by zero |
| `pctText(v)` | `.569`, the box-score form, or an em dash |
| `madeAtt(m,a)` | `9.9‑17.4`, joined by a **non-breaking** hyphen |
| `shotCell(m,a,edited)` | one cell: the rate, and under it what it is made of |
| `shotCells(s)` / `shotHeads(H)` | the pair of cells, and the pair of headers |
| `shotCellsVs(cur,base,mark)` | the same, with the projections table's amber mark |

**It goes inside the cell, not into new columns.** The rate is the headline and
the volume qualifies it, which is the order the league actually scores in — and
four new columns across seven tables would have undone the mobile work in the
section below. The lineup rows get the same treatment for the same reason:
that grid is tuned to a 1040px cap and two more tracks is exactly what the cap
exists to prevent.

The hyphen in `madeAtt()` is `\u2011`, not `-`. A stat track is four characters
wide and "9.9-17.4" must not wrap onto two lines inside it.

**A rookie has no box score at all** — `s` is null, which is what `hasStats()`
is for — so every one of these is null-safe rather than throwing on `s.FGA`, and
`shotCells(null)` still renders two cells so the row keeps its column count.

**The player rater's two shooting columns are z-scores, not rates.** The header
said FG% and the number under it was `p.z.FG`. Both the real rate and the volume
now sit beneath the z-score (`td.zshot`), because the z-score alone hides the
volume that earned it.

`clubTotals()` and `tradeCats()` keep the sums the rate was computed from, as
`raw`. `standings()` ranks by `PCATS` keys only, so the extra key is invisible
to it; `fullTotals()` already returned them as `agg`. That is what lets the
what-if build, the impact panel and the trade swing table show a club's volume.
In the impact panel it goes in the per-game column, which meant nothing for a
rate and carried an em dash.

**Two tables cannot show volume, and it is not an oversight.** `PROF` and `HIST`
are static historical tables holding percentages only — the makes and attempts
behind them were never transcribed. They show the rates and nothing more.

## Tables on a phone

Three rules, and all three replaced something that looked like a design choice
and was actually data loss.

**A column is never deleted to make a table fit.** `.hide` and `.hide2` used to
be `display:none` below 900px and 820px. That does not narrow a table, it removes
data from it: Contracts showed **two of its seven columns** on a 390px phone, the
free agent classes seven of twelve, the commissioner's player table eight of
thirteen. A column you cannot scroll to is a column you do not have. The classes
are still on about eighty cells — they mark what would go first if it were ever
wanted again — but nothing hides them.

**Wide tables scroll sideways with the name pinned.** `.scroller`, `.rosterwrap`
and `.tscroll` all sticky the first column so a row never becomes an anonymous
line of figures. Two tables lead with a *rank* rather than a name, and a pinned
"231" tells you nothing while the name scrolls away — they carry `data-pin2` and
pin the second column instead, so the rank slides underneath it.

**The action column is pinned to the other edge.** `td.acts` — cut, block, IR, and
Sign on My Team's free agent list — is `position:sticky; right:0`. This is the
fault the app has shipped three times (My Roster's Cut, the Builder's Drop, My
Team's Sign): a button that renders, binds its handler and sits 250px past the
right edge. Letting the stats scroll is what made it safe to stop deleting
columns; pinning the buttons is what keeps it safe. The matching `<th>` carries
`class="acts"` so the header pins with it.

**A long table gets its own scroll box.** `capScrollers()` puts `.capped` on any
`[data-cap]` container whose table is longer than `CAPROWS`, capping it at 70vh
(62vh on a phone). It has to be JS because CSS cannot count rows, and it re-runs
on every render because a filter is exactly what makes a long table short. This
is also what finally makes the sticky header work: a sticky row needs a scrolling
ancestor, and with no cap the page was the only thing scrolling, so the header
slid away and left 390 rows of unlabelled numbers.

**Scrolling, not pagination**, and deliberately. These tables are already sorted
and filtered, so a page number is a third navigation axis on top of two that
already narrow better; browser find works down a scrolled list and not across
pages; and a flick beats tapping a small page control. The `.scroller` div
survives a redraw — only the table inside is replaced — so `scrollTop` and
`scrollLeft` are kept across the four-second auction poll and a GM reading row
200 is not thrown back to the top every time somebody bids.

## The player search box

Six fields let a GM pick a player out of the league by typing. They were
`<input list=...>` against a `<datalist>` of **326-390 options**, which works on a
desktop and is not a control at all on a phone: iOS Safari draws a datalist as a
cramped strip over the keyboard, gives up on lists this long, and other mobile
browsers ignore the element entirely. The only way to pick a player was to type
his name exactly right, from memory.

The `<datalist>` elements **stay**, still filled by the same six lines of drawing
code that always filled them, and are read as nothing but the list of options.
The inputs carry **`data-list` rather than `list`** — that one attribute is the
whole switch, because it stops the browser binding its own dropdown — and
`comboAttach()` renders a real tappable list instead. Nothing that populates a
search box had to change, and everything downstream still just reads
`input.value`.

| | |
|---|---|
| `comboNorm(s)` | accent-stripped, lower-cased, punctuation dropped — so "jokic" finds Jokić |
| `comboFilter(all,q)` | **pure**, and the whole matching rule: starts-with leads, contains follows |
| `comboAttach(inp)` | idempotent; wires one field |
| `capScrollers()` | the table rule above |

Three things about it are load-bearing:

- **The panel is `position:fixed` on `<body>`.** Every other placement can be
  clipped by an ancestor's overflow, which has already cost this app a dropdown
  once — `nav{overflow-x:auto}` hid the More menu, which opened correctly every
  time and was never visible.
- **Attachment is delegated from `focusin`, not done once at boot.** Two of these
  fields live in panels rebuilt from `innerHTML` — the nomination box and the
  strategy board's add row — so the element attached to at boot is thrown away on
  the next draw and its replacement had no combobox at all.
- **Arrowing writes the value into the field as it moves**, like a native select,
  and `COMBOSET` guards the `input` event it fires. Without the guard the field's
  own input listener redrew the panel from the name just written, reset the
  highlight and made the second arrow press a no-op. It is also what keeps Enter
  working: two of these fields carry their own Enter handler, registered first and
  therefore running first, so if Enter had to commit the highlighted row it would
  read a value the handler had already taken. With the value written on the way
  past there is nothing to commit.

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
- Auto-advancing the auction. The snake says who is on the clock, but nothing
  times a nomination out or nudges a GM who has wandered off.
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
