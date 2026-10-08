/* Scoring. lib/score.mjs is pure, so every rule is checked with inline nights
   and lineups. The cases are the league's own: a starter counts, a bench player
   does not, a change after tip-off does not reach that game, and past the game
   cap games count top-down in slot order — at 919 with ten starters, only the
   centre. */
import { scoreNight, seasonStandings, keysFor, currentName } from '../deploy/netlify/functions/lib/score.mjs';

let fails = 0, ran = 0;
const ok = (name, cond, extra='') => { ran++; if(cond) console.log('  PASS  '+name);
  else { fails++; console.log('  FAIL  '+name+(extra?'  -> '+extra:'')); } };

const line = (pts, o = {}) => ({ MP: 30, FG: 5, FGA: 10, FT: 2, FTA: 2, P3: 1, TRB: 5, AST: 3, STL: 1, BLK: 1, TOV: 2, PTS: pts, ...o });
// Two games: DEN v LAL at 7pm Eastern (23:00Z), GS v POR at 10pm (02:00Z next day).
const night = {
  games: { g1: { home: 'DEN', away: 'LAL', tip: '2026-10-21T23:00Z', final: true },
           g2: { home: 'POR', away: 'GS',  tip: '2026-10-22T02:00Z', final: true } },
  players: {
    '1': { n: 'Nikola Jokic', t: 'DEN', s: line(30) },
    '2': { n: 'Luka Doncic', t: 'LAL', s: line(28) },
    '3': { n: 'Stephen Curry', t: 'GS', s: line(25) },
    '4': { n: 'Jakob Poeltl', t: 'POR', s: line(10) },     // roster spells him "Jakob Poetl"
    '5': { n: 'Deni Avdija', t: 'POR', s: line(20) },      // on nobody's lineup
  },
};
const entry = (at, s) => ({ at, s });

console.log('\n== a starter counts, a bench player does not ==');
let r = scoreNight({ night, gpBefore: {}, lineups: {
  'A. Daman': [entry('2026-10-21T13:15:00.000Z', { C: 'Nikola Jokic', G1: 'Luka Doncic' })],
  'Osborn':   [entry('2026-10-21T13:15:00.000Z', { C: 'Jakob Poetl', U1: 'Stephen Curry' })],
} });
ok('both of A. Daman\'s starters counted', r.clubs['A. Daman'].counted.length === 2 && r.clubs['A. Daman'].totals.PTS === 58);
ok('roster spelling "Poetl" finds box-score "Poeltl"', r.clubs['Osborn'].counted.some(x => x.n === 'Jakob Poeltl'));
ok('Osborn totals', r.clubs['Osborn'].totals.PTS === 35 && r.clubs['Osborn'].totals.GP === 2);
ok('rebounds and turnovers renamed for the chart', r.clubs['Osborn'].totals.REB === 10 && r.clubs['Osborn'].totals.TO === 4);
ok('nobody started Avdija', r.unmatched.includes('Deni Avdija'));

console.log('\n== the lineup at HIS tip-off ==');
r = scoreNight({ night, gpBefore: {}, lineups: { 'A. Daman': [
  entry('2026-10-21T13:15:00.000Z', { C: 'Nikola Jokic', U1: 'Luka Doncic' }),
  entry('2026-10-21T23:30:00.000Z', { C: 'Nikola Jokic', U1: 'Stephen Curry' }),   // after the 7pm tip
] } });
const names = r.clubs['A. Daman'].counted.map(x => x.n).sort().join();
ok('Doncic (7pm) counts from the lineup he tipped in', names.includes('Luka Doncic'));
ok('Curry, swapped into the same slot after Doncic tipped, does not', !names.includes('Stephen Curry'));
ok('and is recorded as a reused slot', r.clubs['A. Daman'].reused.some(x => x.n === 'Stephen Curry'));
ok('Jokic counts once', r.clubs['A. Daman'].counted.filter(x => x.n === 'Nikola Jokic').length === 1);
r = scoreNight({ night, gpBefore: {}, lineups: { 'A. Daman': [
  entry('2026-10-21T13:15:00.000Z', { C: 'Nikola Jokic', U1: 'Stephen Curry' }),
  entry('2026-10-21T23:30:00.000Z', { C: 'Nikola Jokic', U1: 'Stephen Curry', U2: 'Jakob Poetl' }),
] } });
ok('an empty slot filled after an early tip, for a later game, counts',
   r.clubs['A. Daman'].counted.some(x => x.n === 'Jakob Poeltl' && x.slot === 'U2'));
r = scoreNight({ night, gpBefore: {}, lineups: { 'A. Daman': [
  entry('2026-10-21T13:15:00.000Z', { C: 'Nikola Jokic' }),
  entry('2026-10-21T23:30:00.000Z', { C: 'Nikola Jokic', G1: 'Luka Doncic' }),     // added after his game started
] } });
ok('a starter added after tip-off does not count', !r.clubs['A. Daman'].counted.some(x => x.n === 'Luka Doncic'));
r = scoreNight({ night, gpBefore: {}, lineups: { 'A. Daman': [entry('2026-10-22T03:00:00.000Z', { C: 'Nikola Jokic' })] } });
ok('no lineup before tip-off: nothing counts', r.clubs['A. Daman'].counted.length === 0);

console.log('\n== the game cap: top-down in slot order ==');
const ten = {}, many = { games: { g: { home: 'AAA', away: 'BBB', tip: '2026-10-21T23:00Z' } }, players: {} };
// Real names have no digits and nameKey() drops them, so each test player gets a word.
const WORD = { C:'Cee', G1:'Gee', F3:'Effthree', F4:'Efffour', U1:'Uone', U2:'Utwo', U3:'Uthree', U4:'Ufour', U5:'Ufive', U6:'Usix' };
['U6','U5','U4','U3','U2','U1','F4','F3','G1','C'].forEach((slot, i) => {
  ten[slot] = 'Player ' + WORD[slot]; many.players[i] = { n: 'Player ' + WORD[slot], t: 'AAA', s: line(10) };
});
r = scoreNight({ night: many, gpBefore: { X: 919 }, cap: 920, lineups: { X: [entry('2026-10-21T12:00:00.000Z', ten)] } });
ok('at 919 with ten starters, only the centre counts',
   r.clubs.X.counted.length === 1 && r.clubs.X.counted[0].slot === 'C', r.clubs.X.counted.map(x => x.slot).join());
ok('the other nine are recorded as over', r.clubs.X.over.length === 9);
ok('and order is C, G, F, UTIL', r.clubs.X.over.map(x => x.slot).join() === 'G1,F3,F4,U1,U2,U3,U4,U5,U6');
r = scoreNight({ night: many, gpBefore: { X: 916 }, cap: 920, lineups: { X: [entry('2026-10-21T12:00:00.000Z', ten)] } });
ok('at 916: C, G1, F3, F4', r.clubs.X.counted.map(x => x.slot).join() === 'C,G1,F3,F4');
r = scoreNight({ night: many, gpBefore: { X: 920 }, cap: 920, lineups: { X: [entry('2026-10-21T12:00:00.000Z', ten)] } });
ok('at the cap nothing counts', r.clubs.X.counted.length === 0 && r.clubs.X.totals.GP === 0);

console.log('\n== names and renames ==');
ok('alias map is honoured', keysFor('Kevin Porter Jr.', { 'Kevin Porter Jr.': 'Kevin Porter Jr' }).has('kevinporter'));
ok('ESPN nickname table is honoured', keysFor('Ron Holland').has('ronaldholland'));
ok('the commissioner\'s ESPN map is honoured', keysFor('Bub Carrington', {}, { 'Bub Carrington': 'Carlton Carrington' }).has('carltoncarrington'));
const ren = [{ from: 'N. Daman', to: 'Hello' }, { from: 'Hello', to: 'N. Daman test' }];
ok('a chain of renames resolves', currentName('N. Daman', ren) === 'N. Daman test');
ok('a removed club maps to null', currentName('Gone', [{ from: 'Gone', to: null }]) === null);
r = scoreNight({ night, gpBefore: {}, renames: [{ from: 'Old', to: 'New' }],
  lineups: { Old: [entry('2026-10-21T13:15:00.000Z', { C: 'Nikola Jokic' })] } });
ok('a lineup saved under the old name scores for the new one', r.clubs.New && r.clubs.New.counted.length === 1 && !r.clubs.Old);

console.log('\n== standings ==');
const T = (o) => ({ FG: 0, FGA: 0, FT: 0, FTA: 0, P3: 0, REB: 0, AST: 0, STL: 0, BLK: 0, TO: 0, PTS: 0, GP: 0, ...o });
const st = seasonStandings({
  '2026-10-21': { A: T({ FG: 50, FGA: 100, FT: 8, FTA: 10, PTS: 100, TO: 5, GP: 5 }), B: T({ FG: 40, FGA: 100, FT: 9, FTA: 10, PTS: 120, TO: 9, GP: 5 }) },
  '2026-10-22': { A: T({ PTS: 10, GP: 1 }), Old: T({ PTS: 1, GP: 1 }) },
}, [{ from: 'Old', to: 'C' }], ['A', 'B', 'C']);
const A = st.find(x => x.club === 'A'), B = st.find(x => x.club === 'B'), C = st.find(x => x.club === 'C');
ok('season sums across nights', A.tot.PTS === 110 && A.tot.GP === 6);
ok('a renamed club\'s nights sum under its new name', C.tot.PTS === 1);
ok('FG% from totals', Math.abs(A.pct.FG - 0.5) < 1e-9 && A.cat['FG%'] === 3);
ok('fewest turnovers is best', C.cat.TO === 3 && A.cat.TO === 2 && B.cat.TO === 1);
ok('ties split', A.cat.BLK === 2 && B.cat.BLK === 2 && C.cat.BLK === 2);
ok('ranked by roto points', st[0].rank === 1 && st[0].pts >= st[1].pts && st[1].pts >= st[2].pts);

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
