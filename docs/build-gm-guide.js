/* Builds docs/League-Ledger-GM-Guide.docx from the screenshots in docs/images.
   Run from the repo root with `docx` available:  node docs/build-gm-guide.js
   Screenshots are captured from the real app — see the note at the end of the
   guide for how to retake them. */
const fs=require('fs'), path=require('path');
const D=require('docx');
const {Document,Packer,Paragraph,TextRun,HeadingLevel,AlignmentType,ImageRun,Table,TableRow,
  TableCell,WidthType,ShadingType,BorderStyle,PageBreak,LevelFormat,TableOfContents,
  Footer,PageNumber,convertInchesToTwip}=D;

const IMG=path.join(__dirname,'images');
const OUT=path.join(__dirname,'League-Ledger-GM-Guide.docx');

/* ---- image sizing -------------------------------------------------------
   Page is US Letter with 0.75in margins, so 7in of usable width = 672px at
   96dpi. Read the JPEG's own SOF marker for its size and scale to fit. */
const MAXW=660, MAXH=760;
function jpegSize(buf){
  let i=2;
  while(i<buf.length){
    if(buf[i]!==0xFF){i++;continue;}
    const m=buf[i+1];
    if(m>=0xC0&&m<=0xCF&&m!==0xC4&&m!==0xC8&&m!==0xCC)
      return {h:buf.readUInt16BE(i+5), w:buf.readUInt16BE(i+7)};
    i+=2+buf.readUInt16BE(i+2);
  }
  throw new Error('no SOF');
}
function shot(file,caption){
  const p=path.join(IMG,file);
  if(!fs.existsSync(p)) throw new Error('missing screenshot: '+file);
  const buf=fs.readFileSync(p), {w,h}=jpegSize(buf);
  const s=Math.min(MAXW/w, MAXH/h, 1);
  const out=[new Paragraph({spacing:{before:160,after:60},alignment:AlignmentType.CENTER,
    children:[new ImageRun({type:'jpg',data:buf,
      transformation:{width:Math.round(w*s),height:Math.round(h*s)}})]})];
  if(caption) out.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:200},
    children:[new TextRun({text:caption,italics:true,size:17,color:'6B7280'})]}));
  return out;
}

/* ---- text helpers ---- */
const H1=t=>new Paragraph({text:t,heading:HeadingLevel.HEADING_1,spacing:{before:360,after:140}});
const H2=t=>new Paragraph({text:t,heading:HeadingLevel.HEADING_2,spacing:{before:280,after:110}});
const H3=t=>new Paragraph({text:t,heading:HeadingLevel.HEADING_3,spacing:{before:220,after:90}});
/* rich() turns ['plain', ['bold',1], ['code',2]] into runs */
function rich(parts,opt={}){
  const runs=(Array.isArray(parts)?parts:[parts]).map(x=>{
    if(typeof x==='string') return new TextRun({text:x,size:21});
    const [text,kind]=x;
    if(kind===1) return new TextRun({text,bold:true,size:21});
    if(kind===2) return new TextRun({text,font:'Consolas',size:19,color:'8A5A00'});
    if(kind===3) return new TextRun({text,italics:true,size:21});
    return new TextRun({text,size:21});
  });
  return new Paragraph({children:runs,spacing:{after:opt.after??140},...opt.p});
}
const P=(parts,opt)=>rich(parts,opt);
const BULLET=(parts,lvl=0)=>rich(parts,{after:60,p:{numbering:{reference:'bul',level:lvl}}});
const NUM=(parts)=>rich(parts,{after:60,p:{numbering:{reference:'num',level:0}}});

/* a callout box */
function note(title,body,tone){
  const bg = tone==='warn' ? 'FDF3E3' : tone==='bad' ? 'FCEDEC' : 'EEF3FA';
  const bar= tone==='warn' ? 'B4791B' : tone==='bad' ? 'A33A31' : '3E5C86';
  return new Table({
    columnWidths:[10080],
    borders:{top:{style:BorderStyle.SINGLE,size:2,color:bg},bottom:{style:BorderStyle.SINGLE,size:2,color:bg},
      left:{style:BorderStyle.SINGLE,size:18,color:bar},right:{style:BorderStyle.SINGLE,size:2,color:bg},
      insideHorizontal:{style:BorderStyle.NONE},insideVertical:{style:BorderStyle.NONE}},
    rows:[new TableRow({children:[new TableCell({
      width:{size:10080,type:WidthType.DXA},
      shading:{type:ShadingType.CLEAR,fill:bg,color:'auto'},
      margins:{top:120,bottom:120,left:180,right:180},
      children:[
        new Paragraph({spacing:{after:60},children:[new TextRun({text:title,bold:true,size:21,color:bar})]}),
        new Paragraph({children:[new TextRun({text:body,size:21})]})
      ]})]})]});
}

/* a simple table; widths are DXA and must sum to the table width */
function table(headers,rows,widths){
  const total=widths.reduce((a,b)=>a+b,0);
  const cell=(t,i,bold,fill)=>new TableCell({
    width:{size:widths[i],type:WidthType.DXA},
    shading:fill?{type:ShadingType.CLEAR,fill,color:'auto'}:undefined,
    margins:{top:90,bottom:90,left:130,right:130},
    children:[new Paragraph({children:[new TextRun({text:t,bold:!!bold,size:20})]})]});
  const mk=(cells,bold,fill)=>new TableRow({
    tableHeader:!!bold,
    children:cells.map((t,i)=>cell(t,i,bold,fill))});
  return new Table({
    columnWidths:widths, width:{size:total,type:WidthType.DXA},
    borders:{top:{style:BorderStyle.SINGLE,size:4,color:'C9D2DE'},bottom:{style:BorderStyle.SINGLE,size:4,color:'C9D2DE'},
      left:{style:BorderStyle.SINGLE,size:4,color:'C9D2DE'},right:{style:BorderStyle.SINGLE,size:4,color:'C9D2DE'},
      insideHorizontal:{style:BorderStyle.SINGLE,size:2,color:'DCE3EC'},
      insideVertical:{style:BorderStyle.SINGLE,size:2,color:'DCE3EC'}},
    rows:[mk(headers,true,'EDF1F6'), ...rows.map(r=>mk(r,false))]});
}
const SPACER=()=>new Paragraph({text:'',spacing:{after:120}});

/* ======================= THE GUIDE ======================= */
const body=[];
const add=(...xs)=>xs.forEach(x=>Array.isArray(x)?body.push(...x):body.push(x));

/* ---- cover ---- */
add(
  new Paragraph({spacing:{before:2200,after:0},alignment:AlignmentType.CENTER,
    children:[new TextRun({text:'League Ledger',bold:true,size:76,color:'8A5A00'})]}),
  new Paragraph({spacing:{after:120},alignment:AlignmentType.CENTER,
    children:[new TextRun({text:'A Guide for GMs',size:44,color:'1F2A37'})]}),
  new Paragraph({spacing:{after:60},alignment:AlignmentType.CENTER,
    children:[new TextRun({text:'hopefullyitwill.work',size:24,font:'Consolas',color:'6B7280'})]}),
  new Paragraph({spacing:{after:1400},alignment:AlignmentType.CENTER,
    children:[new TextRun({text:'Contracts, the cap, the auction, trades and your nightly lineup',
      size:21,italics:true,color:'6B7280'})]}),
  new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:2000},
    children:[new TextRun({text:'Everything in this guide is something you can do yourself. '
      +'Nothing here needs the commissioner.',size:21,color:'4B5563'})]}),
  new Paragraph({children:[new PageBreak()]})
);

/* ---- contents ---- */
add(H1('Contents'),
  new TableOfContents('Contents',{hyperlink:true,headingStyleRange:'1-2'}),
  new Paragraph({children:[new PageBreak()]}));

/* ======================= 1. BEFORE YOU START ======================= */
add(H1('1. Before you start'));
add(P('League Ledger is the ledger for our nine-team dynasty league. It holds every contract, '
  +'works out the cap and the tax for you, runs the auction and the rookie draft, takes trade '
  +'offers between clubs, and sets your nightly lineup once the season is live.'));
add(P('It is one web page. There is nothing to install, it works on a phone, and everything you '
  +'do is shared with the whole league the moment you do it.'));

add(H2('Signing in'));
add(NUM(['Open ',['hopefullyitwill.work',2],' and press ',['Sign in',1],' at the top right.']));
add(NUM(['Pick your club from the list.']));
add(NUM(['Type the PIN the commissioner gave you and press ',['Sign in',1],'.']));
add(shot('sign-in.jpg','The sign-in box. Pick your club, type your PIN.'));
add(P(['Your browser remembers you, so you should only have to do this once per device. You can '
  +'change your PIN yourself later — see ',['Settings',1],' at the end of this guide.']));
add(note('Be honest — the PINs are not real security',
  'Anyone who views the page source can read every PIN. They exist to prevent accidents and to '
  +'keep an audit trail, not to stop a determined league-mate. Every move you make is written to '
  +'the transaction log with your club’s name against it, and everyone can read it.','warn'));

/* ======================= 2. FINDING YOUR WAY ======================= */
add(new Paragraph({children:[new PageBreak()]}));
add(H1('2. Finding your way around'));
add(shot('header.jpg','The top of every page.'));
add(P('Three lines sit above every screen:'));
add(BULLET([['The top line',1],' — the app name, the league year, a connection chip, who you are '
  +'signed in as, Sign out, and a button that switches between the light and dark look.']));
add(BULLET([['Stats shown',1],' — the most useful control in the app. See below.']));
add(BULLET([['The tabs',1],' — six main ones, and everything else under ',['More',1],'.']));

add(note('Check the connection chip',
  'Next to the league year it should read “shared · rev …”. That means you are '
  +'connected to the league database and everyone can see your moves. If it ever says “this '
  +'device only”, stop and tell the commissioner — your changes are not reaching anybody.','bad'));

add(H2('The “Stats shown” switch'));
add(P('This changes the numbers in every table in the app at once. Three choices:'));
add(table(['Setting','What you are looking at'],[
  ['2025–26 actuals','What actually happened last season. The record.'],
  ['2026–27 aggregate','The commissioner’s projection set for the season ahead. The same numbers for every GM, so an argument about a player is an argument about the same figures.'],
  ['My projections','Your own edits, laid on top. Only you see these. Numbers you have changed are marked in amber.']
],[2600,7480]));
add(SPACER());
add(P('Whichever you pick follows you around the app — the rater, the auction, the trade '
  +'machine and the what-if roster all use it.'));

add(H2('Tabs come and go with the season'));
add(P('The app knows whether the league is in the offseason or in season, and hides what does not apply:'));
add(table(['Only in the offseason','Only in season'],[
  ['Auction','Quick sign'],['Free agent classes',''],['Rookie draft','']
],[5040,5040]));
add(SPACER());
add(P('If a tab you were expecting is missing, that is why.'));

/* ======================= 3. MY TEAM ======================= */
add(new Paragraph({children:[new PageBreak()]}));
add(H1('3. My Team'));
add(P(['This is the tab you will live in. It is your club: your cap position, your roster, your '
  +'bids, your lineup and the free agents you can sign. ',
  ['Everything you can actually do to your team is on this one page.',1]]));
add(shot('my-team-offseason.jpg','My Team, in the offseason.'));

add(H2('3.1 Your cap position'));
add(shot('my-team-header.jpg'));
add(P('The strip at the top of My Team is the summary you will check most often:'));
add(BULLET([['Salary cap ($165.00)',1],' — a ',['soft',3],' cap. You may go past it, but only using '
  +'Bird rights, Early Bird, the mid-level exception, or minimum contracts.']));
add(BULLET([['Luxury tax ($200.50)',1],' — a ',['hard',3],' cap. Nothing beats it. Not Bird rights, '
  +'not anything. The app will refuse a move that would take you past it.']));
add(BULLET([['Spots open',1],' — you may carry 15 players. In season you may carry a sixteenth, '
  +'but only while one of them is on the injured reserve.']));
add(BULLET([['Game slots used',1],' — see the box below. This one is easy to forget.']));
add(note('The 920-game cap',
  'Each club is capped at 920 total player-games in a season. That means a player’s per-game '
  +'rate matters far more than how many games he plays: once you are at the cap, the extra games '
  +'are simply thrown away. A 78-game player is worth very little more than a 70-game player if '
  +'your slots are already full.'));

add(H2('3.2 My roster'));
add(shot('my-roster.jpg','Every player you have signed, with the buttons that act on him.'));
add(P('Click any column heading to sort. Each row carries the moves you can make:'));
add(BULLET([['Cut',1],' — releases the player. Read the next box before you use it.']));
add(BULLET([['Block',1],' — lists him on the league-wide trade block so other GMs know he is '
  +'available. It is only an advertisement; it does not commit you to anything, and it does not '
  +'follow him if he is traded.']));
add(BULLET([['IR',1],' — in season only, moves him to the injured reserve.']));
add(BULLET([['Export CSV',1],' — your roster as a spreadsheet.']));
add(note('Cutting a player has consequences — read this before you do it',
  'In season, his salary stays on your cap until the season ends. In the offseason it comes off '
  +'immediately and the remaining years are voided. And if you release a man for MORE than the '
  +'league minimum, you cannot sign him back for the rest of that season or the offseason that '
  +'follows — cutting a $13.75 contract and buying it back at $1.00 is a renegotiation, not a '
  +'release. Every other club may sign him freely. The app will tell you exactly why if you try.','bad'));

add(H2('3.3 Tonight’s lineup (in season)'));
add(P('Once the season is live, a block appears on My Team for the night’s lineup. Fifteen '
  +'players start: one C, four G, four F and six UTIL. Everyone else sits on the bench, and the '
  +'injured reserve is separate again.'));
add(shot('lineup.jpg','Tonight’s lineup. Slots at the top, bench below, IR at the bottom.'));
add(H3('How to set it'));
add(NUM(['Use the dropdown in each slot to pick an eligible player. A guard can fill a G slot; '
  +'UTIL takes anybody.']));
add(NUM([['Start all',1],' fills every open slot from your bench, scarcest position first. ',
  ['Bench all',1],' is the opposite.']));
add(NUM(['A bench player’s dropdown offers only the slots he actually fits. If none fit, it '
  +'says so rather than giving you a control that cannot work.']));
add(NUM(['The ',['IR',1],' button on any row moves a player to the injured reserve and clears his '
  +'slot in the same step.']));
add(note('The lock is per game, not league-wide',
  'A player freezes the moment HIS OWN game tips off. A five o’clock game locks that man at '
  +'five and leaves his team-mate on a half-seven game free for another two and a half hours. '
  +'A locked player is shown as plain text with no dropdown. An unlocked starter shows his '
  +'tip-off time, so you know your deadline without doing the arithmetic.','warn'));
add(P(['Your lineup ',['carries forward',1],' until you change it — you do not have to set it '
  +'again every night, which is what you want when you are away.']));
add(note('Nightly stat accrual is not built yet',
  'The slots, the eligibility and the lock are all real. But nothing yet counts a night’s box '
  +'score against your started players — that needs the nightly stats feed. The numbers beside '
  +'each player are his per-game line, not tonight’s box score, and the screen says so. Setting '
  +'your lineup does not move the standings today.'));

add(H2('3.4 On the block — how you bid at auction'));
add(P(['This is the part people hunt for. During the offseason auction, ',
  ['the bidding happens here on My Team',1],', not on the Auction tab. The Auction tab is the '
  +'room — who is up, the bid history, what everyone has left. The box below is where you bid.']));
add(shot('bid-panel.jpg','The bid box, and what the player would do to your categories.'));
add(NUM(['Use ',['−',1],' and ',['+',1],' to move your bid in 25-cent steps, then press ',['Bid',1],'.']));
add(NUM([['Max bid',1],' is a proxy: type the most you would go and the app bids for you, one step '
  +'at a time, only as far as it needs to. It never bids past the runner-up.']));
add(NUM(['The green line tells you the most you may bid on this player under the cap rules. If it '
  +'says you may not bid at all, the reason is a cap, roster or release rule — the app will '
  +'spell it out.']));
add(NUM(['Below the box, the card shows what he would do to each of your nine categories, and the '
  +'roto points it would be worth. Green is better, red is worse.']));
add(note('You cannot bid against yourself',
  'If you already hold the high bid the app will say so rather than take your money twice.'));

add(H2('3.5 What-if roster'));
add(shot('what-if-roster.jpg','A sandbox on top of your club. Nothing here touches the league.'));
add(P(['Load your roster with ',['Load my team',1],', then add and drop anyone in the pool to see '
  +'what it would do to your category totals. Use it to answer “if I win this man, where does '
  +'that leave me?” before you spend the money. ',
  ['Nothing you do here is saved to the league or visible to anybody else.',1]]));

add(H2('3.6 Available free agents'));
add(shot('free-agents-sign.jpg','The free agent list, with the Sign button on the right of each row.'));
add(P(['Search, filter by position, or add a stat filter. Click any player to open his full card. '
  +'The ',['Max bid',1],' column shows what you could commit to him.']));
add(P([['In season',1],', each row carries a ',['Sign',1],' button. Every such signing is one year '
  +'at the league minimum, and the calendar decides what rights you get:']));
add(table(['When you sign him','What you get'],[
  ['Before the trade deadline','Early Bird rights — you finish the year with him, and that is what the rulebook asks of Early Bird.'],
  ['After the trade deadline','Nothing. A rental: one year, no rights, gone in the summer.']
],[3200,6880]));
add(SPACER());
add(note('In the offseason there is no Sign button, and that is deliberate',
  'In the offseason a club adds players by winning them at auction or drafting them. Signing one '
  +'directly would be going round the room, so the app does not offer it.'));

/* ======================= 4. AUCTION ======================= */
add(new Paragraph({children:[new PageBreak()]}));
add(H1('4. Auction'));
add(P([['Offseason only.',1],' The auction room: who is on the block, what the bidding has done, '
  +'what every club has left to spend, and your own private target board. Remember that you place '
  +'your bids on My Team — see 3.4.']));
add(shot('auction.jpg','The auction room.'));

add(H2('Nominating'));
add(P(['The order is a ',['snake',1],'. The commissioner sets round one; round two runs backwards, '
  +'round three forwards again, so the club at each end nominates twice in a row.']));
add(BULLET(['The chip tells you who is on the clock and which round it is.']));
add(BULLET(['Only the club on the clock may put a player up. When it is your turn a box appears: '
  +'type a name, set an opening bid, and press ',['Put on the block',1],'.']));
add(BULLET(['A club already carrying 15 players is skipped rather than waited on — it cannot '
  +'sign anybody, so blocking the room on it would stall the auction.']));
add(BULLET(['You cannot nominate a player you would not be allowed to sign.']));

add(H2('Who wins him'));
add(P(['When the bidding is done ',['the commissioner awards the player',1],'. GMs do not close '
  +'their own lots. If the player is ',['restricted',1],', the club holding matching rights is '
  +'asked first — and that question is put to that GM in the app, with Match and Decline '
  +'buttons. Bidding is closed while he decides.']));

add(H2('Your strategy board'));
add(shot('auction-strategy.jpg','Private to you.'));
add(P(['Rank the players you want, flag how badly you want each one, and note the most you would '
  +'go. ',['That max is a planning figure only',1],' — it places no bid, sets no automatic bid '
  +'and binds nothing. The board is stored under your sign-in and follows you between your phone '
  +'and your laptop. No other GM, and not the commissioner, can read it.']));
add(P('Each row is tagged with the club that holds the player and what it holds him with — '
  +'Bird, Early Bird or restricted — so you can rank him against the right you would be '
  +'bidding into.'));

/* ======================= 5. CONTRACTS ======================= */
add(new Paragraph({children:[new PageBreak()]}));
add(H1('5. Contracts'));
add(P('Every club’s payroll on one screen, and then any single club in full. This is the tab '
  +'to open when you want to know who can afford what.'));
add(shot('contracts.jpg','Payroll bars for all nine clubs, then the club you clicked.'));
add(BULLET(['Each bar shows committed salary against the cap line and the hard-cap line, with the '
  +'headcount on the right.']));
add(BULLET(['Click a club to see its full contract table underneath: salary this season and the '
  +'two after, term, the year the player was acquired, and his rights.']));
add(BULLET([['expiring',1],' means nobody has committed a dollar to him for next season — he '
  +'is in the auction pool even though he is sitting on a roster today.']));
add(BULLET(['On your own club the rows also carry Cut and Block. On anybody else’s they do not.']));

/* ======================= 6. PLAYER RATER ======================= */
add(H1('6. Player rater'));
add(P('Every player in the pool, sortable on any column, with a rating that puts all nine '
  +'categories on one scale.'));
add(shot('player-rater.jpg','The rater. Click any heading to sort; click any name for the card.'));
add(P(['The rating is a nine-category z-score against the whole pool, with FG% and FT% weighted by '
  +'attempts — so a high volume of bad free throws hurts you proportionally, which is how it '
  +'actually works in a roto league. Positive is above the pool average.']));
add(P('Click any player name, anywhere in the app, to open his card:'));
add(shot('player-card.jpg','The player card, reachable from every table.'));
add(P(['The card shows his line, his rating, who holds him, and lets you type your own projection '
  +'for him. Those edits are yours alone and feed the ',['My projections',1],' setting in the header.']));

/* ======================= 7. TRADES ======================= */
add(H1('7. Trades'));
add(shot('trades.jpg','The trade machine.'));
add(H2('Building one'));
add(NUM(['The tab opens with the league-wide trade block. Filter it by club or name, and press ',
  ['Add to trade',1],' on anybody who interests you — his club goes on the far side and yours '
  +'on the near one, so you are always looking at what you would give up.']));
add(NUM(['Or pick the two clubs yourself and tick players and picks on each side.']));
add(NUM(['Press ',['Stats',1],' on any row to open that player’s card without losing your place.']));
add(NUM(['Watch the two footers: what each side sends, the most it may take back, its payroll '
  +'after, and its room to the tax.']));
add(NUM(['Below the builder, the category table shows what each side sends across all nine '
  +'categories and the net swing for each club.']));
add(note('Two things about the category table',
  'Turnovers invert — a club shedding them is gaining ground, so the colours are the other way '
  +'round for TO. And percentages do not net: FG% and FT% are attempt-weighted and cannot be added '
  +'across clubs, so they are shown per side and the net row is deliberately blank.'));

add(H2('Proposing one'));
add(P(['You may ',['build',1],' any trade you like, including one between two other clubs — '
  +'working out what a rival deal would do is as useful as working out your own. But you may only '
  +['propose',1],' a trade your own club is in. The Propose button is switched off otherwise and '
  +'says why.']));
add(P(['Once you propose it, the other GM sees it on his Trades tab under ',['Open offers',1],'. '
  +'He can accept, reject, or counter. You can also email the offer to him as a nudge.']));
add(note('Trades are re-checked when they are accepted',
  'Rosters move between an offer being made and answered, so the app validates salary matching, '
  +'the hard cap, the roster limit and every pick again at the moment of acceptance. An offer that '
  +'was legal on Monday can be refused on Wednesday, and it will tell you why.','warn'));
add(P(['You can trade the ',['rights',1],' you hold to an expiring player — Bird, Early Bird or '
  +'restricted — and the rights travel with him. Those players move $0, so they do not touch '
  +'salary matching. You can also trade rookie draft picks, this year’s and future ones, and '
  +'the club sending a future pick sets any protection on it in the builder.']));

/* ======================= 8. FREE AGENT CLASSES ======================= */
add(new Paragraph({children:[new PageBreak()]}));
add(H1('8. Free agent classes'));
add(P([['Offseason only.',1],' The whole free agent class, sorted into groups, so you can plan '
  +'the auction rather than react to it.']));
add(shot('free-agent-classes.jpg','Every expiring contract, grouped.'));
add(P(['A player is a free agent when ',['nobody has committed a dollar to him for next season',1],
  ' — which includes the players sitting on a roster today in the last year of a deal. Those are '
  +'the ones worth knowing about, and they are easy to miss.']));
add(BULLET([['Restricted',1],' players finished the last year of a team, player or rookie option. '
  +'Their club sits out the bidding and then decides whether to match the winning bid.']));
add(BULLET([['Bird',1],' and ',['Early Bird',1],' tags tell you the club can exceed the cap to '
  +'keep him, so expect to pay more than his rating suggests.']));
add(BULLET(['Click any row for the full card.']));

/* ======================= 9. ROOKIE DRAFT ======================= */
add(H1('9. Rookie draft'));
add(P([['Offseason only.',1],' One pick each, in reverse order of finish — the champion picks last.']));
add(shot('rookie-draft.jpg','The rookie draft board and the players still available.'));
add(BULLET(['Every selection is three years at the salary attached to that slot, with a rookie '
  +'option on the last year.']));
add(BULLET(['Rookies sign after the auction and do not consume auction cap space — but the hard '
  +'cap still binds, so a club with no room passes.']));
add(BULLET(['Anyone nobody takes becomes an ordinary free agent and turns up in the auction.']));
add(BULLET(['When you are on the clock, pick your man from the list. If you cannot fit the pick, '
  +'you pass, and passing consumes the pick.']));
add(note('The rookie class you can see is placeholder data',
  'It is there so the draft can be set up and rehearsed. The real class arrives with the stats '
  +'feed; nothing else about the draft changes when it does.','warn'));

/* ======================= 10. QUICK SIGN ======================= */
add(H1('10. Quick sign'));
add(P([['In season only.',1],' A faster way to make the same in-season signing you can make from '
  +'My Team — useful when you know exactly who you want.']));
add(shot('quick-sign.jpg','Quick sign: the player, the club, and terms you cannot change.'));
add(P(['There is nothing to negotiate, so there is nothing to type: an in-season signing is ',
  ['one year at the league minimum',1],', and the calendar decides whether it carries Early Bird '
  +'rights. The form shows you the terms and the pool below is searchable and filterable.']));

/* ======================= 11. CHAT & NOTES ======================= */
add(H1('11. Chat & notes'));
add(shot('chat-notes.jpg','League chat above, your own notes below.'));
add(P('Two things share this tab, and the split is the point.'));
add(BULLET([['League chat',1],' is public to everybody who can open the app. Talk trash, float '
  +'trades, argue about the rater. You can delete your own posts.']));
add(BULLET([['My notes',1],' is the opposite: nobody else can read it. It is stored under your '
  +'sign-in and follows you between devices, so you can start a thought on your phone and '
  +'finish it on your laptop.']));

/* ======================= 12. MY PROJECTIONS ======================= */
add(H1('12. My projections'));
add(shot('my-projections.jpg','Your own numbers, for every player you care to edit.'));
add(P(['Edit any player’s line and the whole app will use your number wherever you have the '
  +'header set to ',['My projections',1],'. Everything you have changed is marked in amber so you '
  +'can always tell your guess from the record.']));
add(P('Your projections are yours alone — no other GM and not the commissioner can see them — '
  +'and, like your notes and your auction board, they follow you between devices.'));

/* ======================= 13. TEAM TRENDS ======================= */
add(H1('13. Team trends'));
add(shot('team-trends.jpg','Where every club is strong and where it has a hole.'));
add(P('The category profile ranks all nine clubs in each of the nine categories, per player-game '
  +'so that rosters which lost time to injury still compare fairly. Green is a strength, red is '
  +'a hole. The rating on the right is the sum of a club’s ten best players.'));
add(P('Read it before the auction to find out what the league is short of — that is usually '
  +'where the value is.'));
add(P(['The rolling 15-day chart below it is built and waiting on the nightly stats feed. It will '
  +'fill in on its own once that lands.']));

/* ======================= 14. LEAGUE HISTORY ======================= */
add(H1('14. League history'));
add(shot('league-history.jpg','Every season the league has played.'));
add(P('Champions, banners, and an all-time table: seasons played, titles, top-three finishes, '
  +'average finish and roto points. Settle an argument with it.'));

/* ======================= 15. TRANSACTIONS ======================= */
add(H1('15. Transactions'));
add(shot('transactions.jpg','The league’s append-only record.'));
add(P('Every signing, cut, trade, nomination and award, newest first, with the club that did it '
  +'and when. Nothing is ever quietly changed: if it happened, it is here.'));

/* ======================= 16. CAP RULES ======================= */
add(H1('16. Cap rules'));
add(shot('cap-rules.jpg','The rulebook, as the app enforces it.'));
add(P('The rules in plain language, in the app, so you never have to go looking for the rulebook '
  +'mid-auction.'));

/* ======================= 17. SETTINGS ======================= */
add(H1('17. Settings'));
add(shot('settings.jpg','Your club’s name, your email and your PIN.'));
add(BULLET([['Club name',1],' — rename your club. Your roster, your picks, your open offers and '
  +'your place in the nomination order all come with you. The transaction log keeps the old '
  +'name, because it is the record of what happened at the time.']));
add(BULLET([['Email',1],' — the address the league writes to, and whether you want the daily '
  +'digest of the previous day’s moves. Press ',['Send a test',1],' to check it works.']));
add(BULLET([['PIN',1],' — change your own. You need your current one; if you have forgotten it, '
  +'the commissioner can reset it for you.']));
add(note('Email addresses are stored with the rosters',
  'Like the PINs, anyone who can reach the league database can read them. Use an address you are '
  +'happy for the league to see, not one tied to anything else.','warn'));

/* ======================= 18. THE RULES ======================= */
add(new Paragraph({children:[new PageBreak()]}));
add(H1('18. The rules the app enforces for you'));
add(P('You do not have to memorise these — the app refuses moves that break them and tells you '
  +'why. They are here so the refusal makes sense when you see it.'));
add(table(['Rule','How it works'],[
  ['Salary cap — $165.00','Soft. Exceed it only via Bird rights, Early Bird, the mid-level exception, or minimum contracts.'],
  ['Luxury tax — $200.50','A hard cap. Nothing beats it, including Bird rights.'],
  ['Roster','15 active. In season you may carry a 16th only while one man is on the IR. Activating him when you are full asks you which player to release.'],
  ['Bird rights','Three completed seasons with one club. It does not matter how he arrived — free agency, the rookie draft or the auction all start the clock. The rights travel with him in a trade; any other change of club starts the clock again.'],
  ['Early Bird','Signed mid-season before the deadline and finished the year with you. Worth $7.00 over the cap.'],
  ['Restricted free agents','Only players who finished the last year of a team, player or rookie option. Their club sits out the bidding, then chooses whether to match.'],
  ['Mid-level exception','Once a year. $5.50 over the cap, $3.25 under. Consumed when used.'],
  ['Trade matching','Over the cap, what you can take back is limited by what you send: 150% of outgoing up to $9.75; outgoing + $5.00 from $10.00 to $19.50; 125% from $19.75 up.'],
  ['Cutting — in season','His salary stays on your cap until the season ends, then clears. It never carries into the next year.'],
  ['Cutting — offseason','Salary comes off immediately and the remaining years are voided.'],
  ['Buying back a man you cut','If you released him above the minimum, you cannot sign him back for the rest of that season or the offseason that follows. Every other club may.'],
  ['920 player-games','Each club is capped at 920 total player-games in a season. Per-game rate beats availability.']
],[2600,7480]));

/* ======================= 19. GOTCHAS ======================= */
add(new Paragraph({children:[new PageBreak()]}));
add(H1('19. Things that catch people out'));
const gotcha=(q,a)=>{ add(H3(q)); add(P(a)); };
gotcha('I cannot find where to bid.',
  'Bids are placed on My Team, under “On the block”. The Auction tab is the room — who is up, the '
  +'bid history, what everyone has left, and your private board.');
gotcha('A tab has disappeared.',
  'Auction, Free agent classes and Rookie draft are offseason-only. Quick sign is in-season only. '
  +'The app hides what does not apply.');
gotcha('A player on somebody’s roster is listed as a free agent.',
  'That is right. A player is a free agent when nobody has committed money to him for NEXT season, '
  +'even though he is on a roster today. Those expiring men are in the auction pool, and they are '
  +'the ones most people forget to plan for.');
gotcha('The app says I cannot sign a player I cut.',
  'If you released him for more than the league minimum, you cannot buy him back for the rest of '
  +'that season or the offseason after it. Every other club can. Your barred players are listed on '
  +'the Auction tab so you know before you plan around one.');
gotcha('My club shows Bird rights on a player and the app disagrees.',
  'Bird rights are earned by three completed seasons with your club, counted from the year he was '
  +'acquired — not by what the old spreadsheet’s rights column says. If the two disagree for one of '
  +'your players, tell the commissioner and he can correct the year acquired.');
gotcha('The Propose button is greyed out.',
  'Either the trade is not legal yet — check the two footers for the reason — or it is a trade '
  +'your club is not in. You may build any trade, but only propose one of your own.');
gotcha('I set my lineup and the standings did not move.',
  'They will not yet. The slots, the eligibility and the lock are all real, but counting a night’s '
  +'box score against your starters needs the nightly stats feed, which is not built. The screen '
  +'says so rather than pretending otherwise.');
gotcha('I cannot move a player in my lineup.',
  'His game has tipped off. The lock is per game — a player freezes when HIS game starts, not at '
  +'some league-wide deadline. Locked players show as plain text instead of a dropdown.');
gotcha('Do I have to set my lineup every night?',
  'No. It carries forward until you change it.');
gotcha('Can anyone see my projections, my notes or my auction board?',
  'No. All three are private to you and follow you between your devices. Everything else you do — '
  +'signings, cuts, bids, trades, chat — is shared with the whole league and logged.');

/* ---- colophon ---- */
add(new Paragraph({children:[new PageBreak()]}));
add(H1('About this guide'));
add(P('Written for the GMs of the league. It covers only what a GM can do; the commissioner’s '
  +'tools are deliberately left out.'));
add(P(['The screenshots are taken from the real app, signed in as a GM, in both the offseason and '
  +'a live season. They were captured by ',['docs/build-gm-guide.js',2],' and the shooting '
  +'scripts alongside it, so the guide can be rebuilt whenever a screen changes.']));
add(P([['Numbers in the screenshots are the seed data',3],', not the live league — treat them as '
  +'an illustration of the layout, not as anybody’s real payroll.']));

/* ======================= BUILD ======================= */
const doc=new Document({
  creator:'League Ledger',
  title:'League Ledger — A Guide for GMs',
  description:'How to use League Ledger, for the GMs of the league',
  numbering:{config:[
    {reference:'bul',levels:[
      {level:0,format:LevelFormat.BULLET,text:'•',alignment:AlignmentType.LEFT,
       style:{paragraph:{indent:{left:400,hanging:220}}}},
      {level:1,format:LevelFormat.BULLET,text:'◦',alignment:AlignmentType.LEFT,
       style:{paragraph:{indent:{left:760,hanging:220}}}}]},
    {reference:'num',levels:[
      {level:0,format:LevelFormat.DECIMAL,text:'%1.',alignment:AlignmentType.LEFT,
       style:{paragraph:{indent:{left:400,hanging:220}}}}]}
  ]},
  styles:{default:{document:{run:{font:'Calibri',size:21,color:'1F2A37'}}},
    paragraphStyles:[
      {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,
       run:{size:32,bold:true,color:'8A5A00',font:'Calibri'},
       paragraph:{spacing:{before:360,after:140},
         border:{bottom:{style:BorderStyle.SINGLE,size:6,color:'E2C89A',space:6}}}},
      {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,
       run:{size:26,bold:true,color:'1F2A37',font:'Calibri'},
       paragraph:{spacing:{before:280,after:110}}},
      {id:'Heading3',name:'Heading 3',basedOn:'Normal',next:'Normal',quickFormat:true,
       run:{size:22,bold:true,color:'3E5C86',font:'Calibri'},
       paragraph:{spacing:{before:220,after:80}}}]},
  sections:[{
    properties:{page:{size:{width:12240,height:15840},
      margin:{top:1080,right:1080,bottom:1080,left:1080}}},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,
      children:[new TextRun({text:'League Ledger — A Guide for GMs   ·   ',size:17,color:'9AA4B2'}),
        new TextRun({children:[PageNumber.CURRENT],size:17,color:'9AA4B2'})]})]})},
    children:body
  }]
});

Packer.toBuffer(doc).then(buf=>{
  fs.writeFileSync(OUT,buf);
  console.log('wrote',OUT,(buf.length/1048576).toFixed(2)+'MB');
});
