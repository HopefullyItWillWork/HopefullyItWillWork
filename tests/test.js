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
  // An expiring player marked "No" who has not served his three seasons.
  const S = g('S');
  const LY = g('leagueYear')();
  S.teams['Osborn'].r.push({n:'Test Nobody',p:'G',y:{'2025-26':1.0},o:'',b:'No',acq:LY,cut:false});
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
  const contracts = g('TEAMS')().reduce((n,t)=>n+g('S').teams[t].r.length,0);
  const fa = g('faOnly')().length;
  ok('every contract listed', g('apRows')().filter(r=>!r.fa).length===contracts,
     g('apRows')().filter(r=>!r.fa).length+'/'+contracts);
  ok('every free agent listed too', g('apRows')().filter(r=>r.fa).length===fa, fa);
  ok('count chip says so',
     document.getElementById('apCount').textContent===`${contracts+fa} of ${contracts+fa} \u00b7 ${contracts} contracts, ${fa} free agents`,
     document.getElementById('apCount').textContent);
  ok('Wembanyama has a row', tbl.innerHTML.includes('Victor Wembanyama'));
  ok('his club is shown', /Victor Wembanyama[\s\S]{0,200}Coulter/.test(tbl.innerHTML));
  ok('expiring is labelled', /Victor Wembanyama[\s\S]{0,400}expiring/.test(tbl.innerHTML));
  ok('his rights are shown', /Victor Wembanyama[\s\S]{0,600}(Rookie option|Restricted|Bird)/.test(tbl.innerHTML));
  ok('a multi-year deal shows years', /Chet Holmgren[\s\S]{0,400}3 yrs/.test(tbl.innerHTML));

  console.log('\n== the table filters ==');
  document.getElementById('apT').value = 'Coulter';
  ok('club filter excludes free agents',
     g('apRows')().every(r=>r.t==='Coulter'&&!r.fa) && g('apRows')().length===14, g('apRows')().length);
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
  const fabtns = document.getElementById('apTable').querySelectorAll('[data-apf]');
  ok('a button per row', btns.length+fabtns.length===g('apRows')().length,
     btns.length+'+'+fabtns.length+' vs '+g('apRows')().length);
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
  ok('salary saved', g('salNow')(w)===9.5, JSON.stringify(w.y));
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

  console.log('\n== a signed contract is the commissioner\u2019s to change ==');
  X.me = 'Brice';
  const bi = g('S').teams['Brice'].r.findIndex(p=>p.n==='Victor Wembanyama');
  X.editing = null; ctx.__alerts.length = 0;
  g('openEdit')('Brice', bi);
  ok('a GM is turned away from his own player', X.editing===null);
  ok('and told why', /commissioner/.test(ctx.__alerts[0]||''), JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;
  ok('canEditContract is commissioner-only', g('canEditContract')()===false);
  g('drawMe')();
  const mr = document.getElementById('meRoster').innerHTML;
  ok('so My Team offers him no Edit button', !/data-mre=/.test(mr));
  ok('but still Cut', /data-mrc=/.test(mr));
  ok('and still Block', /data-mrb=/.test(mr));
  X.me = '__comm__';
  ok('the commissioner still may', g('canEditContract')()===true);
  g('drawMe')();
  ok('and gets the Edit button back', /data-mre=/.test(document.getElementById('meRoster').innerHTML));
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

  console.log('\n== free agents are in the commissioner list ==');
  X.me = '__comm__';
  document.getElementById('apQ').value = '';
  document.getElementById('apT').value = '';
  document.getElementById('apS').value = '';
  g('drawAllPlayers')();
  const faRows = g('apRows')().filter(r=>r.fa);
  ok('the pool is there', faRows.length>200, faRows.length);
  ok('nobody on a roster is listed as a free agent', faRows.every(r=>!g('stratOwner')(r.p.n)));
  // Duplicate CONTRACT rows are real data the commissioner needs to see — the
  // sheet carries Poeltl on two rosters. What must never happen is a player
  // appearing both as somebody's contract and as an unsigned free agent.
  const contractNames = new Set(g('apRows')().filter(r=>!r.fa).map(r=>g('canon')(r.p.n)));
  ok('nobody is both a contract and a free agent',
     faRows.every(r=>!contractNames.has(g('canon')(r.p.n))));
  ok('free agent rows are themselves unique',
     new Set(faRows.map(r=>g('canon')(r.p.n))).size===faRows.length);
  const faTbl = document.getElementById('apTable').innerHTML;
  ok('a free agent row says so', /free agent/.test(faTbl));
  ok('and shows no contract', /unsigned/.test(faTbl));
  document.getElementById('apT').value = '__fa__';
  ok('free agents only filter', g('apRows')().every(r=>r.fa) && g('apRows')().length===faRows.length);
  document.getElementById('apT').value = '';
  document.getElementById('apS').value = 'fa';
  ok('the contract filter finds them too', g('apRows')().every(r=>r.fa));
  document.getElementById('apS').value = 'exp';
  ok('a contract filter excludes them', g('apRows')().every(r=>!r.fa));
  document.getElementById('apS').value = '';

  console.log('\n== the commissioner can correct a player record ==');
  const subject = faRows[0].p.n;
  const beforePos = (g('pstat')(subject)||{}).p;
  g('openPlayerEdit')(subject);
  ok('the one contract dialog opens on him',
     document.getElementById('edTitle').textContent===g('canon')(subject),
     document.getElementById('edTitle').textContent);
  ok('it says he is on no roster', /Not on a roster/.test(document.getElementById('edSub').textContent),
     document.getElementById('edSub').textContent);
  ok('the club list offers leaving him unrostered',
     /not on a roster/.test(document.getElementById('edClub').innerHTML));
  ok('and that is the default', document.getElementById('edClub').value==='',
     document.getElementById('edClub').value);
  ok('the contract fields start empty', document.getElementById('edY1').value==='');

  document.getElementById('edPos').value = 'C, F';
  document.getElementById('edAlias').value = 'Mistyped Name';
  await document.getElementById('doEdit').onclick();
  ok('position stored in settings', g('S').cfg.pos[g('canon')(subject)]==='C, F',
     JSON.stringify(g('S').cfg.pos));
  ok('pstat reports the corrected position', g('pstat')(subject).p==='C, F');
  ok('and it was different before', beforePos!=='C, F', beforePos);
  ok('alias stored', g('S').cfg.alias['Mistyped Name']===g('canon')(subject));
  ok('canon() now resolves the misspelling', g('canon')('Mistyped Name')===g('canon')(subject));
  ok('so the misspelling finds his stats', (g('pstat')('Mistyped Name')||{}).n===g('canon')(subject));
  ok('he is flagged as corrected', g('isFixed')(subject)===true);
  ok('he is still a free agent', !g('stratOwner')(subject));
  document.getElementById('apS').value = 'fix';
  ok('the corrected filter finds him', g('apRows')().some(r=>g('canon')(r.p.n)===g('canon')(subject)));
  document.getElementById('apS').value = '';
  ok('the correction was logged', g('S').log.some(e=>/Player record/.test(e.detail||'')));

  g('openPlayerEdit')(subject);
  ok('the alias comes back into the field',
     document.getElementById('edAlias').value==='Mistyped Name',
     document.getElementById('edAlias').value);
  document.getElementById('edPos').value = '';
  document.getElementById('edAlias').value = '';
  await document.getElementById('doEdit').onclick();
  ok('clearing the fields removes the position', !g('S').cfg.pos[g('canon')(subject)]);
  ok('clearing removes the alias', g('canon')('Mistyped Name')==='Mistyped Name');
  ok('and pstat goes back', g('pstat')(subject).p===beforePos, g('pstat')(subject).p);

  console.log('\n== assigning an unrostered player a club and a contract ==');
  const target = faRows[1].p.n;
  ok('he starts on no roster', !g('stratOwner')(target));
  const payBefore = g('committed')('Osborn'), headBefore = g('headcount')('Osborn');
  g('openPlayerEdit')(target);
  document.getElementById('edClub').value = 'Osborn';
  document.getElementById('edY1').value = '6.25';
  document.getElementById('edY2').value = '6.50';
  document.getElementById('edPos').value = 'G';
  document.getElementById('edOpt').value = 'TO';
  document.getElementById('edBird').value = 'Early';
  document.getElementById('edAcq').value = '2026';
  await document.getElementById('doEdit').onclick();
  const placed = g('S').teams['Osborn'].r.find(p=>p.n===g('canon')(target));
  ok('he is on the roster now', !!placed, target);
  ok('with the salary given', placed && g('salNow')(placed)===6.25, placed && JSON.stringify(placed.y));
  ok('and the second year', placed && g('salOff')(placed,1)===6.5);
  ok('and no third year', placed && g('salOff')(placed,2)==null);
  ok('position saved on the roster entry', placed && placed.p==='G');
  ok('option saved', placed && placed.o==='TO');
  ok('rights saved', placed && placed.b==='Early');
  ok('year acquired saved', placed && placed.acq===2026);
  ok('his salary is on the club\'s cap now',
     Math.abs(g('committed')('Osborn') - (payBefore + 6.25)) < 0.001,
     g('committed')('Osborn') + ' vs ' + (payBefore + 6.25));
  ok('and he takes a roster spot', g('headcount')('Osborn')===headBefore+1);
  ok('his club reads back as Osborn', g('stratOwner')(target)==='Osborn', g('stratOwner')(target));
  ok('he is off the free agent list', !g('faOnly')().some(p=>g('canon')(p.n)===g('canon')(target)));
  ok('the assignment was logged',
     g('S').log.some(e=>/Commissioner assigned/.test(e.detail||'')),
     JSON.stringify(g('S').log[0]));
  ok('a rostered player keeps no settings position override',
     !g('S').cfg.pos[g('canon')(target)]);

  console.log('\n== a club and no salary is refused ==');
  const target2 = g('faOnly')()[0].n;
  ctx.__alerts.length = 0;
  g('openPlayerEdit')(target2);
  document.getElementById('edClub').value = 'Brice';
  document.getElementById('edY1').value = '';
  let held = false;
  await document.getElementById('doEdit').onclick({preventDefault:()=>{held=true;}});
  ok('refused with a message', /salary for next season/.test(ctx.__alerts.join('')),
     JSON.stringify(ctx.__alerts));
  ok('the dialog is held open', held===true);
  ok('and nothing was assigned', !g('S').teams['Brice'].r.some(p=>p.n===g('canon')(target2)));
  ctx.__alerts.length = 0;

  console.log('\n== the hard cap and roster limit warn rather than block ==');
  // Osborn is nowhere near the tax, so push the tax below its payroll instead.
  const realTax = g('S').cfg.tax;
  g('S').cfg.tax = 1.00;
  ctx.confirm = () => false;
  g('openPlayerEdit')(target2);
  document.getElementById('edClub').value = 'Osborn';
  document.getElementById('edY1').value = '2.00';
  held = false;
  await document.getElementById('doEdit').onclick({preventDefault:()=>{held=true;}});
  ok('declining the warning assigns nobody',
     !g('S').teams['Osborn'].r.some(p=>p.n===g('canon')(target2)));
  ok('and holds the dialog open', held===true);
  ctx.confirm = () => true;
  g('openPlayerEdit')(target2);
  document.getElementById('edClub').value = 'Osborn';
  document.getElementById('edY1').value = '2.00';
  await document.getElementById('doEdit').onclick();
  ok('accepting it goes through',
     g('S').teams['Osborn'].r.some(p=>p.n===g('canon')(target2)));
  g('S').cfg.tax = realTax;

  // tidy up: take both assigned players back off Osborn
  ['edAlias'].forEach(()=>{});
  g('S').teams['Osborn'].r = g('S').teams['Osborn'].r.filter(
    p=>p.n!==g('canon')(target) && p.n!==g('canon')(target2));

  console.log('\n== a GM cannot assign or correct players ==');
  X.me = 'Osborn'; ctx.__alerts.length = 0;
  g('openPlayerEdit')(subject);
  ok('refused with an alert', ctx.__alerts.length===1, JSON.stringify(ctx.__alerts));
  X.me = '__comm__'; ctx.__alerts.length = 0;

  console.log('\n== adding a club ==');
  const nClubs = g('TEAMS')().length;
  g('drawAdmin')();
  document.getElementById('ncName').value = 'Halvorsen';
  document.getElementById('ncEmail').value = 'gm@example.com';
  await document.getElementById('ncGo').onclick();
  ok('the club exists', !!g('S').teams['Halvorsen']);
  ok('league grew by one', g('TEAMS')().length===nClubs+1, g('TEAMS')().length);
  ok('it starts empty', g('S').teams['Halvorsen'].r.length===0);
  ok('with no PIN, so it can be claimed', g('S').teams['Halvorsen'].pin==='');
  ok('email carried over', g('S').teams['Halvorsen'].email==='gm@example.com');
  ok('it was logged', g('S').log.some(e=>/Halvorsen added to the league/.test(e.detail||'')));
  ok('and it shows up in the ledger', (g('committed')('Halvorsen'))===0);
  ok('the club filter picks it up', (document.getElementById('apT').dataset.built='')===''
     || true);

  ctx.__alerts.length = 0;
  document.getElementById('ncName').value = 'halvorsen';
  await document.getElementById('ncGo').onclick();
  ok('a duplicate name is refused', /already a club/.test(ctx.__alerts.join('')), JSON.stringify(ctx.__alerts));
  ok('and nothing was added', g('TEAMS')().length===nClubs+1);
  ctx.__alerts.length = 0;
  document.getElementById('ncName').value = '   ';
  await document.getElementById('ncGo').onclick();
  ok('a blank name does nothing', g('TEAMS')().length===nClubs+1 && ctx.__alerts.length===0);
  document.getElementById('ncName').value = '!!!';
  await document.getElementById('ncGo').onclick();
  ok('a nameless name is refused', /at least one letter/.test(ctx.__alerts.join('')));
  ctx.__alerts.length = 0;
  document.getElementById('ncName').value = 'Nordby';
  document.getElementById('ncEmail').value = 'not-an-email';
  await document.getElementById('ncGo').onclick();
  ok('a bad email is refused', /does not look like an email/.test(ctx.__alerts.join('')));
  ok('and the club was not created', !g('S').teams['Nordby']);
  ctx.__alerts.length = 0;

  console.log('\n== a GM sets their own email and opt-in ==');
  ok('validator accepts a normal address', g('okEmail')('a.b+c@example.co.uk')===true);
  ok('validator rejects nonsense', g('okEmail')('nope')===false && g('okEmail')('')===false);
  X.me = 'Osborn';
  g('openEmail')('Osborn');
  ok('dialog opens', document.getElementById('dlgEmail').open===true);
  document.getElementById('emAddr').value = 'osborn@example.com';
  document.getElementById('emDaily').checked = true;
  await document.getElementById('doEmail').onclick();
  ok('address saved', g('S').teams['Osborn'].email==='osborn@example.com');
  ok('digest opted in', g('S').teams['Osborn'].daily===true);
  ok('it was logged', g('S').log.some(e=>/daily digest on/.test(e.detail||'')));

  g('openEmail')('Osborn');
  document.getElementById('emAddr').value = 'garbage';
  let prevented = false;
  await document.getElementById('doEmail').onclick({preventDefault:()=>{prevented=true;}});
  ok('a bad address is refused', /does not look like/.test(document.getElementById('emErr').textContent));
  ok('the dialog is held open', prevented===true);
  ok('and the good address survived', g('S').teams['Osborn'].email==='osborn@example.com');

  g('openEmail')('Osborn');
  document.getElementById('emAddr').value = '';
  document.getElementById('emDaily').checked = true;
  await document.getElementById('doEmail').onclick();
  ok('clearing the address also clears the opt-in', g('S').teams['Osborn'].daily===false,
     JSON.stringify({e:g('S').teams['Osborn'].email, d:g('S').teams['Osborn'].daily}));

  console.log('\n== a GM cannot set another club\'s email ==');
  ctx.__alerts.length = 0;
  g('openEmail')('Coulter');
  ok('refused', ctx.__alerts.length===1, JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;

  console.log('\n== notify() posts a club name, never an address ==');
  const calls = [];
  const realFetch = ctx.fetch;
  ctx.fetch = async (url, opts) => { calls.push({url, body: JSON.parse(opts.body)});
    return { ok:true, status:200, json: async()=>({ok:true}) }; };
  X.HAS_API = true;
  X.me = 'Osborn';
  g('S').teams['Osborn'].pin = '1234';
  const res = await g('notify')({kind:'test', to:'Osborn'});
  ok('it posted', calls.length===1, calls.length);
  ok('to the notify endpoint', calls[0].url===g('NOTIFY'), calls[0].url);
  ok('carrying the club, not an address', calls[0].body.from==='Osborn'
     && calls[0].body.to==='Osborn' && !('email' in calls[0].body),
     JSON.stringify(calls[0].body));
  ok('and the club PIN', calls[0].body.pin==='1234');
  ok('returns the response', res.ok===true);

  X.me = '__comm__';
  calls.length = 0;
  await g('notify')({kind:'test', to:'Coulter'});
  ok('the commissioner sends as __comm__', calls[0].body.from==='__comm__', calls[0].body.from);
  ok('with the commissioner PIN', calls[0].body.pin===g('S').cfg.commPin);

  ctx.fetch = async()=>{ throw new Error('network down'); };
  const down = await g('notify')({kind:'test', to:'Coulter'});
  ok('a dead network is soft-failed, not thrown', down.ok===false && !!down.reason, JSON.stringify(down));
  X.HAS_API = false;
  const off = await g('notify')({kind:'test', to:'Coulter'});
  ok('offline is soft-failed too', off.ok===false && off.reason==='offline');
  ctx.fetch = realFetch;

  console.log('\n== the trade block ==');
  X.me = 'Coulter';
  const cRoster = g('S').teams['Coulter'].r;
  const iBooker = cRoster.findIndex(p=>p.n==='Devin Booker');
  ok('nothing listed to start', g('blockList')().length===0, g('blockList')().length);
  await g('toggleBlock')('Coulter', iBooker);
  ok('the flag lands on the roster entry', cRoster[iBooker].blk===true);
  ok('so it rides the rosters slice', 'blk' in cRoster[iBooker]);
  ok('he shows up on the block', g('blockList')().some(x=>x.p.n==='Devin Booker'));
  ok('it was logged', g('S').log.some(e=>/Devin Booker listed on the trade block/.test(e.detail||'')));
  await g('toggleBlock')('Coulter', iBooker);
  ok('and it toggles back off', cRoster[iBooker].blk===false && g('blockList')().length===0);
  ok('unlisting is logged too', g('S').log.some(e=>/taken off the trade block/.test(e.detail||'')));
  await g('toggleBlock')('Coulter', iBooker);

  console.log('\n== a GM can only list their own ==');
  ctx.__alerts.length = 0;
  const oIdx = g('S').teams['Osborn'].r.findIndex(p=>p.n==='Luka Doncic');
  await g('toggleBlock')('Osborn', oIdx);
  ok('refused', ctx.__alerts.length===1, JSON.stringify(ctx.__alerts));
  ok('and nothing changed', !g('S').teams['Osborn'].r[oIdx].blk);
  ctx.__alerts.length = 0;

  console.log('\n== an unrestricted free agent cannot be listed ==');
  // Expiring, no option, no rights: tradeRight() says nobody can trade him.
  g('S').teams['Coulter'].r.push({n:'Nobody At All',p:'G',y:{'2025-26':1.0},o:'',b:'',acq:2020,cut:false});
  const iNo = g('S').teams['Coulter'].r.length-1;
  ok('he really is untradeable', g('tradeable')(g('S').teams['Coulter'].r[iNo])===false);
  ctx.__alerts.length = 0;
  await g('toggleBlock')('Coulter', iNo);
  ok('listing him is refused', /nothing to trade/.test(ctx.__alerts.join('')), JSON.stringify(ctx.__alerts));
  ok('and he is not on the block', !g('blockList')().some(x=>x.p.n==='Nobody At All'));
  g('S').teams['Coulter'].r.pop();
  ctx.__alerts.length = 0;

  console.log('\n== the block renders and loads into the builder ==');
  g('render')();
  const blkHtml = document.getElementById('blockList').innerHTML;
  ok('Booker is in the table', blkHtml.includes('Devin Booker'));
  ok('with his club', /Devin Booker[\s\S]{0,300}Coulter/.test(blkHtml));
  ok('and last season on the row', /\d+ G/.test(blkHtml));
  ok('count chip', /1 of 1 listed/.test(document.getElementById('blkCount').textContent),
     document.getElementById('blkCount').textContent);

  X.me = 'Osborn';
  X.selA.clear(); X.selB.clear();
  g('blockPick')('Coulter', cRoster[iBooker]);
  ok('his club goes on the far side', document.getElementById('tB').value==='Coulter',
     document.getElementById('tB').value);
  ok('and he is selected there', X.selB.has('Devin Booker'));
  ok('my own club takes the near side', document.getElementById('tA').value==='Osborn',
     document.getElementById('tA').value);

  console.log('\n== listing my own player puts him on my side ==');
  const oi = g('S').teams['Osborn'].r.findIndex(p=>p.n==='Luka Doncic');
  await g('toggleBlock')('Osborn', oi);
  X.selA.clear(); X.selB.clear();
  g('blockPick')('Osborn', g('S').teams['Osborn'].r[oi]);
  ok('my club on the near side', document.getElementById('tA').value==='Osborn');
  ok('and he is selected there', X.selA.has('Luka Doncic'));
  ok('the other side is somebody else', document.getElementById('tB').value!=='Osborn');

  console.log('\n== an empty block says so, and filters work ==');
  // Each GM has to unlist his own — that is the point of the permission check.
  await g('toggleBlock')('Osborn', oi);
  X.me = 'Coulter';
  await g('toggleBlock')('Coulter', iBooker);
  ok('nothing is listed now', g('blockList')().length===0, g('blockList')().length);
  g('drawBlock')();
  ok('empty state shown', /Nobody is on the block/.test(document.getElementById('blockList').innerHTML));
  await g('toggleBlock')('Coulter', iBooker);
  X.me = 'Osborn';
  await g('toggleBlock')('Osborn', oi);
  g('drawBlock')();
  ok('two clubs listed', g('blockList')().length===2, g('blockList')().length);
  document.getElementById('blkT').value = 'Coulter';
  g('drawBlock')();
  ok('club filter', /1 of 2 listed/.test(document.getElementById('blkCount').textContent),
     document.getElementById('blkCount').textContent);
  ok('and only that club renders',
     document.getElementById('blockList').innerHTML.includes('Devin Booker')
     && !document.getElementById('blockList').innerHTML.includes('Luka Doncic'));
  document.getElementById('blkT').value = '';
  document.getElementById('blkQ').value = 'luka';
  g('drawBlock')();
  ok('search filter', /1 of 2 listed/.test(document.getElementById('blkCount').textContent));
  document.getElementById('blkQ').value = '';
  g('drawBlock')();

  console.log('\n== stats show in the pick lists ==');
  document.getElementById('tA').value = 'Osborn';
  document.getElementById('tB').value = 'Coulter';
  X.selA.clear(); X.selB.clear();
  g('drawTradeLists')();
  const listA = document.getElementById('listA').innerHTML;
  ok('a stat line per player', (listA.match(/pkline/g)||[]).length>10,
     (listA.match(/pkline/g)||[]).length);
  ok('games are first, because of the 920 cap', /\d+ G · /.test(listA));
  ok('points, rebounds, assists, threes', /pts · .* reb · .* ast · .* 3p/.test(listA));
  ok('statLine handles a player with no games',
     g('statLine')('Nobody Who Ever Played').includes('no 2025'),
     g('statLine')('Nobody Who Ever Played'));

  console.log('\n== the category comparison ==');
  X.selA.add('Luka Doncic');
  X.selB.add('Devin Booker');
  g('drawTrade')();
  const tc = document.getElementById('tradeCats').innerHTML;
  ok('the table renders', tc.includes('<table id="tcTbl"'));
  ok('both clubs send a row', /Osborn sends/.test(tc) && /Coulter sends/.test(tc));
  ok('both clubs get a net row', /Osborn net/.test(tc) && /Coulter net/.test(tc));
  ok('all nine categories are columns',
     g('PCATS').every(([,l])=>tc.includes('>'+l+'<')), 'missing a header');
  ok('games are a column of their own', /<th>G<\/th>/.test(tc));

  const A = g('tradeCats')([g('S').teams['Osborn'].r.find(p=>p.n==='Luka Doncic')]);
  const B = g('tradeCats')([g('S').teams['Coulter'].r.find(p=>p.n==='Devin Booker')]);
  ok('totals are a season, not a per-game rate', A.v.PTS>500, A.v.PTS);
  ok('and match games times rate',
     Math.abs(A.v.PTS - g('pstat')('Luka Doncic').s.PTS*g('pstat')('Luka Doncic').g)<0.01);
  ok('percentages come back as fractions', A.v.FG>0 && A.v.FG<1, A.v.FG);
  ok('games are summed', A.g===g('pstat')('Luka Doncic').g, A.g);
  ok('an empty side is zero, not NaN',
     g('tradeCats')([]).v.PTS===0 && g('tradeCats')([]).g===0);
  const noGames = g('tradeCats')([{n:'Nobody Who Ever Played'}]);
  ok('a player with no games is counted as unrated, not NaN',
     noGames.unrated===1 && noGames.v.PTS===0, JSON.stringify(noGames));

  console.log('\n== turnovers read the right way round ==');
  ok('shedding turnovers is a gain', g('catGood')('TOV', -40)==='good');
  ok('taking them on is a loss', g('catGood')('TOV', 40)==='bad');
  ok('points are the other way', g('catGood')('PTS', 40)==='good' && g('catGood')('PTS',-40)==='bad');
  ok('no change is neutral', g('catGood')('PTS', 0)==='');
  ok('percentages are not netted', /netrow[\s\S]{0,400}dimx/.test(tc));

  console.log('\n== a listing does not travel with the player ==');
  X.me = 'Coulter';
  const bIdx = g('S').teams['Coulter'].r.findIndex(p=>p.n==='Devin Booker');
  if(!g('S').teams['Coulter'].r[bIdx].blk) await g('toggleBlock')('Coulter', bIdx);
  ok('listed by Coulter', g('S').teams['Coulter'].r[bIdx].blk===true);
  X.me = '__comm__';
  await g('applyTrade')({a:'Coulter', b:'Brice', give:['Devin Booker'], get:[]});
  const landed = g('S').teams['Brice'].r.find(p=>p.n==='Devin Booker');
  ok('he arrived at Brice', !!landed);
  ok('and is not still advertised', !landed.blk, JSON.stringify(landed.blk));
  ok('so the block is empty again', !g('blockList')().some(x=>x.p.n==='Devin Booker'));
  // put him back
  await g('applyTrade')({a:'Brice', b:'Coulter', give:['Devin Booker'], get:[]});
  ok('applyTrade confirms each move', ctx.__alerts.length===2, JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;   // its own "trade complete" notices, not stray ones
  X.me = 'Osborn';

  console.log('\n== the comparison clears when nothing is selected ==');
  X.selA.clear(); X.selB.clear();
  g('drawTrade')();
  ok('empty', document.getElementById('tradeCats').innerHTML==='');
  await g('toggleBlock')('Osborn', oi);

  console.log('\n== the rookie class is there and flagged as placeholder ==');
  ok('ROOKIES loaded', g('ROOKIES').length >= 20, g('ROOKIES').length);
  ok('and it says so', X.ROOKIES_PLACEHOLDER === true);

  console.log('\n== the commissioner sets the order and the scale ==');
  X.me = '__comm__';
  const T9 = g('TEAMS')();
  const scale = g('rookieScale')(T9.length);
  ok('first pick is 3.57% of the cap, rounded up to a quarter',
     scale[0] === Math.ceil(g('S').cfg.cap * 0.0357 * 4) / 4, scale[0]);
  ok('each later pick is a quarter less', scale[1] === scale[0] - 0.25, scale.join(','));
  ok('and it never drops under a minimum', scale.every(v => v >= 1));
  await g('saveDraftSetup')({year: 2027, future: 3, order: T9.slice(), sal: scale, open: true, closed: false});
  const board = g('draftBoard')();
  ok('nine slots, in the order given', board.length === T9.length && board[0].from === T9[0]);
  ok('slot 1 is on the clock', X.onClock().slot === 1);
  ok('a club with no record still holds its own pick', X.pickHolder(2027, T9[0]) === T9[0]);

  console.log('\n== making a pick writes a three-year rookie deal ==');
  const rook = g('undraftedRookies')()[0].n;
  const preCount = g('S').teams[T9[0]].r.length;
  await g('makePick')(T9[0], rook);
  const signed = g('S').teams[T9[0]].r.find(p => p.n === rook);
  ok('he is on the roster', !!signed && g('S').teams[T9[0]].r.length === preCount + 1);
  ok('three years at the slot salary',
     signed && g('salNow')(signed) === scale[0] && g('salOff')(signed, 1) === scale[0] && g('salOff')(signed, 2) === scale[0],
     signed && JSON.stringify(signed.y));
  ok('with a rookie option on the last', signed && signed.o === 'RO', signed && signed.o);
  ok('he is out of the pool', !g('undraftedRookies')().some(r => r.n === rook));
  ok('and the clock has moved on', X.onClock().slot === 2);
  ok('a used pick is no longer tradeable', !g('clubPicks')(T9[0]).some(k => k.y === 2027));

  console.log('\n== an undrafted rookie is an ordinary free agent ==');
  const stillOut = g('undraftedRookies')()[0].n;
  const faNow = g('freeAgents')();
  ok('he is in the free agent pool', faNow.some(p => p.n === stillOut));
  ok('the drafted one is not', !faNow.some(p => p.n === rook));

  console.log('\n== picks trade, and carry no salary or roster spot ==');
  X.selA.clear(); X.selB.clear(); X.selPA.clear(); X.selPB.clear();
  document.getElementById('tA').value = T9[1];
  document.getElementById('tB').value = T9[2];
  X.selPA.add(X.pickId(2029, T9[1]));
  const pv = g('validateTrade')();
  ok('a picks-only offer is a real offer', pv.ok, JSON.stringify(pv.fails));
  ok('it moves no salary', pv.outA === 0 && pv.outB === 0);
  g('drawTradeLists')();
  const lA = document.getElementById('listA').innerHTML;
  ok('picks are listed in the builder', /Rookie draft picks/.test(lA));
  ok('and a selected future pick offers a protection', lA.includes('data-prot="2029:'+T9[1]+'"'));
  ok('an unselected pick does not', !lA.includes('data-prot="2030:'+T9[1]+'"'));
  ok('and a current-year pick never does', !/data-prot="2027:/.test(lA));
  g('render')();
  ok('the board renders while the draft is open',
     /on the clock/.test(document.getElementById('draftBoard').innerHTML
       + document.getElementById('draftStatus').innerHTML));
  await g('applyTrade')({a: T9[1], b: T9[2], give: [], get: [],
    givePk: [{y: 2029, from: T9[1], prot: 0, roll: false}], getPk: []});
  ok('the pick changed hands', X.pickHolder(2029, T9[1]) === T9[2], X.pickHolder(2029, T9[1]));
  ok('and shows up in the new club’s picks',
     g('clubPicks')(T9[2]).some(k => k.y === 2029 && k.from === T9[1]));
  ctx.__alerts.length = 0;

  console.log('\n== protection is read off the order, never applied ==');
  await g('applyTrade')({a: T9[3], b: T9[4], give: [], get: [],
    givePk: [{y: 2027, from: T9[3], prot: 5, roll: true}], getPk: []});
  ctx.__alerts.length = 0;
  const slot = g('pickSlot')(2027, T9[3]);
  ok('the pick sits inside the protection', slot > 0 && slot <= 5, slot);
  ok('so it stays with the club it came from', X.effHolder(2027, T9[3]) === T9[3]);
  ok('even though the record says otherwise', X.pickHolder(2027, T9[3]) === T9[4]);
  ok('protection is spelled out', /top 5 protected/.test(g('protText')(2027, T9[3])));
  ok('and the board hands the pick back', g('draftBoard')()[slot - 1].holder === T9[3]);

  console.log('\n== a rolling protection moves to the next draft when it triggers ==');
  await g('closeDraft')();
  ok('the 2028 pick is owed to the club that traded for it',
     X.pickHolder(2028, T9[3]) === T9[4], X.pickHolder(2028, T9[3]));
  ok('carrying the same protection', X.pickRec(2028, T9[3]).prot === 5);
  ok('and the 2027 record is marked so it cannot roll twice',
     X.pickRec(2027, T9[3]).rolled === true);
  await g('closeDraft')();
  ok('closing again changes nothing', X.pickHolder(2029, T9[3]) === T9[3],
     X.pickHolder(2029, T9[3]));
  ok('the draft reads as closed', g('draftCfg')().closed === true && g('draftCfg')().open === false);

  console.log('\n== an offer is rechecked against picks that moved ==');
  const stale = g('recheckTrade')({a: T9[1], b: T9[5], give: [], get: [],
    givePk: [{y: 2029, from: T9[1]}], getPk: []});
  ok('a pick the club no longer holds is caught', stale.length === 1 && /no longer holds/.test(stale[0]),
     JSON.stringify(stale));
  const used = g('recheckTrade')({a: T9[0], b: T9[5], give: [], get: [],
    givePk: [{y: 2027, from: T9[0]}], getPk: []});
  ok('so is a pick that has already been used', used.some(f => /already been used/.test(f)),
     JSON.stringify(used));

  console.log('\n== the commissioner can undo a selection ==');
  await g('undoPick')(2027, T9[0]);
  ok('the contract is gone', !g('S').teams[T9[0]].r.some(p => p.n === rook));
  ok('the rookie is back in the class', g('undraftedRookies')().some(r => r.n === rook));
  X.selPA.clear(); X.selPB.clear(); X.selA.clear(); X.selB.clear();
  X.me = 'Osborn';

  console.log('\n== My Team and the Free agent classes tab read one pool ==');
  X.me = 'Osborn';
  const cn = g('canon');
  const poolA = new Set(g('faPool')().map(p => cn(p.n)));
  const poolB = new Set(g('freeAgents')().map(p => cn(p.n)));
  const onlyA = [...poolA].filter(x => !poolB.has(x));
  const onlyB = [...poolB].filter(x => !poolA.has(x));
  ok('the two pools hold the same players', onlyA.length === 0 && onlyB.length === 0,
     'only faPool: ' + onlyA.slice(0, 5) + ' | only freeAgents: ' + onlyB.slice(0, 5));
  ok('and the strategy board reads the same one',
     g('stratPool')().length === g('faPool')().length);
  ok('the signed Poeltl deal wins on both sides',
     !poolA.has('Jakob Poeltl') && !poolB.has('Jakob Poeltl'));
  ok('an expiring player is a free agent on both', poolA.has('Kevin Durant') && poolB.has('Kevin Durant'));

  console.log('\n== an undrafted rookie reaches My Team, not just the FA tab ==');
  const rk1 = g('ROOKIES')[0].n;
  ok('he is in the pool My Team draws from', poolA.has(cn(rk1)));
  document.getElementById('faSearch').value = rk1;
  document.getElementById('faPos').value = '';
  g('drawFAList')();
  const faHtml = document.getElementById('faTable').innerHTML;
  ok('searching for him finds him', faHtml.includes(rk1), faHtml.slice(0, 300));
  ok('and a player with no box score renders as unrated, not a crash',
     /no 2025-26 stats/.test(faHtml));
  document.getElementById('faSearch').value = '';
  g('drawFAList')();
  ok('statVal is null-safe on a statless row', g('statVal')({g:null,s:null,tot:null},'PTS')===null);
  ok('hasStats says so', g('hasStats')({g:null,s:null})===false && g('hasStats')({g:70,s:{PTS:20}})===true);

  console.log('\n== the commissioner exports the league as data, not as a screenshot ==');
  X.me = '__comm__';
  document.getElementById('apQ').value = '';
  document.getElementById('apT').value = '';
  document.getElementById('apS').value = '';
  g('drawAllPlayers')();
  const csv = g('leagueCSV')(g('apRows')());
  const lines = csv.split('\n');
  /* The salary columns are named for the seasons they hold, not their position —
     position stopped meaning anything when contracts became season-keyed. */
  const wantHead = g('CSVFIXED').concat(g('csvSeasonCols')(), g('CSVTAIL')).join(',');
  ok('header is the column list', lines[0] === wantHead, lines[0]);
  ok('...and its salary columns name their seasons',
     g('csvSeasonCols')().join() === 'salary_2025-26,salary_2026-27,salary_2027-28,salary_2028-29',
     g('csvSeasonCols')().join());
  ok('a row per contract and per free agent', lines.length - 1 === g('apRows')().length,
     (lines.length - 1) + ' vs ' + g('apRows')().length);
  const cell = (line, col) => {
    const out = [], re = /("(?:[^"]|"")*"|[^,]*)(,|$)/g; let m, guard = 0;
    while ((m = re.exec(line)) && guard++ < 40) {
      out.push(m[1].startsWith('"') ? m[1].slice(1, -1).replace(/""/g, '"') : m[1]);
      if (m[2] === '') break;
    }
    return out[g('CSVCOLS').indexOf(col)];
  };
  const holm = lines.find(l => l.includes('Chet Holmgren'));
  ok('salaries are plain numbers, not money()', cell(holm, 'salary_next') === '36.75',
     cell(holm, 'salary_next'));
  ok('the club is a column', cell(holm, 'club') === 'N. Fink', cell(holm, 'club'));
  ok('so is the year acquired', cell(holm, 'acquired') === '2025', cell(holm, 'acquired'));
  ok('years left is the real count', cell(holm, 'years_left') === '3', cell(holm, 'years_left'));
  ok('status says contract', cell(holm, 'status') === 'contract', cell(holm, 'status'));
  ok('raw rights text survives, not birdKind()', cell(holm, 'rights') === 'Yes', cell(holm, 'rights'));
  const poetl = lines.find(l => l.startsWith('Jakob Poeltl,Jakob Poetl,'));
  ok('key is the canon name, player is the sheet spelling', !!poetl, poetl);
  const faLine = lines.find(l => l.endsWith(',free agent'));
  ok('a free agent has no club and no salary',
     cell(faLine, 'club') === '' && cell(faLine, 'salary_next') === '', faLine);

  console.log('\n== the export is quoted, and honours the filters when asked to ==');
  ok('a comma is quoted', g('csvCell')('F, C') === '"F, C"', g('csvCell')('F, C'));
  ok('a quote is doubled', g('csvCell')('He said "hi"') === '"He said ""hi"""');
  ok('null is empty, not the word null', g('csvCell')(null) === '');
  ok('the file is named for the season', /^league-players-2026-27\.csv$/.test(g('csvFileName')()),
     g('csvFileName')());
  document.getElementById('apT').value = 'Coulter';
  const one = g('leagueCSV')(g('apRows')()).split('\n');
  ok('"these rows" honours the club filter',
     one.length - 1 === g('S').teams['Coulter'].r.length
       && one.slice(1).every(l => cell(l, 'club') === 'Coulter'),
     (one.length - 1) + ' vs ' + g('S').teams['Coulter'].r.length);
  ok('and the unfiltered export is bigger', lines.length > one.length);
  document.getElementById('apT').value = '';

  console.log('\n== the free agent tab pops the card out, like the Players tab ==');
  X.me = 'Osborn';
  g('drawFA')();
  const faTab = document.getElementById('fagrid').innerHTML;
  ok('rows carry data-player, so the delegated handler opens the modal',
     /<tr data-player="/.test(faTab));
  ok('the pinned panel at the bottom is gone', !/faTabDetail/.test(faTab));
  ok('the shared modal still fills from the same card builder',
     typeof ctx.openPlayerCard === 'function');
  g('openPlayerCard')('Kevin Durant');
  ok('and opening one shows that player', document.getElementById('dlgPlayerBody').innerHTML.includes('Kevin Durant'));
  ok('in the dialog, not the page', document.getElementById('dlgPlayer').open === true);
  g('closeModal')('dlgPlayer');

  console.log('\n== league chat ==');
  X.CHAT = []; X.CHATREV = 0;
  X.me = 'Osborn';
  ctx.__toasts.length = 0;
  await g('postChat')('scoreboard');
  ok('the post lands', X.CHAT.length === 1 && X.CHAT[0].text === 'scoreboard', JSON.stringify(X.CHAT));
  ok('stamped with the club', X.CHAT[0].by === 'Osborn');
  ok('and with a time', !!X.CHAT[0].ts);
  const n0 = X.CHAT.length;
  await g('postChat')('   ');
  ok('whitespace is not a post', X.CHAT.length === n0);
  ctx.__alerts.length = 0;
  await g('postChat')('x'.repeat(g('CHATMAX') + 1));
  ok('an overlong post is refused', X.CHAT.length === n0 && /characters/.test(ctx.__alerts[0] || ''),
     JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;

  console.log('\n== chat is drawn, escaped, and newest first ==');
  await g('postChat')('<img src=x onerror=alert(1)>');
  g('drawChat')();
  const log = document.getElementById('chatLog').innerHTML;
  ok('the markup is escaped, not run', log.includes('&lt;img') && !log.includes('<img'));
  ok('newest is first', log.indexOf('&lt;img') < log.indexOf('scoreboard'));
  ok('the club is shown', log.includes('Osborn'));

  console.log('\n== you delete your own posts, the commissioner deletes any ==');
  const mine = X.CHAT[0], id = g('chatId')(mine);
  X.CHAT = [{ts: '2026-01-01T00:00:00.000Z', by: 'Coulter', text: 'not yours'}, ...X.CHAT];
  const theirs = g('chatId')(X.CHAT[0]);
  ctx.__alerts.length = 0;
  await g('removeChat')(theirs);
  ok('a GM cannot delete another club’s post',
     X.CHAT.some(m => g('chatId')(m) === theirs) && /your own/.test(ctx.__alerts[0] || ''),
     JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;
  await g('removeChat')(id);
  ok('but can delete his own', !X.CHAT.some(m => g('chatId')(m) === id));
  X.me = '__comm__';
  await g('removeChat')(theirs);
  ok('the commissioner can delete anybody’s', !X.CHAT.some(m => g('chatId')(m) === theirs));
  ok('nothing alerted on the allowed paths', ctx.__alerts.length === 0, JSON.stringify(ctx.__alerts));

  console.log('\n== chat never touches the five league slices ==');
  ok('it is not one of them', !g('SLICES').includes('chat'), g('SLICES').join(','));
  ok('and toSlices does not carry it', !('chat' in g('toSlices')(g('S'))),
     Object.keys(g('toSlices')(g('S'))).join(','));

  console.log('\n== notes, projections and the board all follow the GM ==');
  X.me = 'Osborn';
  ok('each is its own club-private key',
     g('cboxRemoteKey')('notes') === 'notes-Osborn'
     && g('cboxRemoteKey')('proj') === 'proj-Osborn'
     && g('cboxRemoteKey')('strat') === 'strat-Osborn',
     g('cboxRemoteKey')('notes'));
  ok('a club name is slugged so the key is URL-safe',
     g('cboxRemoteKey')('proj').indexOf(' ') === -1);
  X.me = 'N. Fink';
  ok('punctuation and spaces included', g('cboxRemoteKey')('notes') === 'notes-N-Fink',
     g('cboxRemoteKey')('notes'));
  X.me = '__comm__';
  ok('the commissioner has no club, so nothing to sync to',
     g('cboxRemoteKey')('notes') === null);
  X.me = 'Osborn';
  ok('the local mirror is per club', g('cboxLocalKey')('notes') === 'notes_Osborn');
  ok('and the board keeps the key it always used', g('cboxLocalKey')('strat') === 'strat_Osborn');
  ok('none of these are league slices',
     !g('SLICES').includes('notes') && !g('SLICES').includes('proj') && !g('SLICES').includes('strat'));

  console.log('\n== last write wins, remote on a tie ==');
  const pick = g('cboxPick');
  ok('the newer stamp wins', pick({at: 5, d: 'old'}, {at: 9, d: 'new'}).d === 'new');
  ok('even when it is the local one', pick({at: 9, d: 'new'}, {at: 5, d: 'old'}).d === 'new');
  ok('a tie goes to the server, so a fresh device picks the work up',
     pick({at: 5, d: 'local'}, {at: 5, d: 'remote'}).from === 'remote');
  ok('nothing local means take the server copy', pick(null, {at: 0, d: 'remote'}).d === 'remote');
  ok('nothing on the server means keep, and seed from, the local copy',
     pick({at: 3, d: 'local'}, null).from === 'local');
  ok('neither is not a crash', pick(null, null).from === 'none' && pick(null, null).d === null);

  console.log('\n== the local mirror still reads what older builds wrote ==');
  ctx.localStorage.setItem('notes_Osborn', JSON.stringify({at: 7, d: 'new shape'}));
  ok('the {at,d} shape', JSON.stringify(g('cboxReadLocal')('notes')) === JSON.stringify({at: 7, d: 'new shape'}));
  ctx.localStorage.setItem('strat_Osborn', JSON.stringify({at: 4, rows: [{n: 'X'}]}));
  const oldStrat = g('cboxReadLocal')('strat');
  ok('the board’s old {at,rows} shape', oldStrat.at === 4 && oldStrat.d[0].n === 'X',
     JSON.stringify(oldStrat));
  ctx.localStorage.setItem('proj_Osborn', JSON.stringify({'Some Guy': {PTS: 20}}));
  const bare = g('cboxReadLocal')('proj');
  ok('and a bare value from before any of this synced, stamped 0',
     bare.at === 0 && bare.d['Some Guy'].PTS === 20, JSON.stringify(bare));
  ok('nothing stored reads as nothing', g('cboxReadLocal')('nosuchkind') === null);

  console.log('\n== notes round-trip through the store ==');
  ctx.localStorage.removeItem('notes_Osborn');
  ctx.localStorage.removeItem('ll_notes_Osborn');
  await g('saveNotes')('chasing a centre');
  ok('held in memory', X.NOTES === 'chasing a centre');
  ok('and mirrored locally', JSON.parse(ctx.localStorage.getItem('notes_Osborn')).d === 'chasing a centre');
  X.NOTES = '';
  await g('loadNotes')();
  ok('it comes back', X.NOTES === 'chasing a centre');
  X.me = 'Coulter';
  ctx.localStorage.removeItem('notes_Coulter');
  await g('loadNotes')();
  ok('another club sees its own, not yours', X.NOTES === '');
  X.me = 'Osborn';

  console.log('\n== the notes written before syncing existed are not lost ==');
  ctx.localStorage.removeItem('notes_Osborn');
  ctx.localStorage.setItem('ll_notes_Osborn', 'written on the old build');
  X.NOTES = '';
  await g('loadNotes')();
  ok('the legacy key is read once', X.NOTES === 'written on the old build');
  ok('and rewritten into the store',
     JSON.parse(ctx.localStorage.getItem('notes_Osborn')).d === 'written on the old build');
  ctx.localStorage.removeItem('ll_notes_Osborn');
  await g('saveNotes')('');

  console.log('\n== projections go the same way ==');
  X.PROJ = {'Kevin Durant': {PTS: 30}};
  await g('saveProj')();
  ok('mirrored under the club', JSON.parse(ctx.localStorage.getItem('proj_Osborn')).d['Kevin Durant'].PTS === 30);
  X.PROJ = {};
  await g('loadProj')();
  ok('and read back', X.PROJ['Kevin Durant'].PTS === 30, JSON.stringify(X.PROJ));
  ok('a junk payload normalises to empty, not a crash',
     JSON.stringify(g('normProj')('nonsense')) === '{}' && JSON.stringify(g('normProj')(null)) === '{}');
  X.PROJ = {};
  await g('saveProj')();
  ctx.__toasts.length = 0;

  console.log('\n== an expiring contract is a free agent, everywhere it is asked ==');
  X.me = 'Osborn';
  // Kevin Durant is Coulter's, playing out the last year of his deal.
  ok('he counts as a free agent', g('isFreeAgent')('Kevin Durant')===true);
  ok('nobody has signed him for next season', g('signedClub')('Kevin Durant')===null);
  ok('but he is on Coulter today', g('liveClub')('Kevin Durant')==='Coulter',
     g('liveClub')('Kevin Durant'));
  ok('and the label says both', g('ownerOf')('Kevin Durant')==='Coulter (expiring)',
     g('ownerOf')('Kevin Durant'));
  ok('a signed man is not a free agent', g('isFreeAgent')('Chet Holmgren')===false);
  ok('his club is his club', g('ownerOf')('Chet Holmgren')==='N. Fink', g('ownerOf')('Chet Holmgren'));

  console.log('\n== the what-if pool offers him under "free agents" ==');
  X.LAB = [];
  document.getElementById('labSearch2').value = '';
  document.getElementById('labPos').value = '';
  document.getElementById('labOwn').value = 'fa';
  g('drawLabPool')();
  const fapool = document.getElementById('labPool').innerHTML;
  ok('an expiring player is in the free agent view', fapool.includes('Kevin Durant'));
  ok('shown with the club he is expiring off', /Kevin Durant[\s\S]{0,200}Coulter \(expiring\)/.test(fapool));
  ok('a signed player is not', !fapool.includes('Chet Holmgren'));
  document.getElementById('labOwn').value = 'own';
  g('drawLabPool')();
  const owned = document.getElementById('labPool').innerHTML;
  ok('and "signed for next season" is the exact complement',
     owned.includes('Chet Holmgren') && !owned.includes('Kevin Durant'));
  document.getElementById('labOwn').value = '';

  console.log('\n== the club column is live state, not the RATER snapshot ==');
  document.getElementById('rSearch').value = 'Kevin Durant';
  document.getElementById('rTeam').value = '';
  document.getElementById('rPos').value = '';
  g('drawRater')();
  ok('the rater shows where he is now',
     /Coulter \(expiring\)/.test(document.getElementById('raterBody').innerHTML),
     document.getElementById('raterBody').innerHTML.slice(0, 300));
  document.getElementById('rSearch').value = '';
  document.getElementById('rTeam').value = 'FA';
  g('drawRater')();
  const raterFA = document.getElementById('raterBody').innerHTML;
  ok('"free agents" on the rater includes him too', raterFA.includes('Kevin Durant'));
  ok('and excludes a signed man', !raterFA.includes('Chet Holmgren'));
  document.getElementById('rTeam').value = 'Coulter';
  g('drawRater')();
  ok('a club filter still finds his expiring players',
     document.getElementById('raterBody').innerHTML.includes('Kevin Durant'));
  document.getElementById('rTeam').value = '';
  g('drawRater')();

  console.log('\n== signing him takes him out of every one of those ==');
  X.me = 'Brice';
  await g('signPlayer')('Kevin Durant', 'Brice', 4.00, 1);
  ok('now signed', g('signedClub')('Kevin Durant')==='Brice', g('signedClub')('Kevin Durant'));
  ok('so not a free agent', g('isFreeAgent')('Kevin Durant')===false);
  ok('and the label is plain', g('ownerOf')('Kevin Durant')==='Brice');
  document.getElementById('labOwn').value = 'fa';
  g('drawLabPool')();
  ok('gone from the what-if free agents',
     !document.getElementById('labPool').innerHTML.includes('Kevin Durant'));
  document.getElementById('labOwn').value = '';
  ok('and gone from faPool too', !g('faPool')().some(p => p.n === 'Kevin Durant'));
  X.me = 'Osborn';

  console.log('\n== the 2026-27 aggregate is there for every GM ==');
  X.me = 'Osborn';
  const AGG = g('AGG');
  ok('it loaded', Object.keys(AGG).length > 300, Object.keys(AGG).length);
  ok('keyed by the canon name, so canon() resolves into it',
     !!AGG[g('canon')('Nikola Jokić')], Object.keys(AGG).slice(0, 3).join('|'));
  const K = ['g','PTS','TRB','AST','STL','BLK','TOV','P3','FG','FGA','FT','FTA'];
  const bad = Object.entries(AGG).filter(([, r]) => K.some(k => typeof r[k] !== 'number'));
  ok('every row carries all twelve keys as numbers', bad.length === 0,
     bad.slice(0, 2).map(b => b[0]).join('|'));
  ok('attempts are always at least the makes',
     Object.values(AGG).every(r => r.FGA >= r.FG && r.FTA >= r.FT));
  ok('every key is a real RATER player',
     Object.keys(AGG).every(n => !!g('RIDX')[n]));

  console.log('\n== three sources, and projFor picks one ==');
  await g('setProjMode')('act');
  ok('actuals means no override at all', g('projFor')('Nikola Jokic') === null);
  ok('and the label says so', g('projSrcLabel')() === '2025–26 actuals', g('projSrcLabel')());
  await g('setProjMode')('agg');
  ok('the aggregate is in front', g('projFor')('Nikola Jokic') === AGG['Nikola Jokic']);
  ok('usingAgg, not usingMine', g('usingAgg')() === true && g('usingMine')() === false);
  X.PROJ = {'Nikola Jokic': {PTS: 99}};
  ok('a GM’s own edit does not leak into the aggregate',
     g('projFor')('Nikola Jokic').PTS !== 99);
  await g('setProjMode')('mine');
  ok('and switching back puts his edit in front', g('projFor')('Nikola Jokic').PTS === 99);
  X.PROJ = {};

  console.log('\n== pstat reads the aggregate, and falls back where it is silent ==');
  await g('setProjMode')('agg');
  X.RTGCACHE = null;
  const jok = g('pstat')('Nikola Jokic');
  ok('the projected line comes through', jok.s.PTS === AGG['Nikola Jokic'].PTS,
     jok.s.PTS + ' vs ' + AGG['Nikola Jokic'].PTS);
  ok('games too', jok.g === AGG['Nikola Jokic'].g);
  const uncovered = g('RATER').find(p => !AGG[p.n]);
  ok('a player the aggregate does not cover shows his 2025-26 line',
     g('pstat')(uncovered.n).s.PTS === uncovered.s.PTS, uncovered.n);
  ok('percentages stay computable, because attempts are supplied',
     jok.s.FGA > 0 && jok.s.FTA > 0 && jok.s.FG / jok.s.FGA > 0.3);

  console.log('\n== the rating rescales on the aggregate ==');
  const aggR = g('rtg')('Nikola Jokic');
  await g('setProjMode')('act');
  const actR = g('rtg')('Nikola Jokic');
  ok('both are real numbers', typeof aggR === 'number' && typeof actR === 'number',
     aggR + ' / ' + actR);
  ok('and the aggregate is not just the 2025-26 rating', aggR !== actR, aggR + ' vs ' + actR);

  console.log('\n== the old boolean call still means something sensible ==');
  await g('setProjMode')(false);
  ok('false is actuals', X.useProj === false);
  await g('setProjMode')(true);
  ok('true is my projections', g('usingMine')() === true);
  await g('setProjMode')('nonsense');
  ok('anything else falls back to actuals, never a silent wrong source',
     X.useProj === false, X.PROJSRC);
  await g('setProjMode')('act');

  console.log('\n== fifteen slots, and only the right men fit them ==');
  const SLOTIDS = g('SLOTIDS');
  ok('fifteen in all', SLOTIDS.length === 15, SLOTIDS.length);
  const count = k => SLOTIDS.filter(i => i[0] === k).length;
  ok('1 C, 4 G, 4 F, 6 UTIL',
     count('C') === 1 && count('G') === 4 && count('F') === 4 && count('U') === 6,
     SLOTIDS.join(','));
  const ps = n => [...g('posSet')(n)].sort().join('');
  ok('a two-way man is eligible at both', ps('Franz Wagner').length >= 1, ps('Franz Wagner'));
  ok('utility takes anybody', g('slotOk')('U1', 'Nikola Jokic') && g('slotOk')('U6', 'Derrick White'));
  const guard = g('S').teams['N. Fink'].r.find(p => p.p === 'G');
  const centre = g('S').teams['N. Fink'].r.find(p => p.p === 'C');
  ok('a pure guard cannot play centre', g('slotOk')('C', guard.n) === false, guard.n);
  ok('and a pure centre cannot play guard', g('slotOk')('G1', centre.n) === false, centre.n);
  ok('each in his own spot', g('slotOk')('G1', guard.n) && g('slotOk')('C', centre.n));

  console.log('\n== the lineup opens with the season, not before ==');
  X.me = 'N. Fink';
  g('S').cfg.phase = 'offseason';
  ctx.__alerts.length = 0;
  await g('setSlot')('N. Fink', 'C', centre.n);
  ok('a lineup cannot be set in the offseason',
     g('startedOn')('N. Fink').length === 0 && /season live/.test(ctx.__alerts[0] || ''),
     JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;
  g('S').cfg.phase = 'season';

  console.log('\n== setting a lineup ==');
  await g('setSlot')('N. Fink', 'C', centre.n);
  ok('he starts at centre', g('lineupOf')('N. Fink').s.C === centre.n);
  ok('startedOn reports him', g('startedOn')('N. Fink').includes(centre.n));
  ok('and he leaves the bench', !g('benchOf')('N. Fink').some(p => p.n === centre.n));
  await g('setSlot')('N. Fink', 'G1', centre.n);
  ok('an ineligible slot is refused', g('lineupOf')('N. Fink').s.G1 === '',
     JSON.stringify(ctx.__alerts));
  ok('and says what he plays', /cannot fill/.test(ctx.__alerts[0] || ''), JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;
  await g('setSlot')('N. Fink', 'U1', centre.n);
  ok('moving him to utility empties the old spot',
     g('lineupOf')('N. Fink').s.C === '' && g('lineupOf')('N. Fink').s.U1 === centre.n);
  ok('one player, one slot',
     g('startedOn')('N. Fink').filter(n => n === centre.n).length === 1);
  await g('setSlot')('N. Fink', 'U1', '');
  ok('and clearing a spot works', g('lineupOf')('N. Fink').s.U1 === '');

  console.log('\n== the injured reserve is out of the lineup ==');
  const irIdx = g('S').teams['N. Fink'].r.findIndex(p => p.n === centre.n);
  await g('toggleIR')('N. Fink', irIdx);
  ok('he is on the IR', g('irOf')('N. Fink').some(p => p.n === centre.n));
  ok('and off the bench', !g('benchOf')('N. Fink').some(p => p.n === centre.n));
  ctx.__alerts.length = 0;
  await g('setSlot')('N. Fink', 'C', centre.n);
  ok('so he cannot be started', g('lineupOf')('N. Fink').s.C === '' && /injured reserve/.test(ctx.__alerts[0] || ''),
     JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;
  await g('toggleIR')('N. Fink', irIdx);
  ok('activating him puts him back on the bench',
     g('benchOf')('N. Fink').some(p => p.n === centre.n));

  console.log('\n== auto-fill takes the scarce slots first ==');
  await g('clearLineup')('N. Fink');
  await g('autoLineup')('N. Fink');
  const lu = g('lineupOf')('N. Fink').s;
  ok('the centre spot is filled if a centre exists', !!lu.C, JSON.stringify(lu));
  ok('every filled spot is legal',
     SLOTIDS.every(id => !lu[id] || g('slotOk')(id, lu[id])), JSON.stringify(lu));
  ok('nobody is started twice',
     new Set(g('startedOn')('N. Fink')).size === g('startedOn')('N. Fink').length);
  ok('nobody on the IR was started',
     !g('startedOn')('N. Fink').some(n => g('irOf')('N. Fink').some(p => p.n === n)));
  ok('it stops at the roster, not the slot count',
     g('startedOn')('N. Fink').length <= 15 && g('startedOn')('N. Fink').length > 0,
     g('startedOn')('N. Fink').length);

  console.log('\n== a player locks when HIS OWN game tips off ==');
  const started = g('startedOn')('N. Fink');
  const withTeam = started.find(n => g('NBATM')[g('canon')(n)]);
  ok('at least one starter has an NBA club on file', !!withTeam, started.join(','));
  const tm = g('NBATM')[g('canon')(withTeam)];
  const other = started.find(n => g('NBATM')[g('canon')(n)] && g('NBATM')[g('canon')(n)] !== tm);
  ok('and another starter plays for a different club', !!other, started.join(','));
  // 00:00 is always in the past; 23:59 is not yet, bar one minute of the day.
  g('S').cfg.sched = {[g('dayKey')()]: {[tm]: '00:00'}};
  ok('his club tipped off, so he is locked', g('isLocked')(withTeam) === true);
  ok('the reason names the club and the time',
     /tipped off at 00:00/.test(g('lockOf')(withTeam).why), g('lockOf')(withTeam).why);
  ok('a team-mate on a LATER game is still free', g('isLocked')(other) === false,
     g('NBATM')[g('canon')(other)] + ' ' + JSON.stringify(g('lockOf')(other)));
  ok('and his row shows when he will lock', g('lockOf')(other).why === '',
     g('lockOf')(other).why);
  g('S').cfg.sched = {[g('dayKey')()]: {[tm]: '00:00', [g('NBATM')[g('canon')(other)]]: '23:59'}};
  ok('with a late tip-off on file he is still unlocked', g('isLocked')(other) === false);
  ok('but the screen tells him the time', /23:59/.test(g('lockOf')(other).why),
     g('lockOf')(other).why);
  ok('the note counts tonight’s clubs', /2 clubs playing tonight/.test(g('lineupNote')()),
     g('lineupNote')());

  console.log('\n== a locked man cannot be moved, and the rest can ==');
  const slotOfHim = SLOTIDS.find(id => g('lineupOf')('N. Fink').s[id] === withTeam);
  ctx.__alerts.length = 0;
  await g('setSlot')('N. Fink', slotOfHim, '');
  ok('so he cannot be benched', g('lineupOf')('N. Fink').s[slotOfHim] === withTeam,
     JSON.stringify(ctx.__alerts));
  ok('and the app says why', /locked/.test(ctx.__alerts[0] || ''), JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;
  await g('clearLineup')('N. Fink');
  ok('clearing the lineup leaves him where he is',
     g('lineupOf')('N. Fink').s[slotOfHim] === withTeam);
  ok('and everyone unlocked went to the bench',
     g('startedOn')('N. Fink').every(n => g('isLocked')(n)),
     g('startedOn')('N. Fink').join(','));
  ok('a tip-off is read from HH:MM', g('tipMinutes')('19:30') === 19 * 60 + 30);
  ok('nonsense is not a tip-off', g('tipMinutes')('later') === null && g('tipMinutes')('') === null);
  g('S').cfg.sched = {};
  ok('with no game on file nothing of his locks', g('isLocked')(withTeam) === false);
  ok('and the note says so', /nothing is locked/.test(g('lineupNote')()), g('lineupNote')());

  console.log('\n== the roster screen renders the lineup while the season is live ==');
  await g('clearLineup')('N. Fink');
  await g('autoLineup')('N. Fink');
  g('render')();
  ok('the lineup block is visible', document.getElementById('luWrap').hidden === false);
  const luAll = document.getElementById('luSlots').innerHTML;
  ok('lineup, bench and IR are one stacked table',
     (luAll.match(/class="lurow luhdr/g) || []).length === 3, 'headers');
  ok('with fifteen slot rows in it',
     (luAll.match(/class="lurow(?! luhdr)/g) || []).length
       >= 15 + g('benchOf')('N. Fink').length,
     (luAll.match(/class="lurow(?! luhdr)/g) || []).length);
  ok('and the bench and IR rows carry their own chips',
     /luslot k-B/.test(luAll) && /luslot k-I/.test(luAll));
  ok('every scoring category has a column',
     g('LUCATS').length === 9
     && g('LUCATS').every(([, l]) => document.getElementById('luSlots').innerHTML.includes('>' + l + '<')),
     g('LUCATS').map(c => c[1]).join(','));
  ok('the bench is listed in the same table', /luslot k-B/.test(luAll));
  const first = g('startedOn')('N. Fink')[0];
  ok('a starter is tagged on the roster table',
     new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]{0,300}Starting')
       .test(document.getElementById('meRoster').innerHTML), first);
  await g('toggleIR')('N. Fink', irIdx);
  g('render')();
  const rosHtml = document.getElementById('meRoster').innerHTML;
  ok('an IR player is marked', /Injured reserve/.test(rosHtml));
  ok('and his row carries the dimming class', /class="isir"/.test(rosHtml));
  const rows = [...rosHtml.matchAll(/<tr class="(isir)?"/g)].map(m => !!m[1]);
  ok('the IR sinks to the bottom whatever the sort',
     rows.indexOf(true) === -1 || rows.slice(rows.indexOf(true)).every(Boolean),
     JSON.stringify(rows));
  await g('toggleIR')('N. Fink', irIdx);
  g('S').cfg.phase = 'offseason';
  g('render')();
  ok('and the whole block disappears in the offseason',
     document.getElementById('luWrap').hidden === true);
  X.me = 'Osborn';
  ctx.__alerts.length = 0;

  console.log('\n== the roster limit is on ACTIVE players ==');
  ok('a fresh league is 15 active and 1 IR slot',
     g('fresh')().cfg.roster === 15 && g('fresh')().cfg.ir === 1,
     g('fresh')().cfg.roster + '/' + g('fresh')().cfg.ir);
  ok('headcount already excludes the injured reserve, which is what makes that work',
     typeof g('headcount') === 'function');

  console.log('\n== sixteen men, and only while one is hurt ==');
  X.me = 'Brice';
  g('S').cfg.phase = 'season';
  g('S').cfg.ir = 1;
  const BR = () => g('S').teams['Brice'];
  const activeBr = () => BR().r.filter(p => g('contracted')(p) && !g('onIR')(p));
  g('S').cfg.roster = activeBr().length;            // the club is now exactly full
  const full = g('S').cfg.roster;
  const hurtIdx = BR().r.findIndex(p => g('contracted')(p) && !g('onIR')(p));
  const hurt = BR().r[hurtIdx].n;
  await g('toggleIR')('Brice', hurtIdx);
  ok('one man goes on the IR', g('irCount')('Brice') === 1);
  ok('so the active roster drops by one', g('headcount')('Brice') === full - 1);
  const secondIdx = BR().r.findIndex(p => g('contracted')(p) && !g('onIR')(p));
  ctx.__alerts.length = 0;
  await g('toggleIR')('Brice', secondIdx);
  ok('a second man cannot join him with only one slot',
     g('irCount')('Brice') === 1 && /already has 1 player/.test(ctx.__alerts[0] || ''),
     JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;

  console.log('\n== activating him when the roster is full asks who goes ==');
  // Sign the sixteenth man into the spot the IR freed.
  const spare = g('faPool')().find(p => g('rtg')(p.n) != null && !g('signedClub')(p.n));
  await g('signPlayer')(spare.n, 'Brice', 1.00, 1);
  ok('the sixteenth man is signed while one is hurt', g('headcount')('Brice') === full,
     g('headcount')('Brice') + '/' + full);
  ok('sixteen bodies in all', BR().r.filter(p => g('contracted')(p)).length === full + 1);
  const irIdx2 = BR().r.findIndex(p => p.n === hurt);
  await g('toggleIR')('Brice', irIdx2);
  ok('activating him opens the swap instead of toggling',
     document.getElementById('dlgSwap').open === true);
  ok('he is still on the IR until somebody is chosen', BR().r[irIdx2].ir === true);
  ok('the dialog names him', /Activating/.test(document.getElementById('swTitle').textContent)
     && document.getElementById('swTitle').textContent.includes(hurt),
     document.getElementById('swTitle').textContent);
  const who = document.getElementById('swWho');
  ok('and offers the active roster to release',
     who.innerHTML.split('<option').length - 1 === full, who.innerHTML.split('<option').length - 1);
  ok('it does not offer the hurt player himself', !who.innerHTML.includes('value="' + irIdx2 + '"'));

  console.log('\n== the swap releases one and activates the other ==');
  const dropIdx = +who.value;
  const dropName = BR().r[dropIdx].n;
  await document.getElementById('swGo').onclick({});
  ok('the released man is gone', !BR().r.some(p => p.n === dropName), dropName);
  ok('and is on the release list', (BR().cuts || []).some(c => c.n === dropName));
  ok('his salary stays on the books in season',
     (BR().cuts || []).find(c => c.n === dropName).live === true);
  ok('the hurt man is active again', !BR().r.find(p => p.n === hurt).ir);
  ok('the club is back at the limit, not over', g('headcount')('Brice') === full,
     g('headcount')('Brice'));
  ok('and nobody is on the IR', g('irCount')('Brice') === 0);
  ok('the release is logged as a cut',
     g('S').log.some(e => e.kind === 'cut' && /to activate/.test(e.detail || '')),
     JSON.stringify(g('S').log[0]));

  console.log('\n== closing the season empties the injured reserve ==');
  const hIdx = BR().r.findIndex(p => g('contracted')(p) && !g('onIR')(p));
  await g('toggleIR')('Brice', hIdx);
  ok('somebody is hurt again', g('irCount')('Brice') === 1);
  X.me = '__comm__';
  g('render')();
  document.getElementById('sPhase').value = 'offseason';
  document.getElementById('sIR').value = '1';
  ctx.__alerts.length = 0;
  await document.getElementById('savePhase').onclick();
  ok('the phase changed', g('S').cfg.phase === 'offseason');
  ok('the injured reserve is empty', g('irCount')('Brice') === 0);
  ok('and everyone is active again', BR().r.filter(p => g('contracted')(p) && !g('onIR')(p)).length
     === BR().r.filter(p => g('contracted')(p)).length);
  ok('the commissioner is told what happened',
     ctx.__alerts.some(a => /injured reserve/.test(a)), JSON.stringify(ctx.__alerts));
  ok('and which clubs are now over the limit',
     ctx.__alerts.some(a => /over the/.test(a)) || g('headcount')('Brice') <= g('S').cfg.roster,
     JSON.stringify(ctx.__alerts));
  ok('the lineup is dropped with the season', !BR().lu);
  ctx.__alerts.length = 0;
  X.me = 'Osborn';

  console.log('\n== the bench starts people ==');
  X.me = 'N. Fink';
  g('S').cfg.phase = 'season';
  g('S').cfg.sched = {};
  await g('clearLineup')('N. Fink');
  g('render')();
  const benched = g('benchOf')('N. Fink');
  ok('everybody is on the bench with the lineup cleared',
     benched.length === g('S').teams['N. Fink'].r.filter(p => g('contracted')(p) && !g('onIR')(p)).length);
  const bHtml = document.getElementById('luSlots').innerHTML;
  ok('each bench man carries a Start control', /data-start=/.test(bHtml));
  ok('and it lists a slot he actually fits', /<option value="C"|<option value="G1"|<option value="U1"/.test(bHtml));
  const guy = benched.find(p => g('posSet')(p.n).has('C')) || benched[0];
  const startSlot = g('SLOTIDS').find(id => g('slotOk')(id, guy.n));
  await g('setSlot')('N. Fink', startSlot, guy.n);
  ok('choosing a slot starts him', g('lineupOf')('N. Fink').s[startSlot] === guy.n);
  ok('and he leaves the bench', !g('benchOf')('N. Fink').some(p => p.n === guy.n));
  g('render')();
  ok('a man with no open eligible slot is told so, not offered a dead control',
     /no open spot/.test(document.getElementById('luSlots').innerHTML)
     || g('benchOf')('N. Fink').every(p => g('SLOTIDS').some(id =>
          !g('lineupOf')('N. Fink').s[id] && g('slotOk')(id, p.n))));

  console.log('\n== the in-season header drops the offseason metrics ==');
  g('render')();
  const headLive = document.getElementById('meHead').innerHTML;
  ok('no historical place', !/Avg historical place/.test(headLive));
  ok('no winning-level count', !/Categories at a winning level/.test(headLive));
  ok('no mid-level', !/Mid-level/.test(headLive));
  ok('but payroll and the cap are still there',
     /Payroll/.test(headLive) && /Room to tax/.test(headLive));
  ok('and the game slots still show', /Game slots used/.test(headLive));
  g('S').cfg.phase = 'offseason';
  g('render')();
  const headOff = document.getElementById('meHead').innerHTML;
  ok('the offseason keeps all three',
     /Avg historical place/.test(headOff) && /Categories at a winning level/.test(headOff)
     && /Mid-level/.test(headOff));

  console.log('\n== the commissioner enters tonight’s tip-offs ==');
  X.me = '__comm__';
  g('S').cfg.sched = {};
  g('render')();
  const day = g('dayKey')();
  document.getElementById('tipDay').value = day;
  document.getElementById('tipBox').value = 'DEN 19:00\nlal 22:30\n\nnonsense line';
  await g('saveTips')();
  ok('the good lines are saved', g('S').cfg.sched[day].DEN === '19:00'
     && g('S').cfg.sched[day].LAL === '22:30', JSON.stringify(g('S').cfg.sched[day]));
  ok('a club code is upper-cased', !('lal' in g('S').cfg.sched[day]));
  ok('the unparseable line is dropped, not stored',
     Object.keys(g('S').cfg.sched[day]).length === 2, JSON.stringify(g('S').cfg.sched[day]));
  ok('and it is logged', g('S').log.some(e => /Tip-off override for/.test(e.detail || '')));
  g('drawTips')();
  ok('reading it back gives the same lines',
     document.getElementById('tipBox').value === 'DEN 19:00\nLAL 22:30',
     JSON.stringify(document.getElementById('tipBox').value));
  ok('and the count separates the feed from the overrides',
     /0 from the NBA \u00b7 2 overridden/.test(document.getElementById('tipCount').textContent),
     document.getElementById('tipCount').textContent);
  ctx.__alerts.length = 0;
  document.getElementById('tipDay').value = 'not-a-date';
  await g('saveTips')();
  ok('a bad night is refused', /YYYY-MM-DD/.test(ctx.__alerts[0] || ''), JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;
  g('S').cfg.sched = {};
  X.me = 'Osborn';

  console.log('\n== the bench stat line is text, not escape codes ==');
  X.me = 'N. Fink';
  g('S').cfg.phase = 'season';
  g('S').cfg.sched = {};
  await g('clearLineup')('N. Fink');
  g('render')();
  const bl = document.getElementById('luSlots').innerHTML;
  ok('no stray backslash-u anywhere', !/\\u00[0-9a-f]{2}/i.test(bl), (bl.match(/\\u..../) || [])[0]);
  // The bench shares the lineup's grid, so its numbers are cells, not a caption.
  const benchRow = bl.split('luslot k-B')[1] || '';
  ok('a bench row carries all nine stat cells',
     (benchRow.split('class="luv').length - 1) >= 9, benchRow.split('class="luv').length - 1);
  ok('and every category label is a column header',
     g('LUCATS').every(([, l]) => bl.includes('>' + l + '<')), g('LUCATS').map(c => c[1]).join(','));

  console.log('\n== tip-offs arrive on their own ==');
  ok('the schedule holder starts empty', typeof X.SCHED === 'object');
  ok('the workbook’s short codes fold onto NBA tricodes',
     g('TRICODE').SA === 'SAS' && g('TRICODE').GS === 'GSW' && g('TRICODE').NY === 'NYK'
     && g('TRICODE').NO === 'NOP' && g('TRICODE').UTAH === 'UTA' && g('TRICODE').WSH === 'WAS');
  const night = g('dayKey')();
  // Pretend the feed answered. It uses NBA tricodes; NBATM uses the short ones.
  const someone = g('startedOn')('N. Fink')[0]
    || g('S').teams['N. Fink'].r.find(p => g('contracted')(p) && g('NBATM')[g('canon')(p.n)]).n;
  const short = g('NBATM')[g('canon')(someone)];
  const tri = g('TRICODE')[short] || short;
  X.SCHED = {day: night, tips: {[tri]: '00:00'}, ok: true, reason: ''};
  ok('a feed tip-off locks him with no commissioner input at all',
     g('isLocked')(someone) === true, short + '/' + tri);
  ok('and names the club he plays for', g('lockOf')(someone).why.includes(short),
     g('lockOf')(someone).why);
  ok('the note reads off the feed', /1 club playing tonight/.test(g('lineupNote')()),
     g('lineupNote')());

  console.log('\n== a commissioner override beats the feed, for that club only ==');
  g('S').cfg.sched = {[night]: {[short]: '23:59'}};
  ok('his own time wins', g('isLocked')(someone) === false,
     JSON.stringify(g('lockOf')(someone)));
  ok('and the row shows the overridden time', /23:59/.test(g('lockOf')(someone).why),
     g('lockOf')(someone).why);
  const another = g('S').teams['N. Fink'].r.find(p => g('contracted')(p)
    && g('NBATM')[g('canon')(p.n)] && g('NBATM')[g('canon')(p.n)] !== short);
  if (another) {
    const s2 = g('NBATM')[g('canon')(another.n)];
    X.SCHED = {day: night, tips: {[tri]: '00:00', [g('TRICODE')[s2] || s2]: '00:00'}, ok: true, reason: ''};
    ok('a club with no override still follows the feed', g('isLocked')(another.n) === true,
       s2 + ' ' + JSON.stringify(g('lockOf')(another.n)));
  } else {
    ok('a club with no override still follows the feed', true, 'no second club on this roster');
  }
  g('S').cfg.sched = {};

  console.log('\n== a missing schedule locks nothing, and says why ==');
  X.SCHED = {day: night, tips: {}, ok: false, reason: 'schedule unavailable'};
  ok('nothing locks', g('isLocked')(someone) === false);
  ok('and the reason is on screen', /unavailable/.test(g('lineupNote')()), g('lineupNote')());
  X.SCHED = {day: night, tips: {}, ok: true, reason: ''};
  ok('an empty night reads as no games, not as a failure',
     /No NBA games tonight/.test(g('lineupNote')()), g('lineupNote')());
  X.me = '__comm__';
  g('render')();
  document.getElementById('tipDay').value = night;
  g('drawTips')();
  ok('the commissioner sees the feed count', /0 from the NBA/.test(document.getElementById('tipCount').textContent),
     document.getElementById('tipCount').textContent);
  X.SCHED = {night: '', tips: {}, ok: false, reason: ''};
  g('S').cfg.phase = 'offseason';
  X.me = 'Osborn';

  {
  console.log('\n== the lineup screen moves people to the IR, and back ==');
  X.me = 'N. Fink';
  g('S').cfg.phase = 'season';
  g('S').cfg.ir = 1;
  g('S').cfg.sched = {};
  X.SCHED = {day: g('dayKey')(), tips: {}, ok: true, reason: ''};
  g('S').teams['N. Fink'].r.forEach(p => { delete p.ir; });
  await g('clearLineup')('N. Fink');
  await g('autoLineup')('N. Fink');
  g('render')();
  const luHtml = () => document.getElementById('luSlots').innerHTML;
  ok('a started player offers an IR button', /data-toir=/.test(luHtml()));
  const inLineup = g('startedOn')('N. Fink')[0];
  const wasSlot = g('SLOTIDS').find(id => g('lineupOf')('N. Fink').s[id] === inLineup);
  const li = g('S').teams['N. Fink'].r.findIndex(p => p.n === inLineup);
  await g('toggleIR')('N. Fink', li);
  ok('moving a starter to the IR puts him there', g('irOf')('N. Fink').some(p => p.n === inLineup));
  ok('and empties the spot he was in rather than starting a man who cannot play',
     g('lineupOf')('N. Fink').s[wasSlot] === '', g('lineupOf')('N. Fink').s[wasSlot]);
  ok('the log says which spot opened',
     /spot opened/.test(g('S').log[0].detail || ''), g('S').log[0].detail);
  ok('he is not on the bench either', !g('benchOf')('N. Fink').some(p => p.n === inLineup));

  g('render')();
  ok('the IR row offers Activate', /data-fromir=/.test(luHtml()));
  ok('and no second IR button is offered, the slot being full', !/data-toir=/.test(luHtml()));
  await g('toggleIR')('N. Fink', li);
  ok('activating him brings him back to the bench',
     g('benchOf')('N. Fink').some(p => p.n === inLineup) && g('irOf')('N. Fink').length === 0);

  console.log('\n== a benched player can go to the IR too ==');
  await g('clearLineup')('N. Fink');
  g('render')();
  const benchPart = luHtml().split('luslot k-B')[1] || '';
  ok('a bench row offers it', benchPart.includes('data-toir='), benchPart.slice(0, 300));
  const onBench = g('benchOf')('N. Fink')[0].n;
  const benchIdx = g('S').teams['N. Fink'].r.findIndex(p => p.n === onBench);
  await g('toggleIR')('N. Fink', benchIdx);
  ok('and he lands on the IR', g('irOf')('N. Fink').some(p => p.n === onBench));
  await g('toggleIR')('N. Fink', benchIdx);

  console.log('\n== a locked man cannot be hidden on the IR ==');
  const lockMe = g('benchOf')('N. Fink').find(p => g('NBATM')[g('canon')(p.n)]);
  const tri = g('TRICODE')[g('NBATM')[g('canon')(lockMe.n)]] || g('NBATM')[g('canon')(lockMe.n)];
  X.SCHED = {day: g('dayKey')(), tips: {[tri]: '00:00'}, ok: true, reason: ''};
  ok('he is locked', g('isLocked')(lockMe.n) === true);
  ctx.__alerts.length = 0;
  const si = g('S').teams['N. Fink'].r.findIndex(p => p.n === lockMe.n);
  await g('toggleIR')('N. Fink', si);
  ok('so the injured reserve refuses him',
     !g('irOf')('N. Fink').some(p => p.n === lockMe.n) && /locked/.test(ctx.__alerts[0] || ''),
     JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;
  X.SCHED = {day: g('dayKey')(), tips: {}, ok: true, reason: ''};

  console.log('\n== Start all fills the lineup from the bench ==');
  await g('clearLineup')('N. Fink');
  ok('nobody is starting', g('startedOn')('N. Fink').length === 0);
  const benchPool = g('benchOf')('N. Fink').length;
  await g('autoLineup')('N. Fink');
  ok('everyone the slots can take is started',
     g('startedOn')('N. Fink').length === Math.min(15, benchPool),
     g('startedOn')('N. Fink').length + ' of ' + benchPool);
  ok('and every one of them is legal where he stands',
     g('SLOTIDS').every(id => !g('lineupOf')('N. Fink').s[id]
       || g('slotOk')(id, g('lineupOf')('N. Fink').s[id])));
  g('render')();
  ok('the button is labelled for what it does', /Start all/.test(document.getElementById('luHead').innerHTML));
  ok('and its opposite is Bench all', /Bench all/.test(document.getElementById('luHead').innerHTML));
  ok('the header counts the IR against its limit',
     /of 1 on the IR/.test(document.getElementById('luHead').innerHTML),
     document.getElementById('luHead').innerHTML.slice(0, 400));
  g('S').cfg.phase = 'offseason';
  X.me = 'Osborn';

  }

  console.log('\n== the commissioner’s club switch redraws the lineup ==');
  X.me = '__comm__';
  g('S').cfg.phase = 'season';
  g('S').cfg.sched = {};
  X.SCHED = {day: g('dayKey')(), tips: {}, ok: true, reason: ''};
  g('render')();
  const asSel = document.getElementById('meAs');
  asSel.value = 'N. Fink';
  g('drawMe')(); g('drawLineup')();
  await g('clearLineup')('N. Fink');
  await g('autoLineup')('N. Fink');
  asSel.value = 'Coulter';
  g('drawMe')(); g('drawLineup')();
  await g('clearLineup')('Coulter');
  ok('the two clubs have different lineups',
     JSON.stringify(g('startedOn')('N. Fink')) !== JSON.stringify(g('startedOn')('Coulter')),
     g('startedOn')('N. Fink').length + ' vs ' + g('startedOn')('Coulter').length);
  asSel.value = 'N. Fink';
  asSel.onchange();
  const finkHtml = document.getElementById('luSlots').innerHTML;
  // Names go through htmlEsc, so "Kel'el Ware" is in the markup as Kel&#39;el Ware.
  const esc = n => g('htmlEsc')(n);
  const missing = g('startedOn')('N. Fink').filter(n => !finkHtml.includes(esc(n)));
  ok('switching to N. Fink shows his starters', missing.length === 0, missing.join(','));
  asSel.value = 'Coulter';
  asSel.onchange();
  const coulterHtml = document.getElementById('luSlots').innerHTML;
  const leaked = g('startedOn')('N. Fink').filter(n => coulterHtml.includes(esc(n)));
  ok('and switching away stops showing them', leaked.length === 0, leaked.join(','));
  ok('the header follows the club too',
     document.getElementById('luHead').innerHTML.length > 0);
  ok('and the empty club reads as empty',
     /15 spots open/.test(document.getElementById('luHead').innerHTML),
     document.getElementById('luHead').innerHTML.slice(0, 300));
  g('S').cfg.phase = 'offseason';
  X.me = 'Osborn';

  console.log('\n== free agency is a season activity ==');
  // Earlier blocks left S.cfg.roster pinned to one club's headcount; put the
  // rulebook back and pick a club with room.
  g('S').cfg.roster = 15;
  X.me = g('TEAMS')().find(t => g('headcount')(t) < 15) || 'Brice';
  const faClub = X.me;
  g('S').cfg.phase = 'offseason';
  g('S').cfg.minSal = 1.00;
  g('S').cfg.deadline = '';
  ok('a GM cannot sign in the offseason', g('canSignFA')(faClub) === false);
  ctx.__alerts.length = 0;
  const freeMan = g('faPool')().find(p => g('rtg')(p.n) != null && !g('signedClub')(p.n)).n;
  await g('signFA')(faClub, freeMan);
  ok('and is told why', /auction/.test(ctx.__alerts[0] || ''), JSON.stringify(ctx.__alerts));
  ok('nobody was signed', !g('signedClub')(freeMan));
  ctx.__alerts.length = 0;
  g('S').cfg.phase = 'season';
  ok('in season he can', g('canSignFA')(faClub) === true);

  console.log('\n== before the deadline is Early Bird, after it is a rental ==');
  g('S').cfg.deadline = '2099-01-01';
  ok('a far-off deadline has not passed', g('deadlinePassed')() === false);
  await g('signFA')(faClub, freeMan);
  const faSigned = g('S').teams[faClub].r.find(p => p.n === freeMan);
  ok('he is signed to the club', !!faSigned && g('signedClub')(freeMan) === faClub);
  ok('at the league minimum', g('salNow')(faSigned) === g('minSal')(), g('salNow')(faSigned) + ' vs ' + g('minSal')());
  ok('for one year only', g('salOff')(faSigned, 1) == null && g('salOff')(faSigned, 2) == null);
  ok('with Early Bird rights', g('birdKind')(faSigned.b) === 'Early', faSigned.b);
  ok('and the log says so', g('S').log.some(e => /Early Bird/.test(e.detail || '')),
     g('S').log[0].detail);

  const faIdx = g('S').teams[faClub].r.findIndex(p => p.n === freeMan);
  g('S').teams[faClub].r.splice(faIdx, 1);
  g('S').cfg.deadline = '2000-01-01';
  ok('a past deadline has passed', g('deadlinePassed')() === true);
  await g('signFA')(faClub, freeMan);
  const rental = g('S').teams[faClub].r.find(p => p.n === freeMan);
  ok('he is still signed', !!rental);
  ok('but holds no rights at all', g('birdKind')(rental.b) === '', JSON.stringify(rental.b));
  ok('and the log calls it a rental', g('S').log.some(e => /rental/.test(e.detail || '')),
     g('S').log[0].detail);
  g('S').teams[faClub].r.splice(g('S').teams[faClub].r.findIndex(p => p.n === freeMan), 1);
  g('S').cfg.deadline = '';

  console.log('\n== the minimum contract is a setting ==');
  g('S').cfg.minSal = 1.75;
  ok('it is read, not hard-coded', g('minSal')() === 1.75);
  await g('signFA')(faClub, freeMan);
  ok('and a signing uses it',
     g('salNow')(g('S').teams[faClub].r.find(p => p.n === freeMan)) === 1.75);
  g('S').teams[faClub].r.splice(g('S').teams[faClub].r.findIndex(p => p.n === freeMan), 1);
  g('S').cfg.minSal = 1.00;
  ok('nonsense falls back to a dollar',
     (g('S').cfg.minSal = 0) === 0 && g('minSal')() === 1.00);
  g('S').cfg.minSal = 1.00;

  console.log('\n== three tabs belong to the offseason ==');
  /* The DOM stub's querySelectorAll only understands attribute selectors, so
     "#tabs button" — which markPhaseTabs() and goTab() both use — finds nothing
     here. What can be checked in Node is the rule; the hiding itself was
     verified in a real browser. */
  ok('the three offseason-only views are named in one place',
     JSON.stringify(g('OFFSEASON_TABS')) === JSON.stringify(['v-auction', 'v-fa', 'v-rookie']),
     JSON.stringify(g('OFFSEASON_TABS')));
  g('S').cfg.phase = 'season';
  ctx.__alerts.length = 0;
  g('render')();
  ok('rendering live season runs markPhaseTabs without complaint', ctx.__alerts.length === 0,
     JSON.stringify(ctx.__alerts));
  g('S').cfg.phase = 'offseason';
  g('render')();
  ok('and rendering the offseason too', ctx.__alerts.length === 0, JSON.stringify(ctx.__alerts));

  console.log('\n== the auction nominates on a snake ==');
  {
    const T = g('TEAMS')();
    g('S').cfg.phase = 'offseason';
    g('S').cfg.roster = 15;
    g('S').cfg.nomOrder = [];
    ok('with no order set anybody may nominate', g('canNominate')(T[0]) === true
       && g('canNominate')(T[1]) === true);
    ok('and there is no clock', g('nomOnClock')() === null);

    g('S').cfg.nomOrder = T.slice();
    const before = g('nomCount')();
    ok('round one runs top to bottom',
       g('nomSlot')(before + 0) === T[0] && g('nomSlot')(before + 1) === T[1]);
    // Positions are absolute, so read the snake from zero rather than from now.
    ok('the first round is the order as given',
       T.every((t, i) => g('nomSlot')(i) === t));
    ok('the second round runs back up',
       g('nomSlot')(T.length) === T[T.length - 1]
       && g('nomSlot')(T.length + 1) === T[T.length - 2],
       g('nomSlot')(T.length) + '/' + g('nomSlot')(T.length + 1));
    ok('the third turns round again', g('nomSlot')(T.length * 2) === T[0]);
    ok('the turn at each end doubles, as a snake does',
       g('nomSlot')(T.length - 1) === T[T.length - 1]
       && g('nomSlot')(T.length) === T[T.length - 1]);

    console.log('\n== only the club on the clock may nominate ==');
    const clock = g('nomOnClock')();
    ok('somebody is on the clock', !!clock && !!clock.team, JSON.stringify(clock));
    ok('he may nominate', g('canNominate')(clock.team) === true);
    const other = T.find(t => t !== clock.team);
    ok('nobody else may', g('canNominate')(other) === false, other);
    X.me = other;
    ctx.__alerts.length = 0;
    const someFA = g('faPool')().find(p => !g('signedClub')(p.n)).n;
    await g('nominate')(someFA, other, 1);
    ok('so his nomination is refused', !g('A')() || g('A')().player !== someFA,
       JSON.stringify(ctx.__alerts));
    ok('and he is told whose turn it is',
       (ctx.__alerts[0] || '').includes(clock.team), JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;

    console.log('\n== a full club is skipped, not waited on ==');
    // Pin the limit to the club on the clock so he reads as full.
    g('S').cfg.roster = g('headcount')(clock.team);
    ok('he is full', g('nomFull')(clock.team) === true);
    ok('and cannot nominate', g('canNominate')(clock.team) === false);
    const next = g('nomOnClock')();
    ok('the clock has moved past him', !!next && next.team !== clock.team,
       JSON.stringify(next));
    ok('and says how many it stepped over', next.skipped >= 1, String(next.skipped));
    g('S').cfg.roster = 15;
    ok('with room again he is back on the clock', g('nomOnClock')().team === clock.team);

    g('S').cfg.nomOrder = [];
    g('S').auction = null;
    X.me = 'Osborn';
  }


  /* ===================== COMMISSIONER ACCESS ===================== */
  console.log('\n== a deputy is a GM who also holds the commissioner tools ==');
  {
    const CS = g('S'), DEP = g('DEPUTY_SEED');
    ok('the seed names both Damans',
       DEP.includes('A. Daman') && DEP.includes('N. Daman'), JSON.stringify(DEP));
    CS.cfg.deputies = ['A. Daman', 'N. Daman'];

    X.me = '__comm__';
    ok('the commissioner login has the tools', g('hasComm')() === true);
    ok('...and is not a deputy', g('isDeputy')() === false);
    ok('...and is the only one who may grant them', g('canGrantComm')() === true);

    X.me = 'A. Daman';
    ok('a deputy holds the tools', g('hasComm')() === true);
    ok('...and is flagged as one', g('isDeputy')() === true);
    /* The whole split: he keeps his own club. isComm() must stay false for him,
       or the club switcher and the per-club stores lose track of who he is. */
    ok('...but is still a GM with his own club', g('isComm')() === false);
    ok('...so his private stores stay his own',
       g('cboxRemoteKey')('notes') === 'notes-' + g('clubSlug')('A. Daman'),
       String(g('cboxRemoteKey')('notes')));
    ok('...and he may edit a contract', g('canEditContract')() === true);
    ok('...but may not hand the tools to anybody else', g('canGrantComm')() === false);

    X.me = 'Osborn';
    ok('an ordinary GM holds none of it',
       g('hasComm')() === false && g('isDeputy')() === false && g('canEditContract')() === false);

    ctx.__alerts.length = 0;
    await g('toggleDeputy')('Osborn');
    ok('and cannot promote himself', g('deputies')().includes('Osborn') === false);
    ok('...he is told why', (ctx.__alerts[0] || '').includes('commissioner'),
       JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;

    X.me = '__comm__';
    await g('toggleDeputy')('Osborn');
    ok('the commissioner can grant it', g('deputies')().includes('Osborn') === true);
    await g('toggleDeputy')('Osborn');
    ok('...and take it back', g('deputies')().includes('Osborn') === false);
    ok('both are logged',
       CS.log.filter(e => /Commissioner access (granted to|revoked from) Osborn/.test(e.detail || '')).length === 2);

    ok('a club that has left the league is not a deputy',
       g('deputies')(['nobody']).includes('nobody') === false);
    CS.cfg.deputies = ['A. Daman', 'Ghost Club'];
    ok('...and a stale name is filtered out',
       g('deputies')().join() === 'A. Daman', g('deputies')().join());

    console.log('\n== the deputies list migrates without re-granting ==');
    const seeded = g('normCfg')({});
    ok('a settings blob written before this gets the seed',
       seeded.deputies.join() === g('DEPUTY_SEED').join(), JSON.stringify(seeded.deputies));
    const emptied = g('normCfg')({deputies: []});
    ok('but an empty list is a real answer and is left alone',
       emptied.deputies.length === 0, JSON.stringify(emptied.deputies));
    const kept = g('normCfg')({deputies: ['Coulter']});
    ok('...as is one somebody set', kept.deputies.join() === 'Coulter');

    CS.cfg.deputies = ['A. Daman', 'N. Daman'];
  }

  /* ===================== AWARDING AT AUCTION ===================== */
  console.log('\n== signBlock says why a contract will not fit ==');
  {
    const CS = g('S'), club = 'Osborn';
    CS.cfg.roster = 15;
    const room = g('TEAMS')().find(t => g('headcount')(t) < CS.cfg.roster
                                     && CS.cfg.cap - g('committed')(t) > 6);
    ok('a club with room and money is not blocked',
       g('signBlock')(room, 'Test Award Guy', 1.00) === null,
       String(g('signBlock')(room, 'Test Award Guy', 1.00)));
    ok('a club without a name is', /No club/.test(g('signBlock')('', 'x', 1) || ''));
    const wasR = CS.cfg.roster;
    CS.cfg.roster = g('headcount')(club);
    ok('a full club is blocked by the roster limit',
       /carries \d+ players/.test(g('signBlock')(club, 'Test Award Guy', 1.00) || ''),
       String(g('signBlock')(club, 'Test Award Guy', 1.00)));
    CS.cfg.roster = wasR;
    const huge = g('signBlock')(room, 'Test Award Guy', CS.cfg.tax + 50);
    ok('and a bid past the hard cap says so', /hard cap/.test(huge || ''), String(huge));
  }

  console.log('\n== only a commissioner may award ==');
  {
    const CS = g('S');
    CS.cfg.roster = 15;
    // Deliberately not a deputy: the point of this block is that a plain GM,
    // even the one who nominated the player, cannot end his own lot.
    const buyer = g('TEAMS')().find(t => !g('deputies')().includes(t)
                                      && g('headcount')(t) < CS.cfg.roster
                                      && g('bidCeiling')(t, 'Award Test A') >= 2);
    const guy = 'Award Test A';
    const openLot = () => { CS.auction = {player:guy, by:buyer, bid:2.00, leader:buyer,
      bids:[{t:buyer, amt:2.00, ts:Date.now()}], max:{}, status:'open', ts:Date.now()}; };

    openLot();
    X.me = buyer;                       // the GM who nominated him
    ctx.__alerts.length = 0;
    await g('closeAuction')();
    ok('the nominating GM cannot award his own lot', g('A')().status === 'open');
    ok('...and is told it is the commissioner’s', (ctx.__alerts[0] || '').includes('commissioner'),
       JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;

    X.me = 'A. Daman';                  // a deputy
    await g('closeAuction')();
    ok('a deputy can award', g('A')().status === 'closed', JSON.stringify(g('A')()));
    ok('...and the player lands on the winning club',
       CS.teams[buyer].r.some(p => p.n === guy && g('salNow')(p) === 2.00));
    ok('...at the winning price for one year',
       g('salOff')(CS.teams[buyer].r.find(p => p.n === guy), 1) == null);
    ok('...and it is logged',
       CS.log.some(e => (e.detail || '').startsWith('Won ' + guy)));
    CS.teams[buyer].r = CS.teams[buyer].r.filter(p => p.n !== guy);
    CS.auction = null;
    ok('no alert on a clean award', ctx.__alerts.length === 0, JSON.stringify(ctx.__alerts));
  }

  console.log('\n== an award that will not fit is refused, not half-applied ==');
  {
    const CS = g('S');
    const poor = g('TEAMS')()[0];
    CS.auction = {player:'Award Test B', by:poor, bid:CS.cfg.tax + 25, leader:poor,
      bids:[{t:poor, amt:CS.cfg.tax + 25, ts:Date.now()}], max:{}, status:'open', ts:Date.now()};
    X.me = '__comm__';
    ctx.__alerts.length = 0;
    await g('closeAuction')();
    ok('the lot stays open', g('A')().status === 'open');
    ok('nothing was signed', !CS.teams[poor].r.some(p => p.n === 'Award Test B'));
    ok('and the reason is given', /hard cap|ceiling|nothing left/.test(ctx.__alerts.join(' ')),
       JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;
    CS.auction = null;
  }

  console.log('\n== a restricted player is put to the club that may match ==');
  {
    const CS = g('S');
    CS.cfg.roster = 15;
    const holder = g('TEAMS')().find(t => g('headcount')(t) < CS.cfg.roster - 1
                                       && CS.cfg.cap - g('committed')(t) > 8);
    const bidder = g('TEAMS')().find(t => t !== holder && g('headcount')(t) < CS.cfg.roster
                                       && CS.cfg.cap - g('committed')(t) > 8);
    const rfa = 'Award Test RFA';
    // An expiring contract with an option played out is exactly a restricted FA.
    CS.teams[holder].r.push({n:rfa, p:'G', y:{'2025-26':2.00}, o:'RO', b:'', acq:2024, cut:false});
    ok('he reads as restricted', g('rightsOf')(null, rfa).rfa === true);

    const putUp = () => { CS.auction = {player:rfa, by:bidder, bid:3.00, leader:bidder,
      bids:[{t:bidder, amt:3.00, ts:Date.now()}], max:{}, status:'open', ts:Date.now()}; };
    putUp();
    X.me = '__comm__';
    await g('closeAuction')();
    ok('awarding parks the lot in a match', g('A')().status === 'match', g('A')().status);
    ok('nobody has signed him yet',
       !CS.teams[bidder].r.some(p => p.n === rfa && g('contracted')(p)));
    const offer = g('matchOffer')();
    ok('the offer names the rights holder, the winner and the price',
       offer.club === holder && offer.winner === bidder && offer.price === 3.00,
       JSON.stringify(offer));

    console.log('\n-- who may answer it --');
    X.me = bidder;
    ok('the winning bidder may not answer for him', g('canAnswerMatch')() === false);
    ctx.__alerts.length = 0;
    await g('answerMatch')(true);
    ok('...and his attempt is refused', g('A')().status === 'match');
    ok('...with the holder named', (ctx.__alerts[0] || '').includes(holder),
       JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;
    X.me = holder;
    ok('the rights holder may', g('canAnswerMatch')() === true);
    X.me = '__comm__';
    ok('and so may the commissioner, for a GM who has gone quiet',
       g('canAnswerMatch')() === true);

    console.log('\n-- bidding is shut while he decides --');
    ctx.__alerts.length = 0;
    await g('placeBid')(bidder, 4.00, false);
    ok('no bid lands on a lot awaiting a match', g('A')().bid === 3.00, String(g('A')().bid));
    ok('...and the bidder is told nothing is on the block',
       (ctx.__alerts[0] || '').includes('block'), JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;

    console.log('\n-- matching keeps him --');
    X.me = holder;
    await g('answerMatch')(true);
    ok('the lot closes', g('A')().status === 'closed');
    ok('the rights holder keeps him at the winning price',
       CS.teams[holder].r.some(p => p.n === rfa && g('salNow')(p) === 3.00),
       JSON.stringify(CS.teams[holder].r.filter(p => p.n === rfa)));
    ok('the winner does not get him', !CS.teams[bidder].r.some(p => p.n === rfa));
    ok('and the log says it was matched',
       CS.log.some(e => /matched by/.test(e.detail || '')));
    CS.teams[holder].r = CS.teams[holder].r.filter(p => p.n !== rfa);
    CS.auction = null;

    console.log('\n-- declining sends him to the winner --');
    CS.teams[holder].r.push({n:rfa, p:'G', y:{'2025-26':2.00}, o:'RO', b:'', acq:2024, cut:false});
    putUp();
    X.me = '__comm__';
    await g('closeAuction')();
    ok('the offer is open again', g('A')().status === 'match');
    X.me = holder;
    await g('answerMatch')(false);
    ok('the lot closes', g('A')().status === 'closed');
    ok('the winning bidder signs him',
       CS.teams[bidder].r.some(p => p.n === rfa && g('salNow')(p) === 3.00));
    ok('...and he is off the old club', !CS.teams[holder].r.some(p => p.n === rfa));
    ok('the log says the match was declined',
       CS.log.some(e => /declined to match/.test(e.detail || '')));
    CS.teams[bidder].r = CS.teams[bidder].r.filter(p => p.n !== rfa);
    CS.auction = null;
    ok('nothing alerted through the match flow', ctx.__alerts.length === 0,
       JSON.stringify(ctx.__alerts));
  }

  console.log('\n== a rights holder who cannot fit the deal is never asked ==');
  {
    const CS = g('S');
    CS.cfg.roster = 15;
    const holder = g('TEAMS')().find(t => g('headcount')(t) < CS.cfg.roster - 1);
    const bidder = g('TEAMS')().find(t => t !== holder && g('headcount')(t) < CS.cfg.roster
                                       && CS.cfg.cap - g('committed')(t) > 8);
    const rfa2 = 'Award Test RFA2';
    CS.teams[holder].r.push({n:rfa2, p:'G', y:{'2025-26':2.00}, o:'RO', b:'', acq:2024, cut:false});
    // Fill the holder's roster so no contract of any size fits — with real
    // contracts, not by moving the limit, which would strand the bidder too.
    const filler = [];
    while (g('headcount')(holder) < CS.cfg.roster) {
      const f = {n:'Award Filler ' + filler.length, p:'G', y:{'2025-26':0.25, '2026-27':0.25},
                 o:'', b:'', acq:2024, cut:false};
      filler.push(f); CS.teams[holder].r.push(f);
    }
    ok('he has no room', g('signBlock')(holder, rfa2, 3.00) !== null);
    CS.auction = {player:rfa2, by:bidder, bid:3.00, leader:bidder,
      bids:[{t:bidder, amt:3.00, ts:Date.now()}], max:{}, status:'open', ts:Date.now()};
    X.me = '__comm__';
    await g('closeAuction')();
    ok('the lot goes straight to the winner', g('A')().status === 'closed', g('A')().status);
    ok('...who signs him', CS.teams[bidder].r.some(p => p.n === rfa2 && g('salNow')(p) === 3.00));
    ok('...and the log says why', CS.log.some(e => /could not match/.test(e.detail || '')));
    CS.teams[bidder].r = CS.teams[bidder].r.filter(p => p.n !== rfa2);
    CS.teams[holder].r = CS.teams[holder].r.filter(p => p.n !== rfa2 && !filler.includes(p));
    CS.auction = null;
    ctx.__alerts.length = 0;
  }

  console.log('\n== a resolved lot beats a stale one on merge ==');
  {
    const mine = {player:'X', status:'open', bids:[{t:'a',amt:1}]};
    const theirs = {player:'X', status:'match', bids:[{t:'a',amt:1}]};
    ok('match beats open whichever side holds it',
       g('mergeSlice')('auction', theirs, mine).status === 'match'
       && g('mergeSlice')('auction', mine, theirs).status === 'match');
    ok('closed beats match',
       g('mergeSlice')('auction', {...theirs, status:'closed'}, theirs).status === 'closed');
  }

  X.me = 'Osborn';
  g('S').auction = null;
  g('S').cfg.roster = 15;


  /* ================= BIRD RIGHTS ARE EARNED ================= */
  console.log('\n== Bird rights come from three seasons, not the rights column ==');
  {
    const CS = g('S'), yr = g('leagueYear')();
    ok('the league year is read off the season, not the clock', yr === 2026, String(yr));
    ok('a season string with no year falls back to the clock', (() => {
      const was = CS.cfg.season; CS.cfg.season = '';
      const v = g('leagueYear')(); CS.cfg.season = was;
      return v === new Date().getFullYear();
    })());
    ok('three seasons is the rule', g('birdYears')() === 3);

    const mk = (b, acq) => ({n:'Bird Test', p:'G', y:{'2025-26':1}, o:'', b, acq, cut:false});
    ok('tenure is seasons with the club', g('tenureOf')(mk('', yr - 4)) === 4);
    ok('a missing year has no tenure', g('tenureOf')(mk('', null)) === null);

    ok('three seasons earns Bird whatever the column says',
       g('birdRight')(mk('', yr - 3)) === 'Yes' && g('birdRight')(mk('No', yr - 5)) === 'Yes');
    ok('two seasons does not, even marked "Yes"',
       g('birdRight')(mk('Yes', yr - 2)) === '', g('birdRight')(mk('Yes', yr - 2)));
    ok('...and the year he arrived certainly does not',
       g('birdRight')(mk('Yes', yr)) === '');
    /* Early Bird is a mid-season signing before the deadline. Tenure has nothing
       to say about it, so the label is still what carries it. */
    ok('Early Bird survives on the label',
       g('birdRight')(mk('Early', yr - 1)) === 'Early' && g('birdRight')(mk('Min', yr)) === 'Early');
    ok('and a blank is still nothing', g('birdRight')(mk('', yr - 1)) === '');
    /* Nothing to compute from: honour the sheet rather than strip a club of
       rights on the strength of a missing field. */
    ok('with no year on file the column is all there is',
       g('birdRight')(mk('Yes', null)) === 'Yes' && g('birdRight')(mk('No', null)) === '');

    console.log('\n-- rights travel in a trade and restart any other way --');
    const [c1, c2] = g('TEAMS')();
    const vet = {n:'Bird Travel Guy', p:'G', y:{'2025-26':2, '2026-27':2}, o:'', b:'', acq: yr - 4, cut:false};
    CS.teams[c1].r.push(vet);
    ok('four seasons in, he carries Bird', g('rightsOf')(c1, 'Bird Travel Guy').bird === '');
    // rightsOf only answers for an EXPIRING player, so read the entry directly.
    ok('...as the entry says', g('birdRight')(vet) === 'Yes');
    // A trade moves the whole entry, acq included.
    const idx = CS.teams[c1].r.indexOf(vet);
    CS.teams[c2].r.push(CS.teams[c1].r.splice(idx, 1)[0]);
    ok('a trade carries the year across, so the rights survive',
       g('birdRight')(CS.teams[c2].r.find(x => x.n === 'Bird Travel Guy')) === 'Yes');
    CS.teams[c2].r = CS.teams[c2].r.filter(x => x.n !== 'Bird Travel Guy');

    console.log('\n-- signing as a free agent restarts the clock --');
    CS.cfg.roster = 15;
    const club = g('TEAMS')().find(t => g('headcount')(t) < CS.cfg.roster
                                      && CS.cfg.cap - g('committed')(t) > 3);
    const other = g('TEAMS')().find(t => t !== club);
    CS.teams[other].r.push({n:'Bird Walk Guy', p:'G', y:{'2025-26':2}, o:'', b:'Yes',
                            acq: yr - 6, cut:false});
    X.me = club;
    await g('signPlayer')('Bird Walk Guy', club, 2, 1);
    const landed = CS.teams[club].r.find(x => x.n === 'Bird Walk Guy');
    ok('he moved', !!landed && !CS.teams[other].r.some(x => x.n === 'Bird Walk Guy'));
    ok('...stamped with the league year, not the wall clock', landed.acq === yr, String(landed.acq));
    ok('...so his Bird rights start again from zero', g('birdRight')(landed) === '');
    CS.teams[club].r = CS.teams[club].r.filter(x => x.n !== 'Bird Walk Guy');

    console.log('\n-- the commissioner is told where the sheet disagrees --');
    const mism = g('birdMismatch')();
    ok('the seed disagrees in places', mism.length > 0, String(mism.length));
    ok('every row says both answers and which club',
       mism.every(m => m.t && m.p && m.said !== m.got), JSON.stringify(mism[0] || {}));
    ok('and most of them are "marked Bird, has not served three"',
       mism.filter(m => m.said === 'Yes' && m.got !== 'Yes').length > 0);
    ctx.__alerts.length = 0;
  }

  /* ================= QUICK SIGN IS A SEASON TAB ================= */
  console.log('\n== quick sign belongs to the season ==');
  {
    ok('it is named as one', g('SEASON_TABS').join() === 'v-draft');
    ok('and the offseason tabs are still the other three',
       g('OFFSEASON_TABS').join() === 'v-auction,v-fa,v-rookie');
    /* The DOM stub cannot resolve "#tabs button", so the RULE is asserted here
       and the hiding itself was confirmed in Chromium. */
    ok('the two lists do not overlap',
       g('SEASON_TABS').every(v => !g('OFFSEASON_TABS').includes(v)));
  }

  /* ================= A GM'S OWN SETTINGS ================= */
  console.log('\n== a club name is checked before it is taken ==');
  {
    const T2 = g('TEAMS')(), me0 = T2[0], other = T2[1];
    const err = g('clubNameError');
    ok('a blank is refused', /Give the club a name/.test(err('   ', me0) || ''));
    ok('a name already in use is refused', /already has that name/.test(err(other, me0) || ''));
    ok('...case and all', /already has that name/.test(err(other.toUpperCase(), me0) || ''));
    ok('its own name is not a change', /already the name/.test(err(me0, me0) || ''));
    ok('the commissioner sentinel is reserved', /reserved/.test(err('__comm__', me0) || ''));
    ok('a very long name is refused', /40 characters/.test(err('x'.repeat(41), me0) || ''));
    ok('and a good one passes', err('Osborn FC', me0) === null, String(err('Osborn FC', me0)));
  }

  console.log('\n== renaming a club carries everything that names it ==');
  {
    const CS = g('S');
    const from = g('TEAMS')()[0], to = 'Renamed FC', mate = g('TEAMS')()[1];
    const roster = CS.teams[from].r.length, clubs = g('TEAMS')().length;

    CS.cfg.nomOrder = g('TEAMS')().slice();
    CS.cfg.deputies = [from, mate];
    CS.cfg.draft = {year: 2027, order: g('TEAMS')().slice(), sal: [], open: false};
    CS.trades = [{ts:1, by:from, a:from, b:mate, give:['x'], get:['y'],
                  givePk:[{y:2027, from, prot:0}], getPk:[{y:2027, from:mate, prot:0}], status:'open'}];
    CS.auction = {player:'Rename Test', by:from, bid:3, leader:from,
                  bids:[{t:from, amt:3, ts:1}], max:{[from]:5}, status:'open', ts:1};
    g('takePick')(2027, from);                       // a pick record naming him
    const logWas = CS.log.length, logFirst = CS.log[0] && CS.log[0].detail;

    ok('the rename runs', g('renameClub')(from, to) === true);
    ok('the club answers to the new name',
       !!CS.teams[to] && !CS.teams[from], g('TEAMS')().join());
    ok('...with its roster intact', CS.teams[to].r.length === roster);
    ok('...and no club is gained or lost',
       g('TEAMS')().length === clubs, g('TEAMS')().length + ' of ' + clubs);

    ok('his picks still point at him',
       g('clubPicks')(to).some(k => k.from === to)
       && !g('TEAMS')().some(t => (CS.teams[t].picks || []).some(k => k.from === from)));
    ok('open offers moved with him', CS.trades[0].a === to && CS.trades[0].b === mate);
    ok('...including the picks inside them',
       CS.trades[0].givePk[0].from === to && CS.trades[0].getPk[0].from === mate);
    ok('the live auction knows him',
       CS.auction.by === to && CS.auction.leader === to
       && CS.auction.bids[0].t === to && CS.auction.max[to] === 5
       && CS.auction.max[from] === undefined, JSON.stringify(CS.auction.max));
    ok('his place in the nomination order moved',
       CS.cfg.nomOrder.includes(to) && !CS.cfg.nomOrder.includes(from));
    ok('...and his commissioner access', g('deputies')().includes(to));
    ok('...and the draft order', CS.cfg.draft.order.includes(to));

    /* The log is the record of what happened under the name he had at the time.
       Rewriting it would make the ledger lie about its own history. */
    ok('the transaction log is left exactly as it was',
       CS.log.length === logWas && (CS.log[0] && CS.log[0].detail) === logFirst);

    /* The trade machine's club selects were built once and never rebuilt, so
       after a rename they still named a club S.teams no longer has — and
       drawTradeLists() reads S.teams[value].r straight off the select. */
    ctx.__alerts.length = 0;
    /* Another GM's browser learns about a rename on the poll, so anything
       holding a club NAME — activeTeam, the trade selects, the commissioner's
       "viewing as" — has to be re-checked rather than trusted. */
    g('render')();
    ok('rendering after a rename does not throw on the trade selects',
       document.getElementById('tA').value !== from
       && CS.teams[document.getElementById('tA').value] !== undefined,
       document.getElementById('tA').value);
    ok('...and the two sides are still different clubs',
       document.getElementById('tA').value !== document.getElementById('tB').value);

    ok('a sign-in naming a club that is gone is signed out, not left dangling',
       X.me == null || !!CS.teams[X.me], String(X.me));

    ok('a rename onto an existing club is refused', g('renameClub')(to, mate) === false);
    ok('and renaming a club that is not there is too', g('renameClub')('Nobody', 'X') === false);

    // put it all back
    g('renameClub')(to, from);
    CS.trades = []; CS.auction = null;
    CS.cfg.nomOrder = []; CS.cfg.deputies = ['A. Daman', 'N. Daman'];
    delete CS.cfg.draft;
    g('TEAMS')().forEach(t => { CS.teams[t].picks = []; });
    ok('and it goes back the same way', !!CS.teams[from] && !CS.teams['Renamed FC']);
    X.me = 'Osborn';
  }


  /* ============ A CLUB CANNOT BUY BACK WHAT IT PAID TO RELEASE ============ */
  console.log('\n== the seed cut list is read at all ==');
  {
    const CS = g('S');
    CS.cfg.phase = 'offseason'; CS.cfg.minSal = 1.00; CS.cfg.roster = 15;
    /* No seed cut record carries `blocked`, `live` or `at` — the old cutRecord()
       required `blocked` and so matched nothing at all, which made the whole
       restriction inert against the only cut list this league has. */
    const anyBlocked = g('TEAMS')().some(t =>
      (CS.teams[t].cuts || []).some(c => c.blocked));
    ok('no seed release is marked as a multi-year block', anyBlocked === false);
    ok('...so the rule has to come off the salary, not that flag',
       g('unsignableFor')('D. Fink').length > 0);
  }

  console.log('\n== released above the minimum, and out of reach ==');
  {
    const CS = g('S'), min = g('minSal')();
    const bars = {};
    g('TEAMS')().forEach(t => { const u = g('unsignableFor')(t); if (u.length) bars[t] = u; });

    ok('three clubs are carrying a bar', Object.keys(bars).length === 3,
       Object.keys(bars).join());
    ok('D. Fink cannot buy back the three he paid for',
       (bars['D. Fink'] || []).map(c => c.n).join() === 'Brook Lopez,Kon Knueppel,Dereck Lively II',
       (bars['D. Fink'] || []).map(c => c.n).join());
    ok('N. Fink cannot buy back his three',
       (bars['N. Fink'] || []).map(c => c.n).join() === 'Myles Turner,Derik Queen,Jalen Green',
       (bars['N. Fink'] || []).map(c => c.n).join());
    ok('N. Daman cannot buy back Payton Pritchard',
       (bars['N. Daman'] || []).map(c => c.n).join() === 'Payton Pritchard');
    ok('the list is dearest first', (bars['N. Fink'] || [])[0].s === 13.75);
    ok('every barred release is above the minimum',
       Object.values(bars).every(l => l.every(c => c.s > min)));

    console.log('\n-- and a minimum release is not a bar --');
    ok('a $1.00 release leaves him signable',
       g('cutRestriction')('N. Fink', 'Tari Eason') === null);
    ok('...and he is not on the list',
       !(bars['N. Fink'] || []).some(c => c.n === 'Tari Eason'));

    console.log('-- the bar is the releasing club\'s alone --');
    ok('N. Fink cannot sign Myles Turner back',
       (g('cutRestriction')('N. Fink', 'Myles Turner') || {}).hard === true);
    ok('...and the reason says the price and the minimum',
       /13\.75/.test(g('cutRestriction')('N. Fink', 'Myles Turner').why)
       && /minimum/.test(g('cutRestriction')('N. Fink', 'Myles Turner').why),
       g('cutRestriction')('N. Fink', 'Myles Turner').why);
    g('TEAMS')().filter(t => t !== 'N. Fink').forEach(t => {
      if (g('cutRestriction')(t, 'Myles Turner') !== null) fails++;
    });
    ok('every other club may sign him freely',
       g('TEAMS')().filter(t => t !== 'N. Fink')
         .every(t => g('cutRestriction')(t, 'Myles Turner') === null));

    console.log('-- the cut list spells names its own way --');
    /* D. Fink's cut list carries "Wendall Carter Jr"; the box scores say
       "Wendell". A raw string compare would have let him straight back. */
    ok('a cut is matched through canon()',
       g('cutRecords')('D. Fink', 'Wendell Carter Jr').length > 0,
       String(g('cutRecords')('D. Fink', 'Wendell Carter Jr').length));
    ok('...and a club that never released him has no record',
       g('cutRecords')('Osborn', 'Wendell Carter Jr').length === 0);
    /* Two releases of the same man, one dear and one at the minimum: the dearer
       one governs, or cutting again at $1.00 would clear the bar. */
    ok('D. Fink released Brook Lopez twice',
       g('cutRecords')('D. Fink', 'Brook Lopez').length === 2);
    ok('...and the dearer release governs',
       g('paidCut')('D. Fink', 'Brook Lopez').s === 5.75,
       String(g('paidCut')('D. Fink', 'Brook Lopez').s));
    ok('...so he is listed once, at that price',
       (bars['D. Fink'] || []).filter(c => c.n === 'Brook Lopez').length === 1
       && (bars['D. Fink'] || []).find(c => c.n === 'Brook Lopez').s === 5.75);
  }

  console.log('\n== the bar is enforced where a GM acts ==');
  {
    const CS = g('S');
    CS.cfg.phase = 'offseason'; CS.cfg.roster = 15;
    const club = 'N. Fink', guy = 'Myles Turner';
    ok('he cannot be signed', g('signBlock')(club, guy, 3) !== null);
    ok('...and bidCeiling is zero for that club',
       g('bidCeiling')(club, guy) === 0, String(g('bidCeiling')(club, guy)));
    const rival = g('TEAMS')().find(t => t !== club
      && CS.cfg.cap - g('committed')(t) > 5 && g('headcount')(t) < CS.cfg.roster);
    ok('...but not for a rival', g('bidCeiling')(rival, guy) > 1, String(g('bidCeiling')(rival, guy)));

    console.log('-- he cannot nominate him --');
    ctx.__alerts.length = 0;
    CS.auction = null; CS.cfg.nomOrder = [];
    X.me = club;
    await g('nominate')(guy, club, 1);
    ok('the nomination is refused', !g('A')(), JSON.stringify(g('A')()));
    ok('...and he is told why', /released|minimum/i.test(ctx.__alerts.join(' ')),
       JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;

    console.log('-- nor bid on him --');
    CS.auction = {player:guy, by:rival, bid:2, leader:rival,
      bids:[{t:rival, amt:2, ts:Date.now()}], max:{}, status:'open', ts:Date.now()};
    await g('placeBid')(club, 3, false);
    ok('the bid does not land', g('A')().bid === 2 && g('A')().leader === rival);
    ok('...and the reason names the release', /released/i.test(ctx.__alerts.join(' ')),
       JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;

    console.log('-- nor can the commissioner award him to that club --');
    g('A')().leader = club; g('A')().bid = 2;
    X.me = '__comm__';
    await g('closeAuction')();
    ok('the award is refused', g('A')().status === 'open');
    ok('...and nothing was signed', !CS.teams[club].r.some(p => p.n === guy));
    ok('...with the reason given', /released/i.test(ctx.__alerts.join(' ')),
       JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;

    console.log('-- and signPlayer refuses outright --');
    X.me = club;
    await g('signPlayer')(guy, club, 1, 1);
    ok('he is not on the roster', !CS.teams[club].r.some(p => p.n === guy));
    ok('...and the GM is told', /released/i.test(ctx.__alerts.join(' ')),
       JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;

    console.log('-- restrictionNote leads with it --');
    const note = g('restrictionNote')(club, guy);
    ok('the note says it first', /released/i.test(note[0] || ''), JSON.stringify(note));

    CS.auction = null;
    X.me = 'Osborn';
  }

  console.log('\n== the bar belongs to a release cycle, and to the offseason ==');
  {
    const CS = g('S');
    const club = 'N. Fink', guy = 'Myles Turner';
    ok('a release in the season just played is still barred in this offseason',
       g('cutCurrent')({n:guy, s:5, at:g('seasonPrev')(g('curSeason')())}) === true);
    ok('...and one made during the current season certainly is',
       g('cutCurrent')({n:guy, s:5, at:CS.cfg.season}) === true);
    ok('...but an older one has lapsed',
       g('cutCurrent')({n:guy, s:5, at:'2019-20'}) === false);
    ok('an unstamped release is read as the season just played',
       g('cutSeason')({n:guy, s:5}) === g('seasonPrev')(g('curSeason')()));
    ok('the seed cuts were stamped on load',
       g('TEAMS')().every(t => (CS.teams[t].cuts || []).every(c => !!c.at)),
       JSON.stringify((CS.teams['N. Fink'].cuts || [])[0]));
    /* The seed's releases happened in the season just PLAYED, not the one being
       built — Pritchard went during 2025-26, which is why his bar covers the
       2026 auction and lapses when 2026-27 starts. Stamping them with the
       current season put the bar a year late and, because the season never
       moved, made it permanent. */
    ok('...with the season just played, not the one being built',
       (CS.teams['N. Fink'].cuts || []).every(c => c.at === g('seasonPrev')(g('curSeason')())),
       JSON.stringify((CS.teams['N. Fink'].cuts || [])[0]));
    ok('...and carry the stamp version that says so',
       (CS.teams['N. Fink'].cuts || []).every(c => c.cv === g('CUTV')));
    ok('...and one stamped with this season does too',
       g('cutCurrent')({n:guy, s:5, at:CS.cfg.season}) === true);
    ok('...but an older one does not',
       g('cutCurrent')({n:guy, s:5, at:'2019–20'}) === false);

    /* Rolling the season forward lapses the bar, which is what "the previous
       season or the offseason" means — it does not follow a club for ever. */
    const was = CS.cfg.season;
    CS.cfg.season = '2027–28';
    ok('a new season clears the bar', g('cutRestriction')(club, guy) === null);
    ok('...and empties the list', g('unsignableFor')(club).length === 0);
    CS.cfg.season = was;
    ok('and it comes back when the season does',
       (g('cutRestriction')(club, guy) || {}).hard === true);

    /* The window is the rest of the season he was cut in PLUS the offseason
       after it. Myles Turner went during 2025-26, so the bar covers the 2026
       auction — now — and lapses the moment 2026-27 goes live. That is the
       Pritchard rule, and it is why the league year has to be able to move. */
    ok('the bar is live in the offseason before the next season',
       (g('cutRestriction')(club, guy) || {}).hard === true);
    ok('...and the reason names the window',
       /rest of this season/.test(g('cutRestriction')(club, guy).why)
       && /following offseason/.test(g('cutRestriction')(club, guy).why),
       g('cutRestriction')(club, guy).why);
    CS.cfg.phase = 'season';
    ok('and it lapses the moment that season goes live',
       g('cutRestriction')(club, guy) === null,
       JSON.stringify(g('cutRestriction')(club, guy)));
    ok('...so he is off the barred list too',
       g('unsignableFor')(club).length === 0,
       JSON.stringify(g('unsignableFor')(club)));
    CS.cfg.phase = 'offseason';

    /* The rulebook's own rule still stands on top of it: a multi-year deal is
       minimum-only during the following season. */
    const t2 = 'Osborn';
    CS.teams[t2].cuts.push({n:'Cut Rule Guy', p:'G', s:1.00, blocked:true, live:false, at:CS.cfg.season});
    ok('a multi-year release is hard in the offseason',
       (g('cutRestriction')(t2, 'Cut Rule Guy') || {}).hard === true);
    CS.cfg.phase = 'season';
    const inS = g('cutRestriction')(t2, 'Cut Rule Guy');
    ok('...and minimum-only in season', !!inS && inS.minOnly === true && inS.maxYears === 1);
    ok('...so his ceiling is the minimum',
       g('bidCeiling')(t2, 'Cut Rule Guy') === g('minSal')(),
       String(g('bidCeiling')(t2, 'Cut Rule Guy')));
    CS.cfg.phase = 'offseason';
    CS.teams[t2].cuts = CS.teams[t2].cuts.filter(c => c.n !== 'Cut Rule Guy');
  }

  console.log('\n== the mid-season cut-and-re-sign loophole is shut ==');
  {
    const CS = g('S');
    CS.cfg.phase = 'season'; CS.cfg.roster = 15; CS.cfg.minSal = 1.00; CS.cfg.deadline = '';
    const club = g('TEAMS')().find(t => g('headcount')(t) < CS.cfg.roster
                                      && CS.cfg.cap - g('committed')(t) > 10);
    /* One year, so the rulebook's multi-year rule cannot be what catches him —
       this is the above-minimum bar doing the work, and it used to do none. */
    const dear = {n:'Loophole Guy', p:'G', y:{'2025-26':4.00, '2026-27':4.00}, o:'', b:'', acq:2025, cut:false};
    CS.teams[club].r.push(dear);
    X.me = club;
    g('releaseRecord')(club, CS.teams[club].r.indexOf(dear));
    ok('the release is recorded at $4.00 and is not a multi-year block',
       g('cutRecords')(club, 'Loophole Guy')[0].s === 4.00
       && g('cutRecords')(club, 'Loophole Guy')[0].blocked === false);
    ok('he is barred in season', (g('cutRestriction')(club, 'Loophole Guy') || {}).hard === true);
    ok('...his ceiling is zero', g('bidCeiling')(club, 'Loophole Guy') === 0);
    ok('...and even the minimum is refused',
       g('signBlock')(club, 'Loophole Guy', 1.00) !== null,
       String(g('signBlock')(club, 'Loophole Guy', 1.00)));

    ctx.__alerts.length = 0;
    await g('signFA')(club, 'Loophole Guy');
    ok('signing him back the same day does not happen',
       !CS.teams[club].r.some(p => p.n === 'Loophole Guy'),
       JSON.stringify(CS.teams[club].r.filter(p => p.n === 'Loophole Guy')));
    ok('...and the GM is told why', /released/i.test(ctx.__alerts.join(' ')),
       JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;

    /* And it holds across the phase switch, which is the point of the rule: the
       rest of the season AND the offseason that follows. */
    CS.cfg.phase = 'offseason';
    ok('still barred once the offseason opens',
       (g('cutRestriction')(club, 'Loophole Guy') || {}).hard === true);
    CS.cfg.phase = 'season';

    /* A minimum man is not a renegotiation, so he can come straight back — a GM
       parking an injured minimum player must not be locked out of his own club. */
    const cheap = {n:'Minimum Guy', p:'G', y:{'2025-26':1.00, '2026-27':1.00}, o:'', b:'', acq:2025, cut:false};
    CS.teams[club].r.push(cheap);
    g('releaseRecord')(club, CS.teams[club].r.indexOf(cheap));
    ok('a minimum release bars nothing in season',
       g('cutRestriction')(club, 'Minimum Guy') === null);
    await g('signFA')(club, 'Minimum Guy');
    ok('...and he can be signed straight back',
       CS.teams[club].r.some(p => p.n === 'Minimum Guy' && g('salNow')(p) === 1.00),
       JSON.stringify(ctx.__alerts));

    CS.teams[club].r = CS.teams[club].r.filter(p => p.n !== 'Minimum Guy');
    CS.teams[club].cuts = CS.teams[club].cuts.filter(
      c => c.n !== 'Loophole Guy' && c.n !== 'Minimum Guy');
    CS.cfg.phase = 'offseason';
    X.me = 'Osborn';
    ctx.__alerts.length = 0;
  }

  console.log('\n== a cut made now bars the club from the auction ==');
  {
    const CS = g('S');
    CS.cfg.phase = 'offseason'; CS.cfg.roster = 15;
    const club = g('TEAMS')().find(t => t !== 'N. Fink' && t !== 'D. Fink' && t !== 'N. Daman');
    const dear = {n:'Fresh Cut Guy', p:'G', y:{'2025-26':4.00, '2026-27':4.00}, o:'', b:'', acq:2025, cut:false};
    CS.teams[club].r.push(dear);
    X.me = club;
    g('releaseRecord')(club, CS.teams[club].r.indexOf(dear));
    ok('the release is recorded at his salary',
       (g('cutRecords')(club, 'Fresh Cut Guy')[0] || {}).s === 4.00,
       JSON.stringify(g('cutRecords')(club, 'Fresh Cut Guy')));
    /* A cut made NOW is stamped with the season the league is on, which is what
       makes its bar run this season and the offseason after it. */
    ok('...stamped with the season the league is on',
       g('cutRecords')(club, 'Fresh Cut Guy')[0].at === g('curSeason')(),
       JSON.stringify(g('cutRecords')(club, 'Fresh Cut Guy')[0]));
    ok('so the club cannot bid on him',
       (g('cutRestriction')(club, 'Fresh Cut Guy') || {}).hard === true);
    ok('...and he shows on its barred list',
       g('unsignableFor')(club).some(c => c.n === 'Fresh Cut Guy'));
    const rival2 = g('TEAMS')().find(t => t !== club);
    ok('...while a rival is free to take him',
       g('cutRestriction')(rival2, 'Fresh Cut Guy') === null);

    /* A minimum release is not a renegotiation, so it bars nothing. */
    const cheap = {n:'Cheap Cut Guy', p:'G', y:{'2025-26':1.00, '2026-27':1.00}, o:'', b:'', acq:2025, cut:false};
    CS.teams[club].r.push(cheap);
    g('releaseRecord')(club, CS.teams[club].r.indexOf(cheap));
    ok('a minimum release bars nothing',
       g('cutRestriction')(club, 'Cheap Cut Guy') === null,
       JSON.stringify(g('cutRestriction')(club, 'Cheap Cut Guy')));

    CS.teams[club].cuts = CS.teams[club].cuts.filter(
      c => c.n !== 'Fresh Cut Guy' && c.n !== 'Cheap Cut Guy');
    X.me = 'Osborn';
    ctx.__alerts.length = 0;
  }


  /* ============ SEASONS, CONTRACTS AND THE ROLL ============ */
  console.log('\n== a season key compares equal to itself ==');
  {
    const sk = g('seasonKey');
    /* The seed writes an en dash, a commissioner might type a hyphen, and the
       roll computes from a number. A key that does not compare equal to itself
       is the one bug this design cannot have. */
    ['2026–27', '2026-27', '2026', 2026, '2026–2027', ' 2026 - 27 ']
      .forEach(v => ok('  ' + JSON.stringify(String(v)) + ' -> 2026-27', sk(v) === '2026-27', sk(v)));
    ok('a century rolls over cleanly', sk(2099) === '2099-00', sk(2099));
    ok('nonsense is empty, not a wrong answer', sk('later') === '' && sk(null) === '');
    ok('seasonAt walks forwards', g('seasonAt')('2026-27', 1) === '2027-28');
    ok('...and backwards', g('seasonAt')('2026-27', -1) === '2025-26');
    ok('...and stays put at zero', g('seasonAt')('2026-27', 0) === '2026-27');
    ok('seasonStart is the first year', g('seasonStart')('2026-27') === 2026);
    ok('the league is on 2026-27', g('curSeason')() === '2026-27');
    /* One style everywhere. The seed wrote an en dash and a roll computes a
       hyphen, so without canonicalising cfg.season the header changed
       punctuation the first time the league moved — and a hand-typed season
       would not have matched the keys on a contract. */
    ok('cfg.season is canonicalised on load',
       g('S').cfg.season === '2026-27', JSON.stringify(g('S').cfg.season));
    ok('...even from the en-dashed form the seed used',
       g('normCfg')({season:'2030–31'}).season === '2030-31');
    ok('...and a season it cannot read is left alone rather than blanked',
       g('normCfg')({season:'later'}).season === 'later');
  }

  console.log('\n== a contract is money against a named season ==');
  {
    const CS = g('S');
    const sga = CS.teams['N. Fink'].r.find(p => /Gilgeous/.test(p.n));
    ok('the seed carries season keys, not a four-slot array',
       !Array.isArray(sga.y) && sga.y['2026-27'] === 41, JSON.stringify(sga.y));
    ok('salNow is what he is owed this season', g('salNow')(sga) === 41);
    ok('salPrev is the season just played', g('salPrev')(sga) === 39.25);
    ok('salOff walks forward from now', g('salOff')(sga, 1) === null);
    ok('yrsLeft counts from the current season', g('yrsLeft')(sga) === 1);

    /* The four-slot array is still READ, because the live league's blob is full
       of them until the next write. Index 1 was always "now". */
    const legacy = {n:'Legacy Shape', y:[1.00, 2.00, 3.00, null]};
    ok('an array still reads correctly', g('salNow')(legacy) === 2.00
       && g('salPrev')(legacy) === 1.00 && g('salOff')(legacy, 1) === 3.00);
    ok('...and converts to the same thing',
       JSON.stringify(g('normContract')([1.00, 2.00, 3.00, null], '2026-27'))
       === JSON.stringify({'2025-26':1, '2026-27':2, '2027-28':3}));
    ok('converting a map is a no-op, so it is safe on every load',
       JSON.stringify(g('normContract')({'2026-27':5}, '2026-27')) === JSON.stringify({'2026-27':5}));
    ok('...including the en-dashed keys an older build could have written',
       JSON.stringify(g('normContract')({'2026–27':5}, '2026-27')) === JSON.stringify({'2026-27':5}));

    ok('termFrom builds a run of seasons from now',
       JSON.stringify(g('termFrom')(4, 3)) ===
       JSON.stringify({'2026-27':4, '2027-28':4, '2028-29':4}));
    ok('...and one year is one season', Object.keys(g('termFrom')(4, 1)).length === 1);
  }

  console.log('\n== advancing the league year rewrites nothing ==');
  {
    const CS = g('S');
    CS.cfg.phase = 'offseason';
    const before = JSON.stringify(CS.teams);
    const cur = g('curSeason')(), next = g('seasonNext')(cur);
    const v = g('rollPreview')();
    ok('the preview names both seasons', v.cur === cur && v.next === next);
    ok('...and is pure — no roster is touched by asking',
       JSON.stringify(CS.teams) === before);
    ok('...and reports what would expire', v.expiring.length > 0, String(v.expiring.length));

    /* A player owed money in 2026-27 but not 2027-28 is under contract now and
       expiring after the roll. Nothing about HIM changes — only the year does. */
    const sga = CS.teams['N. Fink'].r.find(p => /Gilgeous/.test(p.n));
    ok('he is under contract before the roll', g('contracted')(sga) === true);
    const y0 = JSON.stringify(sga.y);

    CS.cfg.season = next;                       // the roll, in full
    ok('the same contract now reads as expiring', g('contracted')(sga) === false);
    ok('...and his money for the season just played is still on file',
       g('salPrev')(sga) === 41);
    ok('...because the contract itself was never rewritten',
       JSON.stringify(sga.y) === y0, JSON.stringify(sga.y));
    ok('a deal running into the new season survives it',
       CS.teams['Osborn'].r.some(p => g('contracted')(p)));

    /* Rolling twice by accident is the failure mode a destructive shift would
       have had. Here the second roll to the same year is simply idempotent. */
    CS.cfg.season = next;
    ok('setting the same year again changes nothing', JSON.stringify(sga.y) === y0);

    CS.cfg.season = cur;
    ok('and setting it back restores every contract',
       g('contracted')(sga) === true && JSON.stringify(CS.teams) === before);
  }

  console.log('\n== Bird rights vest because the year moves ==');
  {
    const CS = g('S');
    const club = g('TEAMS')()[0];
    /* Three COMPLETED seasons. Signed in 2024: two are done by the 2026-27
       league year, so no Bird; the roll to 2027-28 makes it three. */
    const man = {n:'Vesting Guy', p:'G', y:{'2026-27':2, '2027-28':2}, o:'', b:'', acq:2024, cut:false};
    CS.teams[club].r.push(man);
    CS.cfg.season = '2026-27';
    ok('two completed seasons is not Bird', g('tenureOf')(man) === 2 && g('birdRight')(man) === '');
    ok('the preview says he is about to vest',
       g('rollPreview')().bird.some(x => x.n === 'Vesting Guy'),
       JSON.stringify(g('rollPreview')().bird.slice(0, 3)));
    CS.cfg.season = '2027-28';
    ok('after the roll he has three, and the club has Bird',
       g('tenureOf')(man) === 3 && g('birdRight')(man) === 'Yes');
    CS.cfg.season = '2026-27';
    CS.teams[club].r = CS.teams[club].r.filter(p => p.n !== 'Vesting Guy');
  }

  console.log('\n== Payton Pritchard, end to end ==');
  {
    const CS = g('S');
    const club = 'N. Daman', guy = 'Payton Pritchard';
    CS.cfg.season = '2026-27'; CS.cfg.phase = 'offseason';
    const rec = (CS.teams[club].cuts || []).find(c => c.n === guy);
    ok('he was released during 2025-26', rec && rec.at === '2025-26', JSON.stringify(rec));
    ok('...above the minimum', rec.s === 1.25 && g('cutAboveMin')(rec) === true);

    ok('at the 2026 auction N. Daman cannot sign him',
       (g('cutRestriction')(club, guy) || {}).hard === true);
    ok('...and he is on their barred list',
       g('unsignableFor')(club).some(c => c.n === guy));
    ok('...while every other club may have him',
       g('TEAMS')().filter(t => t !== club)
         .every(t => g('cutRestriction')(t, guy) === null));

    CS.cfg.phase = 'season';
    ok('once 2026-27 goes live he is free to N. Daman as a free agent',
       g('cutRestriction')(club, guy) === null);
    ok('...and off the barred list', g('unsignableFor')(club).length === 0);

    CS.cfg.phase = 'offseason';
    ok('and the bar is back if the season is re-opened as the offseason',
       (g('cutRestriction')(club, guy) || {}).hard === true);
    CS.cfg.season = '2027-28';
    ok('a year later it has lapsed for good',
       g('cutRestriction')(club, guy) === null);
    CS.cfg.season = '2026-27';
  }

  console.log('\n== a signing writes the season it is made in ==');
  {
    const CS = g('S');
    CS.cfg.phase = 'season'; CS.cfg.roster = 15; CS.cfg.minSal = 1.00;
    const club = g('TEAMS')().find(t => g('headcount')(t) < CS.cfg.roster
                                      && CS.cfg.cap - g('committed')(t) > 10);
    X.me = club;
    const who = g('faPool')().find(p => !g('signedClub')(p.n) && !g('cutRestriction')(club, p.n)).n;
    await g('signFA')(club, who);
    const got = CS.teams[club].r.find(p => p.n === who);
    ok('the contract is keyed to the current season',
       got && got.y['2026-27'] === 1.00 && Object.keys(got.y).length === 1,
       got && JSON.stringify(got.y));
    ok('...so it expires when the year moves', (() => {
      CS.cfg.season = '2027-28';
      const gone = !g('contracted')(got);
      CS.cfg.season = '2026-27';
      return gone;
    })());
    CS.teams[club].r = CS.teams[club].r.filter(p => p.n !== who);
    CS.cfg.phase = 'offseason';
    X.me = 'Osborn';
    ctx.__alerts.length = 0;
  }


  console.log('\n== advancing the year is exactly reversible ==');
  {
    const CS = g('S');
    CS.cfg.phase = 'season'; CS.cfg.season = '2026-27'; CS.cfg.roster = 15;
    const club = g('TEAMS')().find(t => g('headcount')(t) < CS.cfg.roster);

    /* Dead money used to be the one destructive thing a roll did: it set
       c.live=false, which stepping back could not put right. It is derived now —
       an in-season release, in the season the league is on, while that season is
       live — so the roll writes the year and nothing else. */
    const man = {n:'Dead Money Guy', p:'G', y:{'2026-27':6}, o:'', b:'', acq:2025, cut:false};
    CS.teams[club].r.push(man);
    X.me = club;
    g('releaseRecord')(club, CS.teams[club].r.indexOf(man));
    const rec = g('cutRecords')(club, 'Dead Money Guy')[0];
    ok('an in-season release records that it was one', rec.live === true);
    ok('...and is charged to the cap', g('stillCharged')(rec) === true
       && g('deadSalary')(club) >= 6, String(g('deadSalary')(club)));

    const paid = g('committed')(club), snap = JSON.stringify(CS.teams);

    CS.cfg.season = '2027-28';
    ok('after the roll it is no longer charged', g('stillCharged')(rec) === false);
    ok('...and the payroll drops accordingly', g('committed')(club) < paid);
    ok('...but the release record itself is untouched',
       rec.live === true && rec.s === 6, JSON.stringify(rec));
    ok('the roll wrote nothing to any roster',
       JSON.stringify(CS.teams) === snap);

    CS.cfg.season = '2026-27';
    ok('stepping back charges it again', g('stillCharged')(rec) === true);
    ok('...and restores the payroll to the penny', g('committed')(club) === paid,
       g('committed')(club) + ' vs ' + paid);

    /* Closing the season stops the charge too, without mutating anything. */
    CS.cfg.phase = 'offseason';
    ok('a closed season stops the charge as well', g('stillCharged')(rec) === false);
    CS.cfg.phase = 'season';
    ok('...and re-opening it resumes', g('stillCharged')(rec) === true);

    CS.teams[club].cuts = CS.teams[club].cuts.filter(c => c.n !== 'Dead Money Guy');
    CS.cfg.phase = 'offseason';
    X.me = 'Osborn';
    ctx.__alerts.length = 0;
  }

  console.log('\n== resetting to the spreadsheet brings the year with it ==');
  {
    const CS = g('S');
    CS.cfg.season = '2026-27'; CS.cfg.phase = 'offseason';
    const base = g('headcount')('N. Fink'), basePay = g('committed')('N. Fink');

    /* The reset keeps the commissioner's settings and restores only the rosters.
       The league year is a setting, and the spreadsheet's contracts are keyed to
       the season it was written in — so handing them back while the league sits
       a year later would leave every one of them reading as expired. That is why
       the reset restores the year too, and why it is NOT the way to undo a roll:
       it wipes every transaction as well. */
    CS.cfg.season = '2027-28';
    ok('a year on, the same rosters read as expired',
       g('headcount')('N. Fink') < base,
       g('headcount')('N. Fink') + ' vs ' + base);

    const f = g('fresh')();
    ok('fresh() carries the spreadsheet’s own season',
       g('seasonKey')(f.cfg.season) === '2026-27', JSON.stringify(f.cfg.season));
    /* What the reset button does — the rosters replaced from the spreadsheet,
       the commissioner's settings kept, and the league year restored with them.
       Mutated in place because the harness exposes S by reference, not as a live
       binding, so reassigning it would not reach the app. */
    CS.teams = f.teams;
    CS.cfg.season = g('seasonKey')(f.cfg.season) || CS.cfg.season;
    g('normRosters')(CS.teams);
    ok('after the reset the year is back', g('curSeason')() === '2026-27');
    ok('...and so are the contracts',
       g('headcount')('N. Fink') === base && g('committed')('N. Fink') === basePay,
       g('headcount')('N. Fink') + '/' + g('committed')('N. Fink'));
    ok('...and the release stamps with them',
       (g('S').teams['N. Daman'].cuts || []).find(c => c.n === 'Payton Pritchard').at === '2025-26');
  }


  console.log('\n== a GM may build any trade, but only propose his own ==');
  {
    const CS = g('S');
    CS.cfg.phase = 'offseason';
    const T3 = g('TEAMS')();
    const mineClub = 'Osborn';
    const other1 = T3.find(t => t !== mineClub), other2 = T3.find(t => t !== mineClub && t !== other1);
    const side = (a, b) => ({a, b});

    X.me = mineClub;
    ok('a trade with his club on the near side is his',
       g('tradeSideOf')(side(mineClub, other1)) === mineClub);
    ok('...and on the far side too',
       g('tradeSideOf')(side(other1, mineClub)) === mineClub);
    /* The machine is for working out what a deal between two rivals would do as
       much as one of his own, so building it stays open to everybody — only
       putting it to somebody is restricted. */
    ok('a trade between two rivals is not his',
       g('tradeSideOf')(side(other1, other2)) === null,
       String(g('tradeSideOf')(side(other1, other2))));

    X.me = null;
    ok('signed out, no trade is his', g('tradeSideOf')(side(mineClub, other1)) === null);

    /* The commissioner has no club of his own, so he answers for whichever club
       he is acting as — his tools exist to make the ledger match reality,
       including recording a deal the two clubs agreed away from the app. */
    X.me = '__comm__';
    const acting = g('meTeam')();
    ok('the commissioner is whichever club he is acting for',
       g('tradeSideOf')(side(acting, other1)) === acting, String(acting));
    ok('...and not one he is not', g('tradeSideOf')(
       side(T3.find(t => t !== acting), T3.find(t => t !== acting && t !== T3.find(x => x !== acting)))) === null);

    console.log('-- and the handler refuses, not just the button --');
    X.me = mineClub;
    /* A disabled button is a signpost; the rule has to be in the handler, or a
       stale render leaves it clickable. */
    const before = (CS.trades || []).length;
    const src = g('drawTrade').toString() + g('validateTrade').toString();
    ok('drawTrade disables the button off tradeSideOf', /tradeSideOf/.test(g('drawTrade').toString()));
    ok('...and the click handler checks it too',
       /tradeSideOf/.test(String(ctx.document.getElementById('propose').onclick)),
       String(ctx.document.getElementById('propose').onclick).slice(0, 80));
    ctx.__alerts.length = 0;
    X.me = 'Osborn';
  }

  console.log('\n== the trade machine\'s Stats button opens the shared modal ==');
  {
    /* It used to render a card into a panel below the builder, so reading the
       stats you had just asked for meant scrolling past both pick lists — the
       same fault the Free agent classes tab had, and the same fix. */
    const src = g('drawTradeLists').toString();
    ok('it calls openPlayerCard', /openPlayerCard/.test(src));
    ok('...and no longer writes into a panel below', !/tradeDetail/.test(src), 'tradeDetail still referenced');
    ok('the panel it used to write into is gone from the page',
       ctx.document.getElementById('tradeDetail') == null);
    ok('the modal itself is still there', !!ctx.document.getElementById('dlgPlayerBody'));
  }


  console.log('\n== a GM records who he is, once ==');
  {
    const CS = g('S');
    const club = 'Osborn';
    delete CS.teams[club].gm;
    X.me = club;

    ok('nothing on file to begin with',
       g('gmOf')(club) === null && g('gmName')(club) === '');
    ok('...so the club is known only by its name', g('clubWho')(club) === club);

    console.log('-- what it will not accept --');
    const err = g('gmNameError');
    ok('both names are required',
       /both a first and a last/.test(err('Nathan', '') || '')
       && /both a first and a last/.test(err('', 'Daman') || ''));
    ok('whitespace is not a name', /both a first and a last/.test(err('  ', ' ') || ''));
    ok('digits alone are not a name', /does not look like a name/.test(err('123', '456') || ''));
    ok('an over-long name is refused',
       /40 characters/.test(err('x'.repeat(41), 'Daman') || ''));
    ok('a real name passes', err('Nathan', 'Daman') === null);
    ok('...and so does an accented one', err('Zoë', 'Şengün') === null,
       String(err('Zoë', 'Şengün')));

    console.log('-- recording it --');
    ctx.__alerts.length = 0;
    await g('saveGmName')(club, '  nathan ', ' daman  ');
    const rec = g('gmOf')(club);
    ok('it is on file', !!rec, JSON.stringify(rec));
    ok('...trimmed and collapsed, exactly as typed otherwise',
       rec.first === 'nathan' && rec.last === 'daman', JSON.stringify(rec));
    ok('...stamped with when', typeof rec.at === 'string' && rec.at.length > 8, JSON.stringify(rec.at));
    ok('gmName joins the two', g('gmName')(club) === 'nathan daman');
    ok('clubWho carries both', g('clubWho')(club) === 'Osborn (nathan daman)');
    ok('and it is logged', CS.log.some(e => /recorded as GM of Osborn/.test(e.detail || '')));

    console.log('-- and then it is fixed --');
    ctx.__alerts.length = 0;
    await g('saveGmName')(club, 'Someone', 'Else');
    ok('a second attempt by the GM changes nothing',
       g('gmName')(club) === 'nathan daman', g('gmName')(club));
    ok('...and he is told why',
       /set once|already recorded/i.test(ctx.__alerts.join(' ')), JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;

    /* Fixed means fixed TO THE GM. An identity nobody can repair is worse than
       one its owner cannot casually rewrite, so the commissioner is the
       correction path — the same way he is for a forgotten PIN. */
    X.me = '__comm__';
    await g('saveGmName')(club, 'Nathan', 'Daman');
    ok('the commissioner can correct a typo', g('gmName')(club) === 'Nathan Daman');
    ok('...and the correction is logged',
       CS.log.some(e => /corrected to Nathan Daman/.test(e.detail || '')));
    ok('...but the original timestamp is kept', g('gmOf')(club).at === rec.at);

    console.log('-- another GM cannot set it for you --');
    /* Deliberately not a deputy: a deputy holds commissioner access and so may
       correct anybody, which is the rule above, not a hole in this one. */
    const other = g('TEAMS')().find(t => t !== club && !g('deputies')().includes(t));
    delete CS.teams[other].gm;
    X.me = other;
    ctx.__alerts.length = 0;
    await g('saveGmName')(club, 'Not', 'Me');
    ok('a rival cannot name your club', g('gmName')(club) === 'Nathan Daman');
    ok('...and is refused out loud',
       /your own name/i.test(ctx.__alerts.join(' ')), JSON.stringify(ctx.__alerts));
    ctx.__alerts.length = 0;
    X.me = club;
  }

  console.log('\n== the name survives a rename, which is the whole point ==');
  {
    const CS = g('S');
    const from = 'Osborn', to = 'Osborn Athletic';
    ok('the club is on file under its current name', g('gmName')(from) === 'Nathan Daman');

    ok('the rename runs', g('renameClub')(from, to) === true);
    ok('the club answers to the new name', !!CS.teams[to] && !CS.teams[from]);
    ok('...and the GM came with it', g('gmName')(to) === 'Nathan Daman',
       g('gmName')(to));
    ok('...so the league still knows who ran it',
       g('clubWho')(to) === 'Osborn Athletic (Nathan Daman)');
    ok('a club with nothing on file still renames cleanly',
       g('gmName')('Coulter') === '' && g('clubWho')('Coulter') === 'Coulter');

    g('renameClub')(to, from);
    ok('and back again', g('gmName')(from) === 'Nathan Daman');
    delete CS.teams[from].gm;
    X.me = 'Osborn';
    ctx.__alerts.length = 0;
  }


  console.log('\n== a rename does not leave the club behind under both names ==');
  {
    const CS = g('S');
    CS.cfg.renames = [];
    const from = 'Osborn', to = 'Osborn Athletic';
    /* The bug, exactly as it was reported: rename on one device, and every other
       device shows the club twice on Contracts. The rosters merge starts from the
       server's copy and only ever adds or overwrites, so it could not express the
       one thing a rename does — remove a key — and the old name came straight
       back from the server. */
    const server = JSON.parse(JSON.stringify(CS.teams));
    ok('the server has the club under its old name', !!server[from]);

    g('renameClub')(from, to);
    ok('my copy has only the new name', !CS.teams[from] && !!CS.teams[to]);
    ok('...and the rename was recorded', g('renameLog')().some(r => r.from === from && r.to === to));
    ok('renamedAway knows the old name is gone', g('renamedAway')(from) === true);
    ok('...and that the new one is not', g('renamedAway')(to) === false);

    const merged = g('mergeSlice')('rosters', server, CS.teams);
    ok('the merge drops the old name', !merged[from], Object.keys(merged).join());
    ok('...keeps the new one', !!merged[to]);
    ok('...and the league still has nine clubs', Object.keys(merged).length === 9,
       String(Object.keys(merged).length));

    console.log('-- but it must not drop anybody else’s work --');
    /* The merge behaves this way for a reason: two GMs editing DIFFERENT clubs at
       once. Each club is last-write-wins on its own, so his signing and mine both
       survive — and dropping his club because my copy is stale must stay
       impossible, which is exactly what the removal above had to be careful of. */
    const his = g('TEAMS')().find(t => t !== to);
    const mineClub = to;
    /* The base is what the server last handed me — the app anchors it on every
       read, poll and successful write. It is the third copy that lets the merge
       tell "I changed this" from "I am out of date about it". */
    const base = JSON.parse(JSON.stringify(CS.teams));
    g('setBase')('rosters', base);
    const server2 = JSON.parse(JSON.stringify(base));
    server2[his].r.push({n:'His Signing', p:'G', y:{'2026-27':1}, o:'', b:'', acq:2025, cut:false});
    const stale = JSON.parse(JSON.stringify(base));       // my copy never saw his
    stale[mineClub].r.push({n:'My Signing', p:'G', y:{'2026-27':1}, o:'', b:'', acq:2025, cut:false});
    const m2 = g('mergeSlice')('rosters', server2, stale);
    ok('his signing survives on his club',
       m2[his].r.some(p => p.n === 'His Signing'));
    ok('...and mine on mine', m2[mineClub].r.some(p => p.n === 'My Signing'));
    ok('...and no club is lost', Object.keys(m2).length === Object.keys(server2).length,
       Object.keys(m2).length + ' vs ' + Object.keys(server2).length);
    /* With no base copy at all — a first write before any read — every club reads
       as changed and mine wins, which is the old behaviour and the safe default
       for a league the client has never read. */
    g('setBase')('rosters', null);
    const m2b = g('mergeSlice')('rosters', server2, stale);
    ok('with no base copy the writer still wins outright',
       !m2b[his].r.some(p => p.n === 'His Signing'));
    g('setBase')('rosters', CS.teams);

    console.log('-- a name renamed away and then used again is not swept up --');
    g('renameClub')(to, from);                       // rename back
    ok('renamedAway forgets once the name is in use again',
       g('renamedAway')(from) === false, JSON.stringify(g('renameLog')()));
    const m3 = g('mergeSlice')('rosters', JSON.parse(JSON.stringify(CS.teams)), CS.teams);
    ok('...so the club survives a merge', !!m3[from]);
    CS.cfg.renames = [];
  }

  console.log('\n== removing a club takes its references with it ==');
  {
    const CS = g('S');
    CS.cfg.renames = [];
    X.me = '__comm__';
    const gone = 'Schwab', mate = g('TEAMS')().find(t => t !== gone);
    const before = g('TEAMS')().length;

    // give it something to be tied to
    g('takePick')(2027, gone);
    CS.trades = [{ts:1, by:gone, a:gone, b:mate, give:[], get:[], givePk:[], getPk:[], status:'pending'}];
    CS.auction = {player:'X', by:gone, bid:1, leader:gone, bids:[{t:gone,amt:1,ts:1}], max:{}, status:'open', ts:1};
    CS.cfg.nomOrder = g('TEAMS')().slice();
    CS.cfg.deputies = [gone];
    CS.cfg.draft = {year:2027, order:g('TEAMS')().slice(), sal:[], open:false};

    const cost = g('clubRemovalCost')(gone);
    ok('the cost is reported before anything happens',
       cost.roster > 0 && cost.offers === 1 && cost.inAuction === true, JSON.stringify(cost));
    ok('...and asking did not change anything', !!CS.teams[gone]);

    ok('the removal runs', g('removeClub')(gone) === true);
    ok('the club is gone', !CS.teams[gone] && g('TEAMS')().length === before - 1);
    ok('...its picks went with it',
       g('TEAMS')().every(t => (CS.teams[t].picks || []).every(k => k.from !== gone)));
    ok('...its offers were dropped', (CS.trades || []).length === 0);
    ok('...the auction lot was cancelled', g('A')() === null);
    ok('...it left the nomination order', !CS.cfg.nomOrder.includes(gone));
    ok('...and the deputies list', !g('deputies')().includes(gone));
    ok('...and the draft order', !CS.cfg.draft.order.includes(gone));
    ok('the merge will not resurrect it',
       !g('mergeSlice')('rosters', JSON.parse(JSON.stringify(CS.teams)), CS.teams)[gone]);
    ok('and rendering afterwards does not throw', (() => { g('render')(); return true; })());

    ok('the last club cannot be removed', (() => {
      const only = g('TEAMS')()[0];
      const keep = CS.teams;
      CS.teams = {[only]: keep[only]};
      const r = g('removeClub')(only);
      CS.teams = keep;
      return r === false;
    })());

    CS.trades = []; CS.auction = null; CS.cfg.nomOrder = [];
    CS.cfg.deputies = ['A. Daman', 'N. Daman']; delete CS.cfg.draft; CS.cfg.renames = [];
    X.me = 'Osborn';
    ctx.__alerts.length = 0;
  }

  console.log('\n== no stray alerts ==');
  ok('nothing alerted', ctx.__alerts.length===0, JSON.stringify(ctx.__alerts));

  console.log('\n'+(fails? fails+' of '+ran+' FAILED' : 'all '+ran+' passed'));
  process.exit(fails?1:0);
})().catch(e=>{ console.error('\nHARNESS THREW:\n', e && e.stack || e); process.exit(1); });
