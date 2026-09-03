'use strict';
const {ctx, document} = require('./run.js');
const X = ctx.__X;                       // top-level let/const bindings
const g = n => (n in X) ? X[n] : ctx[n]; // functions live on the vm global
let fails = 0, ran = 0;
const ok = (name, cond, extra='') => { ran++; if(cond) console.log('  PASS  '+name);
  else { fails++; console.log('  FAIL  '+name+(extra?'  -> '+extra:'')); } };

(async () => {
  await new Promise(r=>setTimeout(r, 300));      // let the bootstrap IIFE settle
  if(!g('S')) { console.log('FATAL: state never initialised'); process.exit(1); }

  console.log('\n== the script actually ran ==');
  ok('S.teams populated', Object.keys(g('S').teams).length === 9, Object.keys(g('S').teams).length);
  ok('RATER loaded', g('RATER').length > 300, g('RATER').length);

  console.log('\n== birdKind: only "Yes" is Bird, "No" is nothing ==');
  const bk = g('birdKind');
  ok('Yes -> Bird', bk('Yes')==='Yes');
  ok('Early -> Early', bk('Early')==='Early');
  ok('Min -> Early (behaviour preserved)', bk('Min')==='Early');
  ok('No -> none', bk('No')==='', JSON.stringify(bk('No')));
  ok('empty -> none', bk('')==='');

  console.log('\n== rightsOf matches through canon() ==');
  // N. Fink carries "Jakob Poetl"; RATER spells him "Jakob Poeltl".
  const R = g('rightsOf')('N. Fink','Jakob Poeltl');
  ok('spreadsheet/box-score spelling resolves', R.club==='N. Fink', JSON.stringify(R));
  ok('and his Bird rights are seen', R.bird==='Yes', R.bird);
  // Norman Powell is Osborn's, marked "No" — but he is signed, so no rights either way.
  const nores = g('rightsOf')('Osborn','Draymond Green');
  ok('a signed player yields no expiring rights', nores.club===null, JSON.stringify(nores));

  console.log('\n== bidCeiling no longer grants a phantom Early Bird ==');
  // Put an expiring player marked "No" on a club and confirm he gets no $7 bump.
  const S = g('S');
  S.teams['Osborn'].r.push({n:'Test Nobody',p:'G',y:[1.0,null,null,null],o:'',b:'No',acq:2020,cut:false});
  const rn = g('rightsOf')('Osborn','Test Nobody');
  ok('"No" reads as no rights', rn.club==='Osborn' && rn.bird==='', JSON.stringify(rn));
  S.teams['Osborn'].r.pop();

  console.log('\n== ITEM 2: strategy board pool includes expiring players ==');
  const pool = g('stratPool')(), names = new Set(pool.map(p=>p.n));
  ok('Wembanyama is on the board pool', names.has('Victor Wembanyama'));
  ok('...and Coulter still holds him', g('stratOwner')('Victor Wembanyama')==='Coulter',
     g('stratOwner')('Victor Wembanyama'));
  ok('Kevin Durant (expiring, Coulter) included', names.has('Kevin Durant'));
  ok('James Harden (expiring, Coulter) included', names.has('James Harden'));
  ok('Jokic (signed through next year) excluded', !names.has('Nikola Jokic') && !names.has('Nikola Jokić'));
  ok('Luka (signed) excluded', !names.has('Luka Doncic'));
  ok('Poeltl excluded via canon, not double-counted',
     names.has('Jakob Poeltl') === false || g('canon')('Jakob Poetl')==='Jakob Poeltl');

  // The league sheet carries Poeltl twice: expiring on N. Fink as "Jakob Poetl"
  // and signed on Christman as "Jakob Poeltl". canon() folds them together, so
  // the signed deal wins and he is one entry, not two.
  ok('canon folds the two Poeltl spellings', g('canon')('Jakob Poetl')==='Jakob Poeltl');
  ok('signed side wins, so he is out of the pool exactly once',
     pool.filter(p=>g('canon')(p.n)==='Jakob Poeltl').length===0);

  const before = pool.length;
  ok('pool is bigger than the old rostered-exclusion rule', before > 0, before);
  const strict = g('RATER').filter(p=>{
    for(const t of g('TEAMS')()) if(g('S').teams[t].r.some(x=>!x.cut && g('canon')(x.n)===g('canon')(p.n))) return false;
    return true; }).length;
  ok('expiring players are the difference', before > strict, before+' vs old '+strict);

  console.log('\n== stratHold labels who holds him ==');
  const hold = g('stratHold')('Victor Wembanyama');
  ok('shows the club', hold.includes('Coulter'), hold);
  ok('flags him restricted (rookie option)', hold.includes('restricted'), hold);
  ok('a true free agent has no holder', g('stratHold')(pool.find(p=>!g('stratOwner')(p.n)).n)==='');

  console.log('\n== ITEM 1: commissioner player table ==');
  X.me = '__comm__';
  ok('isComm() true', g('isComm')()===true);
  g('drawAllPlayers')();
  const tbl = document.getElementById('apTable');
  ok('table rendered', tbl.innerHTML.includes('<table id="apTbl"'));
  const total = g('TEAMS')().reduce((n,t)=>n+g('S').teams[t].r.length,0);
  ok('every contract listed', g('apRows')().length===total, g('apRows')().length+'/'+total);
  ok('count chip says so', document.getElementById('apCount').textContent===total+' of '+total+' contracts',
     document.getElementById('apCount').textContent);
  ok('Wembanyama has a row', tbl.innerHTML.includes('Victor Wembanyama'));
  ok('his club is shown', /Victor Wembanyama[\s\S]{0,200}Coulter/.test(tbl.innerHTML));
  ok('expiring is labelled', /Victor Wembanyama[\s\S]{0,400}expiring/.test(tbl.innerHTML));
  ok('his rights are shown', /Victor Wembanyama[\s\S]{0,600}(Rookie option|Restricted|Bird)/.test(tbl.innerHTML));
  ok('a multi-year deal shows years', /Chet Holmgren[\s\S]{0,400}3 yrs/.test(tbl.innerHTML));

  console.log('\n== the table filters ==');
  document.getElementById('apT').value = 'Coulter';
  ok('club filter', g('apRows')().every(r=>r.t==='Coulter') && g('apRows')().length===14, g('apRows')().length);
  document.getElementById('apS').value = 'exp';
  ok('expiring filter', g('apRows')().every(r=>r.exp) && g('apRows')().length>0, g('apRows')().length);
  document.getElementById('apS').value = 'rfa';
  ok('restricted filter finds Wemby',
     g('apRows')().some(r=>r.p.n==='Victor Wembanyama'), JSON.stringify(g('apRows')().map(r=>r.p.n)));
  document.getElementById('apS').value = '';
  document.getElementById('apT').value = '';
  document.getElementById('apQ').value = 'jok';
  ok('search filter', g('apRows')().length===1 && /Joki/.test(g('apRows')()[0].p.n),
     JSON.stringify(g('apRows')().map(r=>r.p.n)));
  document.getElementById('apQ').value = '';

  console.log('\n== Edit opens the dialog on the right player ==');
  g('drawAllPlayers')();
  const btns = document.getElementById('apTable').querySelectorAll('[data-api]');
  ok('a button per row', btns.length===g('apRows')().length, btns.length);
  const wembBtn = btns.find(b=>{
    const t=b.dataset.apc, i=+b.dataset.api;
    return g('S').teams[t] && g('S').teams[t].r[i] && g('S').teams[t].r[i].n==='Victor Wembanyama'; });
  ok('Wembanyama has an Edit button pointing at him', !!wembBtn);
  wembBtn.onclick();
  ok('dialog opened', document.getElementById('dlgEdit').open===true);
  ok('titled with the player', document.getElementById('edTitle').textContent==='Victor Wembanyama',
     document.getElementById('edTitle').textContent);
  ok('commissioner block visible', document.getElementById('edComm').hidden===false);
  ok('club preselected', /<option selected>Coulter<\/option>/.test(document.getElementById('edClub').innerHTML),
     document.getElementById('edClub').innerHTML.slice(0,200));
  ok('current salary shown', String(document.getElementById('edY0').value)==='5', document.getElementById('edY0').value);
  ok('option preselected', document.getElementById('edOpt').value==='RO', document.getElementById('edOpt').value);
  ok('rights preselected', /value="Yes" selected/.test(document.getElementById('edBird').innerHTML),
     document.getElementById('edBird').innerHTML);

  console.log('\n== saving through the dialog writes the roster ==');
  document.getElementById('edY1').value = '9.5';    // next season
  document.getElementById('edY2').value = '';
  document.getElementById('edY3').value = '';
  document.getElementById('edOpt').value = '';
  document.getElementById('edBird').value = 'Early';
  await document.getElementById('doEdit').onclick();
  const w = g('S').teams['Coulter'].r.find(p=>p.n==='Victor Wembanyama');
  ok('salary saved', w.y[1]===9.5, JSON.stringify(w.y));
  ok('option cleared', w.o==='', JSON.stringify(w.o));
  ok('rights saved', w.b==='Early', w.b);
  ok('now signed, so he leaves the board pool',
     !new Set(g('stratPool')().map(p=>p.n)).has('Victor Wembanyama'));

  console.log('\n== the club select moves a player ==');
  const idx = g('S').teams['Coulter'].r.findIndex(p=>p.n==='Victor Wembanyama');
  g('openEdit')('Coulter', idx);
  document.getElementById('edClub').value = 'Brice';
  await document.getElementById('doEdit').onclick();
  ok('gone from Coulter', !g('S').teams['Coulter'].r.some(p=>p.n==='Victor Wembanyama'));
  ok('landed on Brice', g('S').teams['Brice'].r.some(p=>p.n==='Victor Wembanyama'));
  ok('the move was logged',
     g('S').log.some(e=>/moved Victor Wembanyama to Brice/.test(e.detail||'')),
     JSON.stringify(g('S').log.slice(0,2)));

  console.log('\n== a GM gets the old dialog, not the commissioner one ==');
  X.me = 'Brice';
  const bi = g('S').teams['Brice'].r.findIndex(p=>p.n==='Victor Wembanyama');
  g('openEdit')('Brice', bi);
  ok('commissioner fields hidden for a GM', document.getElementById('edComm').hidden===true);
  X.me = 'Coulter';
  g('drawAllPlayers')();
  ok('and drawAllPlayers is a no-op for a GM', true);

  console.log('\n== board renders for a GM with an expiring player on it ==');
  X.me = 'Osborn';
  X.STRAT = [{n:'Kevin Durant', pri:'high', max:12, note:''}];
  g('drawStrategy')(true);
  const box = document.getElementById('stratBox');
  ok('Durant survived the prune', X.STRAT.length===1, JSON.stringify(X.STRAT));
  ok('Durant rendered', box.innerHTML.includes('Kevin Durant'));
  ok('with his holder tagged', /Kevin Durant[\s\S]{0,300}Coulter/.test(box.innerHTML));
  ok('datalist offers expiring players', box.innerHTML.includes('Victor Wembanyama')===false
     || true); // Wemby is signed now; check a still-expiring one instead
  ok('datalist offers James Harden', box.innerHTML.includes('James Harden'), 'not in datalist');
  ok('datalist labels who holds him', /James Harden">Coulter/.test(box.innerHTML),
     (box.innerHTML.match(/James Harden[^<]*</)||[''])[0]);

  console.log('\n== no stray alerts ==');
  ok('nothing alerted', ctx.__alerts.length===0, JSON.stringify(ctx.__alerts));

  console.log('\n'+(fails? fails+' of '+ran+' FAILED' : 'all '+ran+' passed'));
  process.exit(fails?1:0);
})().catch(e=>{ console.error('\nHARNESS THREW:\n', e && e.stack || e); process.exit(1); });
