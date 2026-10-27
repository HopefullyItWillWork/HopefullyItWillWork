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

  console.log('\n== a commissioner override beats the GM\u2019s own saves ==');
  {
    const e = [{ at: '2026-10-25T12:00:00.000Z', src: 'save', s: { C: 'A' } },
      { at: '2026-10-25T13:00:00.000Z', src: 'override', s: { C: 'B' } },
      { at: '2026-10-25T20:00:00.000Z', src: 'save', s: { C: 'C' } }];
    ok('the override is used, even against a later save', lineupAt(e, '2026-10-25T23:00:00.000Z').s.C === 'B');
    ok('with no override the last save before the tip is used', lineupAt(e.filter(x => x.src !== 'override'), '2026-10-25T23:00:00.000Z').s.C === 'C');
    const st = (() => { const m = new Map(); return { get: async k => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); },
      list: async ({ prefix }) => ({ blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }) }; })();
    await recordLineup(st, TZ, { club: 'X', cid: 'c1', s: { C: 'Z' }, day: '2026-10-20', src: 'override', by: 'comm' });
    const on = await lineupsOn(st, '2026-10-20');
    ok('an override is filed under the night it is for', on.X && on.X.length === 1 && on.X[0].src === 'override' && on.X[0].day === '2026-10-20');
  }

  console.log('\n== a club name with ? in it (Netlify puts the key in a URL) ==');
  {
    /* Like the real store: the key is the URL path, so it is percent-decoded on
       the way in and a "?" or "#" in it ends the path. */
    const path = (k) => decodeURIComponent(k.split(/[?#]/)[0]);
    const m = new Map();
    const st = { m, async set(k, v) { m.set(path(k), v); }, async get(k) { const p = path(k); return m.has(p) ? m.get(p) : null; },
      async list({ prefix }) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; } };
    const club = 'Boozer? I Hardly Know Her.';
    await recordLineup(st, TZ, { club, cid: 'c_b', s: { C: 'Sengun' }, day: '2026-10-21' });
    ok('the key holds nothing a URL would cut', [...m.keys()].every(k => !/[?#%]/.test(k)), [...m.keys()].join());
    let on = await lineupsOn(st, '2026-10-21');
    ok('and it reads back', on[club] && on[club][0].s.C === 'Sengun', JSON.stringify(Object.keys(on)));
    /* A blob written the old way: encodeURIComponent, decoded by the server. */
    m.set(path('luh/2026-10-21/' + encodeURIComponent(club) + '/2026-10-21T20:00:00.000Z-abc'),
      JSON.stringify({ at: '2026-10-21T20:00:00.000Z', day: '2026-10-21', club, cid: 'c_b', src: 'save', s: cleanSlots({ C: 'Jokic' }) }));
    on = await lineupsOn(st, '2026-10-21');
    ok('an entry saved before the fix is read too', on[club] && on[club].length === 2 && on[club].some(e => e.s.C === 'Jokic'), JSON.stringify(on[club]));
  }

  console.log(`\n${ran - fails}/${ran} passed`);
  process.exit(fails ? 1 : 0);
})();
