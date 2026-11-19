/* Rolling player stats (deploy/netlify/functions/lib/pstats.mjs).
   node tests/pstats.test.js */
import { compactNight, windowsFrom, lastGames } from '../deploy/netlify/functions/lib/pstats.mjs';
import { noteInjuries, injNight } from '../deploy/netlify/functions/lib/injlog.mjs';
import { nameKey } from '../deploy/netlify/functions/lib/nba.mjs';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra || ''); } };
const line = (PTS, MP = 30) => ({ FG: 4, FGA: 10, FT: 2, FTA: 2, P3: 1, TRB: 5, AST: 3, STL: 1, BLK: 0, TOV: 2, PTS, MP });
const night = (rows) => ({ players: Object.fromEntries(rows.map(([id, n, t, pts]) => [id, { n, t, s: line(pts) }])) });

const plog = { nights: {
  '2026-10-21': compactNight(night([['1', 'Nikola Jokić', 'DEN', 30]]), false),
  '2026-11-10': compactNight(night([['1', 'Nikola Jokić', 'DEN', 20], ['2', 'Cooper Flagg', 'DAL', 18]]), false),
  '2026-11-15': compactNight(night([['1', 'Nikola Jokić', 'DEN', 10]]), false),
  '2026-10-14': compactNight(night([['1', 'Nikola Jokić', 'DEN', 99]]), true),
} };
const w = windowsFrom(plog);
ok('asOf is the latest regular night', w.asOf === '2026-11-15', w.asOf);
ok('not preseason once the season has a night', w.pre === false);
ok('keyed by nameKey (accents gone)', !!w.windows.szn.nikolajokic, Object.keys(w.windows.szn));
ok('season: 3 games, preseason left out', w.windows.szn.nikolajokic.g === 3 && w.windows.szn.nikolajokic.s.PTS === 20);
ok('7 days: only Nov 10 and 15', w.windows.d7.nikolajokic.g === 2 && w.windows.d7.nikolajokic.s.PTS === 15);
ok('30 days drops Oct 14 and keeps Oct 21', w.windows.d30.nikolajokic.g === 3);
ok('a player only in the window', w.windows.d7.cooperflagg.g === 1 && w.windows.d15.cooperflagg.s.PTS === 18);
const pre = windowsFrom({ nights: { '2026-10-14': plog.nights['2026-10-14'] } });
ok('preseason fallback before the season', pre.pre === true && pre.windows.szn.nikolajokic.s.PTS === 99);
ok('empty plog', windowsFrom({ nights: {} }).asOf === null);
// The player card's last games count the nights his club played without him.
const N = (p) => ({ p });
const L = (t, pts) => ({ t, s: { PTS: pts } });
const nights = [
  ['2026-11-17', N({ other: L('LAL', 9) })],                 // his club played, he did not
  ['2026-11-15', N({ wk: L('LAL', 14), x: L('LAL', 3) })],
  ['2026-11-13', N({ y: L('BOS', 8) })],                     // his club did not play
  ['2026-11-11', N({ wk: L('LAL', 10) })]];
let G = lastGames(nights, ['wk']);
ok('a missed game is an empty row', G[0].day === '2026-11-17' && G[0].dnp === true && G[0].t === 'LAL', JSON.stringify(G[0]));
ok('nights his club did not play are skipped', G.length === 3 && !G.some((g) => g.day === '2026-11-13'), JSON.stringify(G));
ok('his games keep their lines', G[1].s.PTS === 14 && !G[1].dnp);
G = lastGames(nights, ['nobody'], 'LAL');
ok('out all season: his club\u2019s games, all empty', G.length === 3 && G.every((g) => g.dnp), JSON.stringify(G));
ok('no line and no club: nothing', lastGames(nights, ['nobody']).length === 0);
// Games missed, and the injury log.
const NL = (rows) => compactNight(night(rows), false);
const mp = { nights: {
  '2026-11-01': NL([['1', 'Nikola Jokić', 'DEN', 30], ['3', 'Jamal Murray', 'DEN', 20]]),
  '2026-11-03': NL([['3', 'Jamal Murray', 'DEN', 22]]),                      // Jokic out
  '2026-11-05': NL([['3', 'Jamal Murray', 'DEN', 25], ['2', 'Cooper Flagg', 'DAL', 18]]), // Jokic out
  '2026-11-06': NL([['2', 'Cooper Flagg', 'DAL', 18]]),                      // DEN idle
} };
let ilog = noteInjuries(null, { a: { n: 'Nikola Jokić', t: 'DEN', inj: { s: 'Out' } }, b: { n: 'Tyrese Haliburton', t: 'IND', inj: { s: 'Out' } } }, '2026-11-05', nameKey);
ilog = noteInjuries(ilog, { c: { n: 'Cooper Flagg', t: 'DAL', inj: { s: 'Day-To-Day' } } }, '2026-11-05', nameKey);
ok('refreshes in one night merge', !!ilog.days['2026-11-05'].nikolajokic && ilog.days['2026-11-05'].cooperflagg.s === 'Day-To-Day');
ok('the log keeps the club', ilog.days['2026-11-05'].tyresehaliburton.t === 'IND');
const old = noteInjuries({ days: { '2024-01-01': { x: { s: 'Out' } } } }, {}, '2026-11-05', nameKey);
ok('old nights are dropped', !old.days['2024-01-01']);
ok('the night rolls at 4 AM Eastern', injNight('America/New_York', new Date('2026-11-18T08:30:00Z')) === '2026-11-17'
  && injNight('America/New_York', new Date('2026-11-18T09:30:00Z')) === '2026-11-18');
const mw = windowsFrom(mp, ilog);
ok('team nights counted', mw.teams.szn.DEN === 3 && mw.teams.szn.DAL === 2, JSON.stringify(mw.teams.szn));
ok('missed games counted', mw.miss.szn.nikolajokic.m === 2, JSON.stringify(mw.miss.szn));
ok('listed on the report for one of them', mw.miss.szn.nikolajokic.o === 1);
ok('a player who never misses is not listed', !mw.miss.szn.jamalmurray);
ok('Flagg: DAL played twice, he played twice', !mw.miss.szn.cooperflagg);
ok('the 7-day window counts its own nights', mw.teams.d7.DEN === 3 && mw.miss.d7.nikolajokic.m === 2);
ok('no injury log: still counts misses', windowsFrom(mp).miss.szn.nikolajokic.m === 2 && windowsFrom(mp).miss.szn.nikolajokic.o === 0);
G = lastGames([['2026-11-05', mp.nights['2026-11-05']], ['2026-11-03', mp.nights['2026-11-03']]], ['nikolajokic'], 'DEN', 5, ilog);
ok('a missed game carries the report', G[0].dnp && G[0].why === 'Out' && G[1].dnp && !G[1].why, JSON.stringify(G));
ok('stops at five', lastGames(Array.from({ length: 9 }, (_, i) => [`2026-11-${10 + i}`, N({ wk: L('LAL', i) })]), ['wk']).length === 5);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
