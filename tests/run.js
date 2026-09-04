'use strict';
const fs=require('fs'), path=require('path'), vm=require('vm');
const {Doc, makeStorage} = require('./dom.js');

const FILE = process.argv[2] || path.join(__dirname, '..', 'deploy', 'index.html');
const html = fs.readFileSync(FILE,'utf8');
const i = html.indexOf('<script>'), j = html.lastIndexOf('</script>');
if(i<0||j<0) throw new Error('no script block');
const src = html.slice(i+8, j);

const document = new Doc(html.slice(0,i));
const listeners = {};
const window = {
  addEventListener:(t,f)=>{ (listeners[t]=listeners[t]||[]).push(f); },
  removeEventListener(){}, matchMedia:()=>({matches:false, addEventListener(){}, addListener(){}}),
  location:{href:'https://hopefullyitwill.work/', search:'', hash:'', origin:'https://hopefullyitwill.work'},
  scrollTo(){}, innerWidth:1280, innerHeight:900, devicePixelRatio:1,
  getComputedStyle:()=>({getPropertyValue:()=>''}),
  crypto:{ getRandomValues:a=>{ for(let k=0;k<a.length;k++) a[k]=Math.floor(Math.random()*256); return a; },
           randomUUID:()=>'00000000-0000-4000-8000-000000000000', subtle:{} },
};
window.window = window;
const ctx = {
  window, document, console,
  localStorage: makeStorage(), sessionStorage: makeStorage(),
  navigator:{ userAgent:'node', onLine:true, clipboard:{ writeText:async()=>{} } },
  /* No league database in the harness — Store falls through to local state. */
  fetch: async()=>{ throw new Error('offline'); },
  setTimeout, clearTimeout, setInterval:()=>0, clearInterval, queueMicrotask,
  requestAnimationFrame:f=>setTimeout(()=>f(Date.now()),0), cancelAnimationFrame(){},
  alert:m=>{ ctx.__alerts.push(String(m)); },
  confirm:()=>true, prompt:()=>null,
  Blob: class Blob { constructor(p){ this.parts=p; } },
  URL: { createObjectURL:()=>'blob:x', revokeObjectURL(){} },
  crypto: window.crypto, atob:s=>Buffer.from(s,'base64').toString('binary'),
  btoa:s=>Buffer.from(s,'binary').toString('base64'),
  TextEncoder, TextDecoder, Math, Date, JSON, Promise, Object, Array, Set, Map,
  __alerts: [], __toasts: [],
};
ctx.globalThis = ctx;
vm.createContext(ctx);

let bootError = null;
process.on('unhandledRejection', e=>{ bootError = bootError || e;
  console.error('UNHANDLED REJECTION DURING BOOT:', (e && e.stack) || e); });
/* top-level let/const live in the script's lexical scope, not on the vm global,
   so the module is asked to hand them out explicitly */
const EPILOGUE = ';globalThis.__X={' + [
  'S','me','STRAT','RATER','RIDX','PROJ','useProj','activeTeam','SORTS','redraw',
  'TEAMS','isComm','canEdit','committed','headcount','yrsLeft','birdKind','BIRDOPTS','OPTL','cmp','money',
  'ALIAS','POSFIX','HAS_API','NOTIFY','emailing','fixing','selA','selB','PCATS','contracted','tradeable','catGood','catCell','editing',
  'ROOKIES','ROOKIES_PLACEHOLDER','PROTMAX','selPA','selPB','PICKPROT',
  'pickId','pickRec','pickHolder','effHolder','pickMade','onClock',
  'hasStats','canEditContract','CSVCOLS','csvCell','aliasesFor','csvFileName',
  'CHAT','CHATREV','CHATMAX','CHATSHOW','CHATLOADED','chatId','chatOn','SLICES',
  'notesKey','NOTES','normProj','normNotes','syncWord',
  'cboxRemoteKey','cboxLocalKey','cboxPick','cboxReadLocal','CBOXAT','CBOXREV',
  'isFreeAgent','ownerLabel','LAB','raterClub',
  'AGG','PROJSRC','projFor','usingMine','usingAgg','projSrcLabel','RTGCACHE',
  'NBATM','SLOTS','SLOTIDS','slotKind','slotLabel','isLocked','leagueTZ','irOf','posText','onIR','irCount','fresh','signedClub','swapping','LUCATS','hhmm','SLOTIDS','SCHED','TRICODE','tipFor',
  'minSal','deadlinePassed','canSignFA','nomOrder','nomFull','canNominate','OFFSEASON_TABS',
  'nomCount',
  'render','clubNameError','moveClubLocals','drawSettings','clubPicks','takePick','draftCfg','committed','headcount',
  'BIRDYRS','leagueYear','birdYears','tenureOf','birdRight','birdMismatch','SEASON_TABS','renameClub',
  'clubSlug','DEPUTY_SEED','deputies','isDeputy','hasComm','canGrantComm','normCfg',
  'signBlock','matchOffer','canAnswerMatch','awardTo','answerMatch','closeAuction','toggleDeputy'
].map(n=>'get '+n+'(){return '+n+'}, set '+n+'(v){'+n+'=v}').join(',') + '};';

try { vm.runInContext(src + EPILOGUE, ctx, {filename:'index.html'}); }
catch(e){ console.error('SCRIPT THREW ON LOAD:\n', e && e.stack || e); process.exit(1); }

module.exports = { ctx, document, listeners, get bootError(){ return bootError; } };
