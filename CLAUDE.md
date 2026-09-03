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
  netlify.toml                  publish + functions config
  package.json                  installs @netlify/blobs for the function
  netlify/functions/state.mjs   shared storage API
```

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

### Per-GM projections are NOT in shared storage
They live in each GM's own `localStorage` under `proj_<club>` and are never sent
to the server. This is a privacy decision, not an oversight — a GM's projections
are their competitive edge. Do not "helpfully" sync them to Blobs.

Consequence: projections do not follow a GM across devices. That trade-off was
made knowingly. An export/import button would be the right fix if it comes up.

### The auction strategy board IS synced, encrypted
A GM's strategy board (ranked auction targets, priority, a planning max bid)
follows them between devices, so unlike projections it does leave the browser.
It is stored under its own key, `strat-<club>`, outside the five league slices.

It goes up **encrypted**, because `/api/state` has no auth and a list of max bids
is worth more to a rival than projections are. AES-GCM, key derived by PBKDF2
from the club's PIN — which the client already holds in the rosters slice, so no
new secret is stored and it survives a reload. A league-mate who fetches
`?key=strat-<club>` gets ciphertext.

This is the same honour-system bar as the rest of the app: it stops someone
reading your board, not someone who digs the PIN out of `rosters` first. Do not
present it as real confidentiality.

Last write wins, by a timestamp inside the payload. A 409 is retried once against
the server's revision. localStorage keeps a copy, so the board still works with
no network — the save toast says "synced" or "this device only". Changing a PIN
makes the stored copy undecryptable; the client falls back to its local copy and
re-uploads rather than losing the board.

### The strategy board's pool is not faPool()
`faPool()` is the free agent *class* — it counts a player taken only when
`y[1]` is set, so the 45 players in the last year of a deal count as available
even though they are on a roster today. The board uses `stratPool()`, which
excludes anyone on any roster at all. Both sides go through `canon()`; without
it "Jakob Poetl" and "Jakob Poeltl" read as two different players and he slips
through as unrostered.

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

**Rookie draft**: three years with a rookie option on the last. First pick is
3.57% of the cap rounded up to $0.25, each later pick $0.25 less. Rookies sign
after the auction and do not consume auction cap space.

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

The reliable method is a Node DOM stub that actually executes the script and
exercises the functions. Build one, run the interaction, assert on the result.
If you are checking that code *parses* rather than *runs*, you are testing the
wrong thing.

Watch for false negatives in the harness itself — the app registers multiple
document click listeners, and a stub that keeps only the last one will report
working features as broken.

---

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
  player appears.
- Two themes via `[data-theme]` on the root. Every colour is a token. There is a
  global `[hidden]{display:none!important}` because author CSS otherwise wins.
- Sentence case for headings and buttons, not tracked-out caps. Monospace for
  numbers — this is a ledger and tabular figures aid scanning.
- Six primary nav tabs; everything else lives in the More menu, which sits
  **outside** `<nav>` to escape its overflow clip and is positioned in JS from the
  button's bounding rect.

---

## Not yet built

- Nightly stats feed. The rolling-15-day chart is built and waiting on a
  `daily/<date>` key per day. Use a real API, not scraping — Basketball-Reference
  prohibits it and 570 page fetches will not finish inside the function timeout.
- Auto-populate and optimize lineups. Both need the daily feed first.
- Multi-year weighted projections and historical comps.
- Deriving rosters from the transaction log rather than storing them directly.
  The log is already a complete append-only record, so this is possible whenever
  it is worth the rewrite. Do not attempt it during a draft.
