/* Rolling player stats (deploy/netlify/functions/lib/pstats.mjs).
   node tests/pstats.test.js */
import { compactNight, windowsFrom, lastGames } from '../deploy/netlify/functions/lib/pstats.mjs';
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
ok('stops at five', lastGames(Array.from({ length: 9 }, (_, i) => [`2026-11-${10 + i}`, N({ wk: L('LAL', i) })]), ['wk']).length === 5);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
