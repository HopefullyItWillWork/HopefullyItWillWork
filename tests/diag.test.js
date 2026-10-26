'use strict';
const assert = require('assert');
(async () => {
  const { diagnose } = await import('../deploy/netlify/functions/lib/scorediag.mjs');
  const m = new Map();
  const st = { get: async k => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); },
    list: async ({ prefix }) => ({ blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }) };
  const put = (k, data) => m.set(k, JSON.stringify({ rev: 1, data }));
  put('rosters', { 'Boozer I hardly know her': { id: 'c_new', r: [] }, Osborn: { id: 'c_o', r: [] } });
  put('settings', { renames: [{ from: 'Christman', to: 'Boozer I hardly know her', at: '2026-10-20T00:00:00.000Z' }] });
  put('daily-2026-10-25', { games: { g: { tip: '2026-10-25T23:00:00.000Z', home: 'DEN', away: 'LAL' } },
    players: { 1: { n: 'Nikola Jokić', t: 'DEN', s: { PTS: 30 } } } });
  // lineup saved after the rename under the OLD name with a stale id — the case that lost a club's whole night
  m.set('luh/2026-10-25/Christman/2026-10-25T12:00:00.000Z-aaaa', JSON.stringify({ at: '2026-10-25T12:00:00.000Z',
    day: '2026-10-25', club: 'Christman', cid: 'c_gone', src: 'save', s: { C: 'Nikola Jokic' } }));
  const d = await diagnose(st, { club: 'Boozer I hardly know her', day: '2026-10-25' });
  assert.strictEqual(d.clubId, 'c_new');
  assert.strictEqual(d.lineupEntries.length, 1, 'the entry resolves to the club');
  assert.strictEqual(d.scored.counted.length, 1);
  assert.ok(!d.problem, d.problem);
  const none = await diagnose(st, { club: 'Nobody', day: '2026-10-25' });
  assert.ok(/no club/i.test(none.problem));
  const noLu = await diagnose(st, { club: 'Osborn', day: '2026-10-25' });
  assert.ok(/No lineup entry/.test(noLu.problem));
  console.log('diag: ok');
})().catch(e => { console.error(e); process.exit(1); });
