const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(read('utils/annual_vote.js'), { module: mod, require: name => {
 if (name === './monthly_vote') return { MONTHLY_VOTE_WEIGHTS: {goals:.3,assists:.2,rating:.5} };
 if (name === './monthly_selection') return { attachSelectionPhotos: async () => {} };
 if (name === './weekly_selection') return { normalizePositionGroup: p => p };
 throw Error(name);
}});
const annual = mod.exports;
const candidates = { GOL:[{id:1,name:'Goleiro',matches:23,score:4}], ZAG:[{id:2,name:'Zagueiro',matches:21,score:3}], MEI:[{id:3,name:'Meia',matches:25,score:5}], ATA:[{id:4,name:'Atacante',matches:20,score:6}] };
const session = { id:1,year:2026,candidates,opensAt:new Date('2026-11-25T03:00:00Z'),expiresAt:new Date('2026-11-27T15:00:00Z') };
const ballot = {id:11,sessionId:1,playerId:10,session,usedAt:new Date(),excludedAt:null,exclusionReason:null};
const picks = [{tokenId:11,category:'MELHOR_JOGADOR',playerId:4},{tokenId:11,category:'GOL',playerId:1}];
function resultDb(tokens=[ballot]) { return {annualVotePick:{findMany:async ({where}) => {
 assert.equal(where.token.sessionId,1);assert.equal(where.token.excludedAt,null);assert(where.token.usedAt.not===null);
 return picks.filter(p=>tokens.some(t=>t.id===p.tokenId&&t.usedAt&&!t.excludedAt));
}}}; }
function handlerFor(route, prisma) {
 const source=read('routes/admin/annual_vote.js');const start=source.indexOf('router.post("'+route+'"');const end=source.indexOf('\n});',start)+4;
 let handler;let auth;
 const scope={...annual,console,prisma,deleteCache:()=>{},requireAdmin:(req,res,next)=>req.admin?next():res.redirect('/login'),adminUrl:(year,params)=>`/admin/annual-vote?year=${year}&${params}`,router:{post:(url,middleware,fn)=>{auth=middleware;handler=fn;}}};
 vm.runInNewContext(source.slice(start,end),scope);return {handler,auth};
}
function moderationDb(token=ballot) {
 const logs=[];const tx={annualVoteToken:{findFirst:async ({where})=>token&&token.id===where.id&&token.sessionId===where.sessionId?token:null,updateMany:async ({where,data})=>{
 const expected=where.excludedAt===null?!token.excludedAt:!!token.excludedAt;
 if(!expected)return {count:0};Object.assign(token,data);return {count:1};}},auditLog:{create:async ({data})=>logs.push(data)}};
 return {logs,$transaction:async fn=>fn(tx)};
}
function response() {return {code:200,status(n){this.code=n;return this;},send(s){this.body=s;return this;},redirect(s){this.location=s;return this;}};}
function req(action='exclude',reason='Voto sem critério') { return {admin:{id:1,email:'admin@example.test'},params:{id:'1',tokenId:'11'},body:{action,reason},originalUrl:'/admin/annual-vote/1/tokens/11/moderate'}; }
const moderationRoute='/annual-vote/:id/tokens/:tokenId/moderate';
test('suggestions require 20 appearances for outfield players, with goalkeeper rule preserved',()=>{
 const ids=Array.from(annual.suggestCandidateIds([{id:21,group:'ATA',matches:19,score:10},{id:22,group:'ATA',matches:20,score:9},{id:23,group:'GOL',matches:2,score:1}]));
 assert.deepEqual(ids,[23,22]);assert.equal(annual.ANNUAL_VOTE_MIN_MATCHES,20);
});
test('exclude and restore entire ballot, preserve used link and audit both actions',async()=>{
 const token={...ballot};const db=moderationDb(token);const {handler}=handlerFor(moderationRoute,db);
 assert.equal((await annual.computeAnnualVoteResult(resultDb([token]),session)).best[0].votes,1);
 await handler(req(),response());assert(token.excludedAt);assert.equal(token.usedAt,ballot.usedAt);assert.equal(token.exclusionReason,'Voto sem critério');
 const excluded=await annual.computeAnnualVoteResult(resultDb([token]),session);assert.equal(excluded.hasVotes,false);assert.equal(excluded.positions[0].ranked[0].votes,0);
 await handler(req('restore',''),response());assert.equal(token.excludedAt,null);assert.equal(token.usedAt,ballot.usedAt);
 assert.equal((await annual.computeAnnualVoteResult(resultDb([token]),session)).best[0].votes,1);
 assert.equal(db.logs.length,2);assert.equal(db.logs[1].action,'ANNUAL_VOTE_RESTORED');assert.equal(db.logs[1].details.reason,'Voto sem critério');
});
test('moderation rejects invalid action, empty reason, cross-session and unused ballot',async()=>{
 for(const mode of ['action','reason','cross','unused']){
  const token={...ballot,usedAt:mode==='unused'?null:ballot.usedAt};const db=moderationDb(token);const {handler}=handlerFor(moderationRoute,db);const r=req();
  if(mode==='action')r.body.action='delete';if(mode==='reason')r.body.reason=' ';if(mode==='cross')r.params.id='2';
  const res=response();await handler(r,res);assert.equal(res.code,400);assert.equal(db.logs.length,0);assert.equal(token.excludedAt,null);
 }
});
test('admin authorization is required and publication stays unavailable before closing',async()=>{
 const {auth}=handlerFor(moderationRoute,moderationDb());const res=response();let next=false;auth({},res,()=>next=true);assert.equal(next,false);assert.equal(res.location,'/login');
 const db={annualVoteSession:{findUnique:async()=>({...session,expiresAt:new Date('2099-01-01')})}};
 const publish=handlerFor('/annual-vote/:id/publish',db);const out=response();await publish.handler({params:{id:'1'}},out);assert(out.location.includes('notClosed'));
});
async function viewData(status='open') {
 const result=await annual.computeAnnualVoteResult(resultDb(),session);
 return {year:2026,session,tokens:[{...ballot,token:'test-only',player:{name:'Eleitor',whatsapp:null},picks:picks.map(p=>({...p,player:{name:'Candidato'}}))}],usedCount:1,excludedCount:0,status,canEditCandidates:false,ranking:[],selectedIds:[1,2,3,4],positions:annual.ANNUAL_POSITIONS,minMatches:20,opensAtValue:'2026-11-25T00:00',expiresAtValue:'2026-11-27T12:00',result,statLeaders:[],publishedCount:0,voteBaseUrl:'http://localhost',annualVoteError:null,annualVoteNotice:null,csrfToken:'test-csrf'};
}
test('admin partial renders charts safely, no premature publication/download and handles empty categories',async()=>{
 const data=await viewData();data.result.best[0].name='Nome </script><script>alert(1)</script>';
 const html=ejs.render(read('views/admin_annual_vote.ejs'),data);
 assert(html.includes('Parcial — somente admin'));assert(!html.includes('id="exportAnnualAwardsBtn"'));assert(!html.includes('/1/publish'));assert(html.includes('Nenhum voto válido nesta categoria.'));
 const json=html.match(/id="annualChartData">([\s\S]*?)<\/script>/)[1];assert.equal(JSON.parse(json).length,5);assert(!json.includes('</script>'));assert(html.includes('name="_csrf"'));
 const closed=ejs.render(read('views/admin_annual_vote.ejs'),await viewData('closed'));assert(closed.includes('/1/publish'));assert(closed.includes('id="exportAnnualAwardsBtn"'));
 const empty=await viewData();empty.session=null;empty.tokens=[];empty.result=null;empty.status='none';empty.canEditCandidates=true;
 assert(ejs.render(read('views/admin_annual_vote.ejs'),empty).includes('20 peladas'));
});
test('annual voting opens at midnight on November 25 and closes at noon on November 27 in Brasilia',()=>{
 assert.equal(annual.getAnnualVoteStatus(session,new Date('2026-11-24T23:59:59-03:00')),'scheduled');
 assert.equal(annual.getAnnualVoteStatus(session,new Date('2026-11-25T00:00:00-03:00')),'open');
 assert.equal(annual.getAnnualVoteStatus(session,new Date('2026-11-27T11:59:59-03:00')),'open');
 assert.equal(annual.getAnnualVoteStatus(session,new Date('2026-11-27T12:00:00-03:00')),'closed');
});
module.exports={viewData};
