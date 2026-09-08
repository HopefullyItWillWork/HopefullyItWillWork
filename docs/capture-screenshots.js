/* Retakes every screenshot in docs/images from the real app.
     node docs/capture-screenshots.js
   Needs playwright-core (npm i playwright-core) and the sandbox Chromium.
   Signs in as a GM — never the commissioner — so the guide only ever shows what
   a GM can see. Runs each tab in the season phase it belongs to, seeds the
   screens that are empty in a fresh league, and writes 1500px-wide JPEGs. */
const {chromium}=require('playwright-core');
const fs=require('fs'), path=require('path');
const CHROME=process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const APP='file://'+path.resolve(__dirname,'..','deploy','index.html');
const OUT=path.join(__dirname,'images');
const GM='Osborn';                       // a plain GM: not a commissioner deputy

const FULLTAB=[
  ['v-me','my-team-offseason','offseason'], ['v-auction','auction','offseason'],
  ['v-contracts','contracts','offseason'],  ['v-rater','player-rater','offseason'],
  ['v-fa','free-agent-classes','offseason'],['v-rookie','rookie-draft','offseason'],
  ['v-chat','chat-notes','offseason'],      ['v-proj','my-projections','offseason'],
  ['v-trends','team-trends','offseason'],   ['v-history','league-history','offseason'],
  ['v-rules','cap-rules','offseason'],      ['v-settings','settings','offseason'],
  ['v-draft','quick-sign','season'],
];

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const b=await chromium.launch({executablePath:CHROME});
  const pg=await b.newPage({viewport:{width:1340,height:2400},deviceScaleFactor:2});
  const errs=[],log=[];
  pg.on('pageerror',e=>errs.push(String(e)));
  pg.on('dialog',d=>d.accept());
  await pg.goto(APP); await pg.waitForTimeout(700);
  await pg.evaluate(g=>localStorage.setItem('ll_me',g),GM);
  await pg.reload(); await pg.waitForTimeout(1100);

  const phase=p=>pg.evaluate(p=>{const c=JSON.parse(JSON.stringify(fresh().cfg));
    c.phase=p; applySlice('settings',c); render();},p);

  /* Element shots handle their own scrolling; a tall panel is bounded by capping
     its height rather than clipping in page coordinates, which fails the moment
     the element sits below the viewport. */
  async function grab(sel,name,maxH=1600){
    const el=await pg.$(sel);
    if(!el){log.push([name,'NO ELEMENT']);return;}
    const bx=await el.boundingBox();
    if(!bx||bx.height<25){log.push([name,'EMPTY']);return;}
    const capped=bx.height>maxH;
    if(capped) await pg.evaluate(([s,h])=>{const e=document.querySelector(s);
      e.dataset.os=e.getAttribute('style')||''; e.style.maxHeight=h+'px'; e.style.overflow='hidden';},[sel,maxH]);
    await pg.waitForTimeout(150);
    const png=await el.screenshot();
    if(capped) await pg.evaluate(s=>{const e=document.querySelector(s);
      e.setAttribute('style',e.dataset.os||''); delete e.dataset.os;},sel);
    await writeJpg(pg,name,png);
    log.push([name,'ok '+Math.round(bx.height)]);
  }
  /* No image tooling in the sandbox, so the browser does the resize and the
     JPEG encode: 1500px wide is ample for a 7in page and keeps the repo small. */
  async function writeJpg(pg,name,png){
    const d=await pg.evaluate(async src=>{
      const img=new Image();
      await new Promise((r,j)=>{img.onload=r;img.onerror=j;img.src=src;});
      const s=Math.min(1,1500/img.naturalWidth);
      const c=document.createElement('canvas');
      c.width=Math.round(img.naturalWidth*s); c.height=Math.round(img.naturalHeight*s);
      const x=c.getContext('2d');
      x.imageSmoothingQuality='high'; x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
      x.drawImage(img,0,0,c.width,c.height);
      return c.toDataURL('image/jpeg',0.92);
    },'data:image/png;base64,'+png.toString('base64'));
    fs.writeFileSync(path.join(OUT,name+'.jpg'),Buffer.from(d.split(',')[1],'base64'));
  }

  // --- chrome: the header as a connected GM actually sees it ---
  await pg.evaluate(()=>{const c=document.getElementById('netChip');
    c.textContent='shared · rev 412'; c.className='chip live';});
  await grab('header','header',400);

  // --- the sign-in dialog ---
  await pg.evaluate(()=>localStorage.removeItem('ll_me'));
  await pg.reload(); await pg.waitForTimeout(900);
  await pg.evaluate(()=>{const x=document.getElementById('signBtn')||document.getElementById('signCTA'); x&&x.click();});
  await pg.waitForTimeout(500);
  await grab('#dlgSign','sign-in',700);
  await pg.evaluate(g=>localStorage.setItem('ll_me',g),GM);
  await pg.reload(); await pg.waitForTimeout(1000);

  // --- the transaction log needs something in it to be worth a picture ---
  await phase('offseason');
  await pg.evaluate(()=>{const n=Date.now();
    applySlice('log',[
      {ts:n-480000, by:'Osborn',   kind:'sign', team:'Osborn',   detail:'Nominated Josh Hart at $5.00'},
      {ts:n-1320000,by:'Coulter',  kind:'sign', team:'Coulter',  detail:'Won Jalen Green at $6.25'},
      {ts:n-2820000,by:'Osborn',   kind:'cut',  team:'Osborn',   detail:'Norman Powell released — $1.00'},
      {ts:n-5400000,by:'Brice',    kind:'trade',team:'Brice / Schwab', detail:'TRADE EXECUTED — Brice sends RJ Barrett; Schwab sends Gradey Dick'},
      {ts:n-8400000,by:'Christman',kind:'sign', team:'Christman',detail:'Won Neemias Queta at $1.00'}]);
    render(); goTab('v-log');});
  await pg.waitForTimeout(400);
  await grab('#v-log','transactions',1200);

  // --- a live lot, for the auction room and the bid box ---
  const lot=()=>pg.evaluate(()=>{
    applySlice('auction',{player:'Josh Hart',by:'Coulter',bid:5.5,leader:'Coulter',
      bids:[{t:'Coulter',amt:5.5,ts:Date.now()-20000},{t:'Osborn',amt:5.25,ts:Date.now()-45000},
            {t:'Coulter',amt:4.5,ts:Date.now()-70000},{t:'Brice',amt:3,ts:Date.now()-95000}],
      max:{},status:'open',ts:Date.now()-120000});
    const c=JSON.parse(JSON.stringify(fresh().cfg)); c.phase='offseason';
    c.nomOrder=TEAMS().slice(); applySlice('settings',c); render();});
  await lot();
  await pg.evaluate(()=>goTab('v-me')); await pg.waitForTimeout(500);
  await grab('#bidPanel','bid-panel',900);
  await pg.evaluate(()=>goTab('v-auction')); await pg.waitForTimeout(400);
  await grab('#stratWrap','auction-strategy',1100);
  await pg.evaluate(()=>applySlice('auction',null));

  // --- My Team close-ups ---
  await phase('offseason');
  await pg.evaluate(()=>goTab('v-me')); await pg.waitForTimeout(400);
  await grab('#meHead','my-team-header',700);
  await grab('#meRoster','my-roster',1000);
  // the what-if roster is a run of siblings, so wrap it to shoot it as one unit
  await pg.evaluate(()=>{
    const hs=[...document.querySelectorAll('#v-me h2')];
    const a=hs.find(h=>/What-if roster/.test(h.textContent));
    const z=hs.find(h=>/Available free agents/.test(h.textContent));
    if(!a||!z||document.getElementById('__whatif')) return;
    const w=document.createElement('div'); w.id='__whatif';
    a.parentNode.insertBefore(w,a);
    let n=a; while(n&&n!==z){const nx=n.nextSibling; w.appendChild(n); n=nx;}
    const s=document.getElementById('labSeed'); if(s){s.value='Osborn'; s.onchange&&s.onchange();}
  });
  await pg.waitForTimeout(700);
  await grab('#__whatif','what-if-roster',1900);
  await pg.reload(); await pg.waitForTimeout(1000);

  // --- in season: the lineup, and the free agent list with its Sign button ---
  await phase('season');
  await pg.evaluate(async()=>{ await autoLineup(meTeam()); render(); goTab('v-me'); });
  await pg.waitForTimeout(700);
  await grab('#luWrap','lineup',2200);
  await grab('#faTable','free-agents-sign',1200);

  // --- the trade machine, with a player on each side ---
  await phase('offseason');
  await pg.evaluate(()=>{ goTab('v-trade');
    document.getElementById('tA').value='Osborn';
    document.getElementById('tB').value='Coulter';
    drawTradeLists(); drawTrade();
    const a=document.querySelector('#listA input[data-a]'); if(a){a.checked=true;a.onchange();}
    const c=document.querySelector('#listB input[data-b]'); if(c){c.checked=true;c.onchange();}});
  await pg.waitForTimeout(500);
  await grab('#v-trade','trades',2100);

  // --- the shared player card ---
  await pg.evaluate(()=>openPlayerCard('Nikola Jokić'));
  await pg.waitForTimeout(500);
  await grab('#dlgPlayer','player-card',1300);
  await pg.evaluate(()=>closeModal('dlgPlayer'));

  // --- one overview shot per remaining tab ---
  let cur=null;
  for(const [tab,name,ph] of FULLTAB){
    if(ph!==cur){ await phase(ph); cur=ph; await pg.waitForTimeout(250); }
    if(name==='auction') await lot();
    const shown=await pg.evaluate(t=>goTab(t)!==false&&!document.getElementById(t).hidden,tab);
    if(!shown){ log.push([name,'TAB HIDDEN']); continue; }
    await pg.waitForTimeout(400);
    await grab('#'+tab,name,2000);
  }

  log.forEach(([n,s])=>console.log(String(s).padEnd(16),n));
  if(errs.length) console.log('PAGE ERRORS:',errs);
  await b.close();
})();
