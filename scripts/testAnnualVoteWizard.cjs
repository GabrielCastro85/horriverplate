// Entirely isolated: in-memory database and localhost server; no .env or real Prisma.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const ejs = require('ejs');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(read('utils/annual_vote.js'), {module:mod, require: name => {
  if (name === './monthly_vote') return { MONTHLY_VOTE_WEIGHTS:{goals:.3,assists:.2,rating:.5} };
  if (name === './monthly_selection') return {attachSelectionPhotos:async()=>{}};
  if (name === './weekly_selection') return {normalizePositionGroup:p=>p};
  throw Error(name);
}});
const annual = mod.exports;
const ranking = Array.from({length:11}, (_,i)=>({id:i+1,name:`Jogador ${i+1}`,group:['GOL','ZAG','MEI','ATA'][Math.floor(i/2)%4],matches:25,goals:12,assists:7,photos:21,avgRating:8.5,score:10-i/10}));
const candidates = annual.buildAnnualCandidates(ranking.slice(0,8),[1,2,3,4,5,6,7,8]).candidates;
candidates.MELHOR_JOGADOR = ranking.slice(0,10);
const groups = annual.getAnnualBallotGroups(candidates,99);
const best = annual.getAnnualBestCandidates(candidates,99);
const body = {position_GOL:'1',position_ZAG:'3',position_MEI:'5',position_ATA:'7',bestPlayerId:'9'};
test('independent annual shortlist, 10-candidate cap, 20-game suggestion and legacy fallback',()=>{
  assert.equal(annual.buildAnnualCandidates(ranking,[],ranking.map(r=>r.id)).overLimit.key,'MELHOR_JOGADOR');
  assert.equal(annual.buildAnnualCandidates(ranking,[],[9]).candidates.MELHOR_JOGADOR[0].id,9);
  assert.equal(annual.suggestAnnualBestIds(ranking).length,10);
  assert(!annual.suggestAnnualBestIds([{...ranking[0],matches:19}]).length);
  assert(!annual.getAnnualBestCandidates(candidates,9).some(r=>r.id===9));
  const old = {...candidates}; delete old.MELHOR_JOGADOR;
  assert.equal(annual.getAnnualBestCandidates(old).length,8);
});
test('server rejects duplicated, missing, self and unlisted picks, including a sole positional candidate',()=>{
  assert.equal(annual.parseAnnualBallot(body,groups,best).error,null);
  assert(annual.parseAnnualBallot({...body,bestPlayerId:'1'},groups,best).error);
  assert(annual.parseAnnualBallot({...body,bestPlayerId:'11'},groups,best).error);
  assert(annual.parseAnnualBallot({...body,position_GOL:''},groups,best).error);
  assert(annual.parseAnnualBallot(body,annual.getAnnualBallotGroups(candidates,1),best).error);
  assert(annual.parseAnnualBallot({...body,bestPlayerId:'1'},[{...groups[0],options:[ranking[0]]}],best).error);
});
test('apuration uses independent nominees',async()=>{
  const result = await annual.computeAnnualVoteResult({annualVotePick:{findMany:async()=>[{category:'MELHOR_JOGADOR',playerId:9}]}},{id:1,candidates});
  assert.equal(result.best[0].id,9); assert.equal(result.best[0].votes,1);
});
test('mobile and desktop wizard: no early writes, edit, restart, receipt, final confirmation and used-link lock',async()=>{
  let writes=0; const stored=[];
  const token={id:1,playerId:99,player:{id:99,name:'Eleitor de teste'},usedAt:null,session:{year:2026,candidates,opensAt:new Date('2000-01-01'),expiresAt:new Date('2099-01-01')}};
  const db={annualVoteToken:{findUnique:async()=>token,updateMany:async()=>{if(token.usedAt)return {count:0};token.usedAt=new Date();writes++;return {count:1};}},annualVotePick:{createMany:async({data})=>stored.push(...data)}};
  db.$transaction=async fn=>fn(db);
  const route={exports:{}};
  vm.runInNewContext(read('routes/annual_vote.js'),{module:route,console,require:name=>{
    if(name==='express')return express;
    if(name==='express-rate-limit')return ()=> (req,res,next)=>next();
    if(name==='../utils/db')return db;
    if(name==='../utils/annual_vote')return annual;
    if(name==='../utils/monthly_selection')return {attachSelectionPhotos:async()=>{}};
    throw Error(name);
  }});
  const app=express();app.use(express.urlencoded({extended:true}));app.use(express.static(path.join(root,'public')));
  app.use((req,res,next)=>{res.render=(view,data)=>res.send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#09090c;font-family:Arial,sans-serif}*{box-sizing:border-box}</style>'+ejs.render(read(`views/${view}.ejs`),{...data,thumbUrl:p=>p}));next();});
  app.use('/vote',route.exports);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  let browser;
  try {
    browser=await puppeteer.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:390,height:844});const url=`http://127.0.0.1:${server.address().port}/vote/test`;
    await page.goto(url,{waitUntil:'networkidle0'});
    const dir=path.join(root,'.cache','annual-wizard');fs.mkdirSync(dir,{recursive:true});
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));await page.screenshot({path:path.join(dir,'welcome-mobile.png'),fullPage:true});
    const next=()=>page.click('[data-screen]:not([hidden]) [data-next]');
    await next();assert(await page.$eval('#avStart',e=>e.disabled));await page.click('#avUnderstood');await next();
    for(const [key,id] of [['GOL',1],['ZAG',3],['MEI',5],['ATA',7]]){await next();await page.click(`input[name="position_${key}"][value="${id}"]`);await next();}
    await next();assert(await page.$eval('input[name=bestPlayerId][value="1"]',e=>e.disabled));
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));await page.screenshot({path:path.join(dir,'best-mobile.png'),fullPage:true});
    await page.click('input[name=bestPlayerId][value="9"]');await next();assert.equal(writes,0);
    assert.equal(await page.$$eval('.av-receipt-row',e=>e.length),5);
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));await page.screenshot({path:path.join(dir,'review-mobile.png'),fullPage:true});
    await page.click('[aria-label="Trocar voto: Melhor goleiro"]');await page.click('input[name=position_GOL][value="2"]');
    assert.equal(await page.$eval('input[name=bestPlayerId][value="1"]',e=>e.disabled),false);
    while(await page.$eval('[data-screen]:not([hidden])',e=>e.dataset.screen)!=='review')await next();
    await page.click('#avRestart');assert.equal(await page.$$eval('input[type=radio]:checked',e=>e.length),0);assert.equal(writes,0);
    for(const [key,id] of [['GOL',1],['ZAG',3],['MEI',5],['ATA',7]]){await next();await page.click(`input[name="position_${key}"][value="${id}"]`);await next();}
    await next();await page.click('input[name=bestPlayerId][value="9"]');await next();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.setViewport({width:1365,height:900});await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));await page.screenshot({path:path.join(dir,'review-desktop.png'),fullPage:true});
    await Promise.all([page.waitForNavigation(),page.click('#avSubmit')]);
    assert((await page.content()).includes('Votação computada!'));assert.equal(writes,1);assert.equal(stored.length,5);
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));await page.screenshot({path:path.join(dir,'success-desktop.png'),fullPage:true});
    await page.goto(url);assert((await page.content()).includes('Este link já foi usado'));
    const retry=await fetch(url,{method:'POST',body:new URLSearchParams(body)});assert((await retry.text()).includes('Este link já foi usado'));assert.equal(writes,1);
    assert.deepEqual(errors,[]);
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});
