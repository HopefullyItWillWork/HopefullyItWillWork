/* Club ids: a rename must never split a club's stats. Pure rules plus the
   migration against an in-memory store. */
import { stampIds, clubCtx, keyOf, daysByName, byClubName } from '../deploy/netlify/functions/lib/clubs.mjs';
import { scoreNight } from '../deploy/netlify/functions/lib/score.mjs';
import { migrateIds, ensureIds } from '../deploy/netlify/functions/lib/clubids.mjs';
import { recordLineup, carryLineups } from '../deploy/netlify/functions/lib/lineups.mjs';

let fails = 0, ran = 0;
const ok = (name, cond, extra='') => { ran++; if(cond) console.log('  PASS  '+name);
  else { fails++; console.log('  FAIL  '+name+(extra?'  -> '+extra:'')); } };

const mem = () => { const m = new Map(); return { m,
  get: async (k) => m.has(k) ? m.get(k) : null, set: async (k, v) => { m.set(k, v); },
  list: async ({ prefix }) => ({ blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }) }; };
const put = (s, k, data) => s.set(k, JSON.stringify({ rev: 1, data }));

console.log('\n== stampIds ==');
const prev = { A: { id: 'c_a' }, B: { id: 'c_b' } };
const next = stampIds(prev, { A: {}, B: { id: 'c_b' }, C: {} });
ok('a club keeps the id the server had', next.A.id === 'c_a');
ok('a club that already has one keeps it', next.B.id === 'c_b');
ok('a new club gets a fresh unique id', next.C.id && next.C.id !== 'c_a' && next.C.id !== 'c_b');
ok('stamping twice changes nothing', JSON.stringify(stampIds(next, JSON.parse(JSON.stringify(next)))) === JSON.stringify(next));

console.log('\n== a rename does not split a club ==');
const teams = { 'The Kon-dors': { id: 'c_n' }, Osborn: { id: 'c_o' } };
const renames = [{ from: 'N. Daman', to: 'The Kon-dors', at: '2026-10-14T12:00:00Z' }];
const ctx = clubCtx(teams, renames);
ok('an id resolves to itself', keyOf('c_n', ctx) === 'c_n');
ok('an old name resolves to the id', keyOf('N. Daman', ctx, '2026-10-13T12:00:00Z') === 'c_n');
ok('the current name resolves to the id', keyOf('The Kon-dors', ctx) === 'c_n');
ok('the id shows the NEW name', daysByName({ '2026-10-13': { c_n: { PTS: 1 } } }, ctx)['2026-10-13']['The Kon-dors'].PTS === 1);
const merged = daysByName({ '2026-10-13': { 'N. Daman': { PTS: 2, GP: 1 }, c_n: { PTS: 3, GP: 1 } } }, ctx)['2026-10-13'];
ok('old-name and id rows for one club are summed', Object.keys(merged).length === 1 && merged['The Kon-dors'].PTS === 5);
ok('a night\'s clubs are renamed for display', Object.keys(byClubName({ c_o: { x: 1 } }, ctx))[0] === 'Osborn');

console.log('\n== scoring follows the id, not the name ==');
const line = (pts) => ({ MP: 30, FG: 5, FGA: 10, FT: 2, FTA: 2, P3: 1, TRB: 5, AST: 3, STL: 1, BLK: 1, TOV: 2, PTS: pts });
const night = { games: { g: { home: 'DEN', away: 'LAL', tip: '2026-10-15T23:00:00.000Z' } },
  players: { 1: { n: 'Nikola Jokic', t: 'DEN', s: line(30) } } };
const resolve = (r, at) => keyOf(r, ctx, at);
// Saved under the old name (no cid) at 10:00, renamed at 12:00, lineup resaved under the new name with the id at 15:00.
const lineups = { 'N. Daman': [{ at: '2026-10-13T10:00:00.000Z', club: 'N. Daman', s: { C: 'Nikola Jokic' } }],
  'The Kon-dors': [{ at: '2026-10-14T15:00:00.000Z', club: 'The Kon-dors', cid: 'c_n', s: { C: '' } }] };
let r = scoreNight({ night, gpBefore: {}, lineups, renames, resolve });
ok('both names\' history is one club (filed under the id)', Object.keys(r.clubs).join() === 'c_n');
ok('the later empty lineup wins, so nobody counted', r.clubs.c_n.totals.GP === 0);
lineups['The Kon-dors'][0].s = { C: 'Nikola Jokic' };
r = scoreNight({ night, gpBefore: { c_n: 3 }, lineups, renames, resolve });
ok('the man counts for the club under its id', r.clubs.c_n.totals.GP === 1 && r.clubs.c_n.gpBefore === 3);
const renamedAgain = clubCtx({ 'Third Name': { id: 'c_n' }, Osborn: { id: 'c_o' } }, renames);
r = scoreNight({ night, gpBefore: {}, lineups, renames, resolve: (x, at) => keyOf(x, renamedAgain, at) });
ok('renaming the club again changes nothing in the scoring', r.clubs.c_n.totals.GP === 1);

console.log('\n== migration ==');
const s = mem();
await put(s, 'rosters', { 'The Kon-dors': { lu: { s: { C: 'X' } } }, Osborn: { lu: { s: { C: 'Y' } } } });
await put(s, 'settings', { renames });
const ros = await ensureIds(s);
ok('ensureIds stamps every club', ros['The Kon-dors'].id && ros.Osborn.id && ros.Osborn.id !== ros['The Kon-dors'].id);
const again = await ensureIds(s);
ok('...and keeps them next time', again.Osborn.id === ros.Osborn.id);
const id = ros['The Kon-dors'].id;
await s.set('luh/2026-10-13/N.%20Daman/a', JSON.stringify({ at: '2026-10-13T10:00:00.000Z', club: 'N. Daman', s: {} }));
await put(s, 'score-pre', { days: { '2026-10-13': { 'N. Daman': { PTS: 9 } }, '2026-10-14': { [id]: { PTS: 4 } } } });
let rep = await migrateIds(s, { dry: true });
ok('a dry run reports and writes nothing', rep.lineups.changed === 1 && JSON.parse(await s.get('luh/2026-10-13/N.%20Daman/a')).cid === undefined);
rep = await migrateIds(s);
ok('lineup history is stamped with the id', JSON.parse(await s.get('luh/2026-10-13/N.%20Daman/a')).cid === id);
const sc = JSON.parse(await s.get('score-pre')).data.days;
ok('score rows are re-keyed to the id', sc['2026-10-13'][id].PTS === 9 && !sc['2026-10-13']['N. Daman']);
ok('nothing was left unresolved', rep.unresolved.length === 0);
rep = await migrateIds(s);
ok('running it again changes nothing', rep.lineups.changed === 0);

console.log('\n== the morning carry ==');
const s2 = mem();
const t2 = { 'New Name': { id: 'c_1', lu: { s: { C: 'X' } } } };
await recordLineup(s2, 'America/New_York', { club: 'Old Name', cid: 'c_1', s: { C: 'X' } });
ok('a club renamed today already has an entry, so no second carry', (await carryLineups(s2, 'America/New_York', t2)).length === 0);

console.log('\n== a renamed club keeps its lineups (Christman -> Boozer) ==');
{
  const { resolveEntry, clubCtx } = await import('../deploy/netlify/functions/lib/clubs.mjs');
  const teams = { 'Boozer I hardly know her': { id: 'c_new' }, Osborn: { id: 'c_o' } };
  const ctx = clubCtx(teams, [{ from: 'Christman', to: 'Boozer I hardly know her', at: '2026-10-20T12:00:00.000Z' }]);
  const R = (cid, club, at) => resolveEntry(ctx, cid, club, at);
  ok('saved before the rename, by id', R('c_new', 'Christman', '2026-10-19T12:00:00.000Z') === 'c_new');
  ok('saved before the rename, no id, old name', R('', 'Christman', '2026-10-19T12:00:00.000Z') === 'c_new');
  ok('stale id, old name, before the rename', R('c_gone', 'Christman', '2026-10-19T12:00:00.000Z') === 'c_new');
  ok('stale id, old name, AFTER the rename (stale browser)', R('c_gone', 'Christman', '2026-10-21T12:00:00.000Z') === 'c_new');
  ok('no id, old name, after the rename', R('', 'Christman', '2026-10-21T12:00:00.000Z') === 'c_new');
  ok('saved under the new name', R('', 'Boozer I hardly know her', '2026-10-21T12:00:00.000Z') === 'c_new');
  ok('another club is not captured', R('c_o', 'Osborn', '2026-10-21T12:00:00.000Z') === 'c_o');
}

console.log('\n== a ghost of a renamed club does not steal its id ==');
{
  const g = clubCtx({ Christman: { id: 'c_1' }, 'Boozer I hardly know her': { id: 'c_1' }, Osborn: { id: 'c_o' } },
    [{ from: 'Christman', to: 'Boozer I hardly know her', at: '2026-10-20T00:00:00.000Z' }]);
  ok('the id belongs to the real club', g.nameOf.c_1 === 'Boozer I hardly know her');
  ok('the ghost is not a live club', !g.live.includes('Christman') && g.live.includes('Boozer I hardly know her'));
  ok('the ghost name still resolves to the real club', keyOf('Christman', g, '2026-10-21T00:00:00.000Z') === 'c_1');
  const back = clubCtx({ Christman: { id: 'c_1' } }, [{ from: 'Christman', to: 'X', at: 'a' }, { from: 'X', to: 'Christman', at: 'b' }]);
  ok('a club renamed away and back is itself', back.nameOf.c_1 === 'Christman');
}

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
