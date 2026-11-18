/* Live stats (lib/live.mjs): the pure half. The night rolls at 4 AM league time,
   the gate keeps ESPN out of it before the first tip, on a night with no games
   and once every game is final, and the scoreboard is read into game states. */
import { nightAt, gate, liveGames, driftOf } from '../deploy/netlify/functions/lib/live.mjs';

let fails = 0, ran = 0;
const ok = (name, cond, extra = '') => { ran++; if (cond) console.log('  PASS  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); } };
const TZ = 'America/New_York';

console.log('\n== the night ==');
let n = nightAt(TZ, new Date('2026-11-17T05:40:00Z'));     // 00:40 Eastern
ok('past midnight is still last night', n.day === '2026-11-16' && n.min === 1480, JSON.stringify(n));
n = nightAt(TZ, new Date('2026-11-17T10:00:00Z'));         // 05:00 Eastern
ok('after 4 AM it is the new night', n.day === '2026-11-17' && n.min === 300, JSON.stringify(n));

console.log('\n== the gate ==');
const sched = { tips: { BOS: '19:00', LAL: '22:30' } };
ok('before the first tip: skip', gate({ prev: null, sched, night: 'd', min: 600 }) === 'before the first tip');
ok('during games: run', gate({ prev: null, sched, night: 'd', min: 1200 }) === '');
ok('past midnight, games still on: run', gate({ prev: null, sched, night: 'd', min: 1470 }) === '');
ok('every game final: skip', gate({ prev: { day: 'd', allFinal: true }, sched, night: 'd', min: 1470 }) === 'every game is final');
ok('final yesterday is not final tonight', gate({ prev: { day: 'y', allFinal: true }, sched, night: 'd', min: 1200 }) === '');
ok('no games: skip', gate({ prev: null, sched: { tips: {} }, night: 'd', min: 1200 }) === 'no games tonight');
ok('no schedule cached: ask', gate({ prev: null, sched: null, night: 'd', min: 600 }) === '');

console.log('\n== the scoreboard ==');
const ev = (id, state, done, name = 'STATUS_IN_PROGRESS', ty = 2) => ({ id, date: '2026-11-17T00:00Z', season: { type: ty },
  status: { type: { state, completed: done, shortDetail: done ? 'Final' : 'Q3 4:12', name } },
  competitions: [{ competitors: [{ homeAway: 'home', score: '78', team: { abbreviation: 'BOS' } }, { homeAway: 'away', score: '74', team: { abbreviation: 'ORL' } }] }] });
const g = liveGames({ events: [ev('1', 'in', false), ev('2', 'post', true), ev('3', 'pre', false, 'STATUS_POSTPONED'), ev('4', 'in', false, 'X', 1)] }, new Set([2]));
ok('in progress kept with its clock', g['1'] && g['1'].state === 'in' && g['1'].detail === 'Q3 4:12' && g['1'].home === 'BOS');
ok('final kept', g['2'] && g['2'].final);
ok('the score rides along, home and away', g['1'].hs === 78 && g['1'].as === 74);
ok('postponed dropped', !g['3']);
ok('other season types dropped', !g['4']);

console.log('\n== live against the morning ==');
const d = driftOf({ a: { totals: { PTS: 10, GP: 2 } }, c: { totals: { PTS: 5 } } }, { a: { PTS: 14, GP: 2 }, b: { PTS: 3 }, c: { PTS: 5 } });
ok('only what differs is kept', JSON.stringify(d) === JSON.stringify({ a: { PTS: 4 }, b: { PTS: 3 } }), JSON.stringify(d));
ok('nothing differs, nothing listed', Object.keys(driftOf({ a: { totals: { PTS: 1 } } }, { a: { PTS: 1 } })).length === 0);

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
