/* Lineup history. lib/lineups.mjs imports nothing; the blob store is an
   in-memory stand-in with the three calls it uses (get, set, list by prefix).
   What matters: entries are never overwritten, the server's time is the one
   recorded, the morning carry happens once, and "the lineup at tip-off" is the
   last entry at or before it. */
import { SLOTS, cleanSlots, recordLineup, lineupsOn, lineupAt, carryLineups, dayIn }
  from '../deploy/netlify/functions/lib/lineups.mjs';

let fails = 0, ran = 0;
const ok = (name, cond, extra='') => { ran++; if(cond) console.log('  PASS  '+name);
  else { fails++; console.log('  FAIL  '+name+(extra?'  -> '+extra:'')); } };
const TZ = 'America/New_York';
const memStore = () => { const m = new Map(); return { m,
  async set(k, v) { m.set(k, v); }, async get(k) { return m.has(k) ? m.get(k) : null; },
  async list({ prefix }) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; } }; };
const tick = () => new Promise(r => setTimeout(r, 3));

(async () => {
  console.log('\n== slots are cleaned ==');
  const c = cleanSlots({ C: 'Jokic', G1: 5, ZZ: 'x' });
  ok('fifteen known slots', Object.keys(c).length === 15 && SLOTS.every(k => k in c));
  ok('junk dropped', c.G1 === '' && !('ZZ' in c) && c.C === 'Jokic');

  console.log('\n== saves append, never overwrite ==');
  const s = memStore();
  await recordLineup(s, TZ, { club: 'A. Daman', s: { C: 'Allen' } }); await tick();
  await recordLineup(s, TZ, { club: 'A. Daman', s: { C: 'Mobley' } });
  ok('two saves, two blobs', s.m.size === 2);
  const day = dayIn(TZ);
  const on = await lineupsOn(s, day);
  ok('grouped by club, oldest first', on['A. Daman'].map(e => e.s.C).join() === 'Allen,Mobley');
  ok('stamped with a real time', !isNaN(Date.parse(on['A. Daman'][0].at)));

  console.log('\n== the lineup at tip-off ==');
  const L = [{ at: '2026-10-22T09:15:00.000Z', s: { C: 'A' } }, { at: '2026-10-22T23:10:00.000Z', s: { C: 'B' } }];
  ok('before any entry: none', lineupAt(L, '2026-10-22T08:00:00Z') === null);
  ok('a 7pm game uses the morning lineup', lineupAt(L, '2026-10-22T23:00:00.000Z').s.C === 'A');
  ok('a change after tip-off does not reach that game', lineupAt(L, '2026-10-22T23:00:00.000Z').s.C !== 'B');
  ok('a later game sees the change', lineupAt(L, '2026-10-23T02:00:00.000Z').s.C === 'B');

  console.log('\n== the morning carry ==');
  const t = memStore();
  const teams = { 'A. Daman': { lu: { s: { C: 'Allen' } } }, Osborn: {}, 'N. Fink': { lu: { s: { C: 'Holmgren' } } } };
  const first = await carryLineups(t, TZ, teams);
  ok('carries every club with a lineup', first.join() === 'A. Daman,N. Fink', first.join());
  ok('a club with no lineup is skipped', !first.includes('Osborn'));
  const again = await carryLineups(t, TZ, teams);
  ok('a second run the same day does nothing', again.length === 0 && t.m.size === 2);
  const e = (await lineupsOn(t, dayIn(TZ)))['N. Fink'][0];
  ok('marked as a carry', e.src === 'carry' && e.by === 'nightly');

  console.log(`\n${ran - fails}/${ran} passed`);
  process.exit(fails ? 1 : 0);
})();
