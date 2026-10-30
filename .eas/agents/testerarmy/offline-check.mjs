import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, glob, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, run } from 'e2e/runner';
import { easSimulators } from '@e2e-dev/eas';

assert.equal(process.version, 'v22.23.1');
assert.equal(process.versions.bun, undefined);
globalThis.fetch = async () => { throw new Error('Unexpected network request blocked by offline verification.'); };
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(packageDirectory, '../../..');
const directory = await mkdtemp(join(tmpdir(), 'testerarmy-offline-'));
const counters = { runtime: process.version, network: false, model: false, device: false, assertions: 0 };
const verify = (condition, message) => { assert.ok(condition, message); counters.assertions++; };
const uuid = (digit) => `00000000-0000-4000-8000-${digit.repeat(12)}`;
try {
  await symlink(join(packageDirectory, 'node_modules'), join(directory, 'node_modules'), 'dir');
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(join(directory, 'loader.config.ts'), "export default { targets: [{name:'offline',platform:'ios'}], tests: 'none.e2e.ts' };\n");
  await writeFile(join(directory, 'none.e2e.ts'), "import {test} from 'e2e'; test('loader bootstrap',()=>{});\n");
  await list({ cwd: directory, config: join(directory, 'loader.config.ts') });
  const { finalizeSubscription, oauthSchema, seedSubscription, persistSubscription, subscriptionConfig, runnerEnvironment } = await import('./auth.ts');
  const { ownedProvider, reconcileOwned, ledgerSchema, readLedger } = await import('./provider.ts');
  const { admitReport, admitEvidence, artifactBytes, parseReport, verifyReplay } = await import('./report.ts');
  const { testerArmyResultSchema, toolVersions, publicationStatus } = await import('./result.ts');
  const { stageTesterArmyEvidence } = await import('./evidence.ts');
  const { targetSchema, digest } = await import('../result.ts');
  const { identityLabel, verifyBuild } = await import('../simulator.ts');
  const { admitWorkerReport, runWorker, verifyRuntimePins } = await import('./controller.ts');
  await verifyRuntimePins();
  const { createOAuthFetch } = await import('./node_modules/e2e/dist/oauth/fetch.js');
  const { FileCredentialStore } = await import('./node_modules/e2e/dist/oauth/store.js');
  const credential = { openai: { access: 'synthetic-access', refresh: 'synthetic-refresh', expires: 1_700_000_000_000, accountId: 'synthetic-account' } };
  const seed = join(directory, 'seed.json');
  await writeFile(seed, JSON.stringify(credential));
  verify(!oauthSchema.safeParse({ auth_mode: 'chatgpt', tokens: {} }).success, 'Codex shape is rejected.');
  for (const bad of [{...credential, extra: true}, {openai: {...credential.openai, expires: 1_700_000_000}}, {openai: {...credential.openai, access: ''}}, {openai: {...credential.openai, apiKey:'no'}}]) verify(!oauthSchema.safeParse(bad).success, 'Strict OAuth schema refuses extra providers, keys, seconds, and empty tokens.');
  for (const key of ['E2E_OAUTH_CREDENTIALS', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_AUTH_TOKEN', 'E2E_CACHE_DIR']) assert.throws(() => subscriptionConfig({ TESTERARMY_OAUTH_JSON: seed, AGENT_AUTH_WRITE_TOKEN: 'synthetic-writer', [key]: '' }));
  const xdg = join(directory, 'xdg');
  const file = await seedSubscription(seed, xdg);
  verify(((await lstat(file)).mode & 0o777) === 0o600 && ((await lstat(xdg)).mode & 0o777) === 0o700, 'Private writable XDG credentials.');
  const env = runnerEnvironment({PATH:process.env.PATH, EXPO_TOKEN:'synthetic-developer', AGENT_AUTH_WRITE_TOKEN:'writer', AGENT_GITHUB_WRITE_TOKEN:'github', CODEX_AUTH_JSON:'/never/read'}, directory, xdg);
  verify(!('AGENT_AUTH_WRITE_TOKEN' in env) && !('AGENT_GITHUB_WRITE_TOKEN' in env) && !('CODEX_AUTH_JSON' in env), 'Worker allowlist removes writer and Codex auth variables.');
  const capture = join(directory, 'capture.mjs');
  await writeFile(capture, 'import fs from "node:fs";fs.appendFileSync(process.env.CAPTURE,JSON.stringify({args:process.argv.slice(2),token:process.env.EXPO_TOKEN})+"\\n");');
  const eas = { file: process.execPath, args: [capture] };
  await writeFile(capture, `import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(join(directory,'writes.jsonl'))},JSON.stringify({args:process.argv.slice(2),token:process.env.EXPO_TOKEN})+'\\n');`);
  const persist = () => persistSubscription({file,eas,cwd:directory,env:{PATH:process.env.PATH,AGENT_AUTH_WRITE_TOKEN:'synthetic-writer'}});
  await persist();
  const store = new FileCredentialStore(file);
  const refreshing = createOAuthFetch({ id:'openai', name:'Synthetic subscription', refresh:async () => ({...credential.openai,access:'synthetic-renewed',refresh:'synthetic-rotated',expires:Date.now()+600000}) }, { store, userAgent:'offline', fetch:async () => new Response('{}') });
  await refreshing('https://synthetic.invalid/responses');
  await persist();
  verify(JSON.parse(await readFile(file,'utf8')).openai.refresh === 'synthetic-rotated', 'Production OAuth fetch persists rotated file credentials.');
  const writes = (await readFile(join(directory,'writes.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  verify(writes.length === 2 && writes.every(({args,token}) => args.includes('TESTERARMY_OAUTH_JSON') && !args.includes('CODEX_AUTH_JSON') && token === 'synthetic-writer'), 'Fixed variable writeback is used before and after refresh.');
  await assert.rejects(persistSubscription({file,eas:{file:process.execPath,args:['-e','process.exit(1)','--']},cwd:directory,env:{AGENT_AUTH_WRITE_TOKEN:'synthetic'}}));
  await chmod(file,0o644);await assert.rejects(persist());await chmod(file,0o600);
  const pendingFile=join(directory,'pending-oauth.json');const pendingStore=new FileCredentialStore(pendingFile);await pendingStore.set('openai',credential.openai);
  let releaseRefresh, markStarted;
  const refreshStarted=new Promise(resolve=>{markStarted=resolve;});
  const lateFetch=createOAuthFetch({id:'openai',name:'Synthetic late refresh',refresh:async()=>{markStarted();return new Promise(resolve=>{releaseRefresh=()=>resolve({...credential.openai,refresh:'synthetic-late-rotation',expires:Date.now()+600000});});}}, {store:pendingStore,userAgent:'offline',fetch:async()=>new Response('{}')});
  const cancelled=new AbortController();const pending=lateFetch('https://synthetic.invalid/responses',{signal:cancelled.signal});await refreshStarted;cancelled.abort();await assert.rejects(pending);releaseRefresh();
  for(let i=0;i<30&&(await pendingStore.get('openai')).refresh!=='synthetic-late-rotation';i++)await new Promise(resolve=>setTimeout(resolve,5));
  verify((await pendingStore.get('openai')).refresh==='synthetic-late-rotation','Production OAuth refresh can persist after caller cancellation, so forced shutdown cannot certify auth.');

  const attemptId = uuid('1'), sessionId = uuid('2');
  const request = { platform:'ios',runId:'synthetic-provider-run',targetName:'ios',slot:0,slots:1,agentDeviceVersion:'0.21.35',projectRoot:directory,env:{EXPO_TOKEN:'synthetic'},signal:new AbortController().signal,log:()=>{} };
  const ledgerFile = join(directory,'lease.json');
  const calls = [];
  globalThis.fetch = async (url,init) => {
    assert.equal(String(url),'https://api.expo.dev/graphql');
    const body=JSON.parse(init.body);calls.push(body);
    if(body.query.includes('createDeviceRunSession('))return Response.json({data:{deviceRunSession:{createDeviceRunSession:{id:sessionId,app:{slug:'synthetic',ownerAccount:{name:'synthetic'}}}}}});
    if(body.query.includes('ensureDeviceRunSessionStopped('))return Response.json({data:{deviceRunSession:{ensureDeviceRunSessionStopped:{turtleJobRun:null}}}});
    if(body.query.includes('deviceRunSessions { byId'))return Response.json({data:{deviceRunSessions:{byId:{status:'IN_PROGRESS',turtleJobRun:{status:'IN_PROGRESS'},remoteConfig:{agentDeviceRemoteSessionUrl:'https://synthetic.invalid',agentDeviceRemoteSessionToken:'synthetic-daemon'}}}}});
    throw new Error('Unexpected upstream provider request.');
  };
  const provider=ownedProvider(easSimulators({projectId:uuid('3'),buildId:uuid('4'),maxDurationMinutes:30,maxIdleTimeMinutes:10,tags:[`lob-testerarmy-${attemptId}`]}),{attemptId,ledgerFile});
  const lease=await provider.acquire(request);
  const ledger=await readLedger(ledgerFile);
  verify(ledger.state==='ready'&&ledger.sessionId===sessionId&&ledger.runId===request.runId,'Real upstream provider structured lease binds the durable ownership ledger.');
  verify(calls[0].variables.input.buildId===uuid('4')&&calls[0].variables.input.maxRunTimeMinutes===30&&calls[0].variables.input.packageVersion==='0.21.35','Actual provider forwards installed build, bounds, version, and exact tag.');
  await provider.release(lease,{...request,log:()=>{}});
  const owned = {id:sessionId,name:'e2e ios 1 of 1',tags:[ledger.tag,`e2e-run:${ledger.runId}`,'e2e-target:ios']};
  const operations=[];
  const control={list:async()=>[owned],stop:async(id)=>{operations.push(['stop',id]);},get:async(id)=>{operations.push(['get',id]);return {id,status:'STOPPED'};}};
  verify((await reconcileOwned(ledger,control)).state==='stopped'&&operations.map(([op])=>op).join(',')==='stop,get','Release is followed by independent scoped stop and STOPPED readback.');
  const {sessionId:ignoredId,readyAt:ignoredReady,...intentBase}=ledger;
  const intent=ledgerSchema.parse({...intentBase,state:'intent'});
  verify((await reconcileOwned(intent,control)).state==='stopped','Partial create recovers by exact tag and e2e run/slot ownership.');
  verify((await reconcileOwned(intent,{...control,list:async()=>[owned,owned]})).state==='unconfirmed','Ambiguous sessions are never stopped.');
  verify((await reconcileOwned(intent,{...control,list:async()=>[{...owned,tags:[ledger.tag]}]})).state==='unconfirmed','Tag alone cannot claim a foreign session.');
  verify((await reconcileOwned(ledger,{...control,get:async()=>({id:sessionId,status:'IN_PROGRESS'})},35)).state==='unconfirmed','Successful stop mutation without readback is inconclusive.');
  verify((await reconcileOwned(ledger,{...control,get:async()=>({id:uuid('9'),status:'STOPPED'})})).state==='unconfirmed','Another stopped ID is rejected.');
  const bounded=ownedProvider({name:'fake',acquire:async(r)=>new Promise((_,reject)=>r.signal.addEventListener('abort',()=>reject(new Error('preparation deadline')),{once:true})),release:async()=>{}},{attemptId,ledgerFile:join(directory,'bounded.json'),preparationMs:10});
  const keepalive=setInterval(()=>{},100);
  await assert.rejects(bounded.acquire(request),/preparation deadline/);clearInterval(keepalive);
  verify((await readLedger(join(directory,'bounded.json'))).state==='intent','Preparation abort retains partial-create recovery intent.');
  const noIdFile=join(directory,'no-id.json');
  const noId=ownedProvider({name:'partial-create',acquire:async()=>({id:'not-a-uuid',daemon:{baseUrl:'https://synthetic.invalid',authToken:'synthetic'}}),release:async()=>{}},{attemptId,ledgerFile:noIdFile});
  await assert.rejects(noId.acquire(request));
  verify((await reconcileOwned(await readLedger(noIdFile),control)).state==='stopped','No structured lease ID can still recover exactly one owned partial create.');
  await writeFile(ledgerFile+'.ready','torn');
  verify((await readLedger(ledgerFile)).state==='intent','Immutable intent survives a torn readiness binding.');
  const stoppedAlready=await reconcileOwned(ledger,{...control,stop:async()=>{},get:async(id)=>({id,status:'STOPPED'})});
  verify(stoppedAlready.state==='stopped','Already stopped owned sessions can be independently confirmed again.');
  let visibleAt;
  globalThis.fetch=async(url,init)=>{
    assert.equal(String(url),'https://api.expo.dev/graphql');
    assert.ok(JSON.parse(init.body).query.includes('createDeviceRunSession('));
    visibleAt=Date.now()+100;
    throw new Error('Synthetic create accepted but response lost.');
  };
  const lostFile=join(directory,'lost-create.json');
  const lost=ownedProvider(easSimulators({projectId:uuid('3'),buildId:uuid('4'),maxDurationMinutes:30,maxIdleTimeMinutes:10,tags:[ledger.tag]}),{attemptId,ledgerFile:lostFile});
  await assert.rejects(lost.acquire(request));
  let lists=0,stops=0,gets=0;
  const recovered=await reconcileOwned(await readLedger(lostFile),{
    list:async()=>{lists++;if(lists===1)throw new Error('Transient list error');return Date.now()>=visibleAt&&lists>2?[owned]:[];},
    stop:async id=>{assert.equal(id,sessionId);stops++;},
    get:async id=>{gets++;if(gets===1)throw new Error('Transient readback error');return {id,status:gets>=3?'STOPPED':'IN_PROGRESS'};},
  },2000);
  verify(recovered.state==='stopped'&&lists>=3&&stops===1&&gets===3,'Production reconciliation recovers lost-create visibility, transient list/readback, and delayed STOPPED within one deadline.');
  const recoveryReceipt={state:recovered.state,lists,stops,gets};
  let forbiddenStops=0;
  for(const foreign of [{...owned,tags:[ledger.tag]}, {...owned,tags:[ledger.tag,'e2e-run:foreign','e2e-target:ios']}, {...owned,name:'e2e ios 2 of 2'}, {...owned,tags:[ledger.tag,`e2e-run:${ledger.runId}`,'e2e-target:android']}]) {
    verify((await reconcileOwned(intent,{...control,list:async()=>[foreign],stop:async()=>{forbiddenStops++;}},100)).state==='unconfirmed','Foreign run, target, or slot never broadens recovery ownership.');
  }
  verify(forbiddenStops===0,'Foreign discovery never requests a stop.');
  const emptyStart=Date.now();
  verify((await reconcileOwned(intent,{...control,list:async()=>[]},35)).state==='unconfirmed'&&Date.now()-emptyStart<500,'Empty discovery remains bounded by the existing deadline.');

  await assert.rejects(ownedProvider({name:'fake',acquire:async()=>{throw new Error('must not acquire');},release:async()=>{}},{attemptId,ledgerFile:join(directory,'never.json')}).acquire({...request,slots:2}));
  globalThis.fetch=async()=>{throw new Error('Offline network disabled.');};
  const source={ref:'feat/synthetic',sha:'2'.repeat(40)};
  const target=targetSchema.parse({kind:'acceptance',issue:{number:1,id:1,nodeId:'synthetic-issue',sha256:'3'.repeat(64)},controller:source,source,repository:'SchroederNathan/expo-basketball',pullRequest:4,platform:'ios',appId:'dev.expo.basketball',profile:'agent-preview',environment:'preview',fingerprint:'4'.repeat(40),runtime:'1.0.0',fixture:{id:'prizepicks-v1',date:'20261026',zone:'America/Toronto',sha256:digest(await readFile(join(cwd,'demo/fixtures/prizepicks-v1.json')))},criteria:{path:'demo/issues/player-label.md',sha256:digest(await readFile(join(cwd,'demo/issues/player-label.md')))},native:{kind:'built',installed:uuid('4'),sourceSha:source.sha},bundle:{kind:'embedded',candidate:source.sha}});

  const metadataFile=join(directory,'metadata.mjs');
  const metadata={id:target.native.installed,status:'FINISHED',platform:'IOS',buildProfile:'agent-preview',isForIosSimulator:true,appIdentifier:target.appId,gitCommitHash:target.source.sha,fingerprint:{hash:target.fingerprint},runtime:{version:'1.0.0'},app:{id:uuid('8')}};
  await writeFile(metadataFile,`process.stdout.write(${JSON.stringify(JSON.stringify(metadata))});`);
  await assert.rejects(verifyBuild({target,eas:{file:process.execPath,args:[metadataFile]},cwd:directory,env:{PATH:process.env.PATH},projectId:uuid('3')}),/project mismatch/);
  metadata.app.id=uuid('3');await writeFile(metadataFile,`process.stdout.write(${JSON.stringify(JSON.stringify(metadata))});`);
  await verifyBuild({target,eas:{file:process.execPath,args:[metadataFile]},cwd:directory,env:{PATH:process.env.PATH},projectId:uuid('3')});
  counters.assertions+=2;

  const collectContext=join(directory,'collect-context.json');
  await writeFile(collectContext,JSON.stringify({attemptId,target,ledgerFile:join(directory,'collect-lease.json'),abortFile:join(directory,'collect-abort')}));
  delete process.env.TESTERARMY_CONTEXT;
  await assert.rejects(list({cwd:packageDirectory,config:join(packageDirectory,'e2e.config.ts'),files:['tests/jordan.e2e.ts']}),/controller-validated installed build context/);
  process.env.TESTERARMY_CONTEXT=collectContext;
  const collected=await list({cwd:packageDirectory,config:join(packageDirectory,'e2e.config.ts'),files:['tests/jordan.e2e.ts']});
  verify(collected.pairs.length===1&&collected.pairs[0].target==='ios','Actual pinned mobile/EAS/ChatGPT config and Jordan test collect under Node without network.');
  await mkdir(join(directory,'tests'));
  await copyFile(join(packageDirectory,'tests/jordan.e2e.ts'),join(directory,'tests/jordan.e2e.ts'));
  await writeFile(join(directory,'context.ts'),`export * from ${JSON.stringify(join(packageDirectory,'context.ts'))};`);
  const png=join(directory,'canary.png'), video=join(directory,'canary.mp4');
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=200x300','-frames:v','1','-threads','1',png]);
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=200x300:r=15:d=1','-c:v','mpeg4','-threads','1',video]);
  Object.assign(process.env,{FAKE_IDENTITY:identityLabel(target),FAKE_PNG:png,FAKE_VIDEO:video});
  const config=join(directory,'e2e.config.ts');
  await writeFile(config,`import {offlineEngine,offlineExecutor} from ${JSON.stringify(join(packageDirectory,'offline-engine.mjs'))}; export default {projectId:'lob-testerarmy',targets:[{name:'ios',engine:offlineEngine(),app:{bundleId:'dev.expo.basketball'},video:'on'}],agents:{default:{executor:offlineExecutor}},workers:1,retries:0,timeout:10000,assertionTimeout:20,cleanupTimeout:3000,output:'output',cache:{mode:process.env.FAKE_MODE==='replay'?'read-only':'read-write',dir:'cache',strict:process.env.FAKE_MODE==='replay'},reporters:[]};`);
  const outcomes=[];
  const mediaRejections=[];
  for(const mode of ['seed','repaired','repeat','replay','wrong-player']) {
    if(mode==='repaired'||mode==='wrong-player')await rm(join(directory,'cache'),{recursive:true,force:true});
    process.env.FAKE_MODE=mode;
    const before=new Date(Date.now()-2).toISOString();
    const outcome=await run({cwd:directory,config,files:['tests/jordan.e2e.ts']});
    await writeFile(join(directory,`report-${mode}.json`),JSON.stringify(outcome.report,null,2));
    const leaseLedger=ledgerSchema.parse({...ledger,runId:outcome.report.run.id,requestedAt:before,readyAt:before});
    if(mode==='wrong-player') { assert.throws(()=>admitReport(outcome.report,leaseLedger,target,outcome.exitCode)); continue; }
    let admission;
    try { admission=admitReport(outcome.report,leaseLedger,target,outcome.exitCode); } catch(error) { process.stderr.write(JSON.stringify({mode,status:outcome.status,error:outcome.report.run.results[0]?.attempts[0]?.error})+'\n');throw error; }
    verify(admission.state===(mode==='seed'?'FAIL':'PASS')&&outcome.exitCode===(mode==='seed'?1:0),'Genuine Node runner executes the actual Jordan test and retains real assertion exit semantics.');
    if(mode==='seed')verify(admission.checks[0].state==='FAIL'&&admission.checks[1].state==='FAIL'&&admission.checks[2].state==='PASS'&&admission.checks[3].state==='PASS','All four original checks survive the seeded assertion failures.');
    const publicRoot=join(directory,`public-${mode}`);await mkdir(publicRoot);
    const evidence=await admitEvidence({admission,root:join(directory,'output/results'),directory:publicRoot,target,ledger:leaseLedger,cwd,env:{PATH:process.env.PATH}});
    if(mode==='replay') {
      verify(verifyReplay(outcome.report).length===4,'Genuine replay cache self-finalizes four navigation acts with zero model calls and fresh assertions/media.');
      for(const change of [step=>{step.cache.mode='missed';},step=>{step.metrics.modelCalls=1;}]) {
        const invalid=structuredClone(outcome.report);change(invalid.run.results[0].attempts[0].steps.find(step=>step.api==='agent.act'));assert.throws(()=>verifyReplay(invalid));counters.assertions++;
      }
    }
    const controller=testerArmyResultSchema.parse({version:1,engine:'testerarmy-e2e',state:admission.state,attemptId,runId:uuid('5'),runUrl:`https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/${uuid('5')}`,startedAt:before,finishedAt:new Date().toISOString(),target,lease:leaseLedger,framework:admission.framework,checks:admission.checks,evidence,cleanup:{state:'stopped',sessionId,observedAt:new Date().toISOString()},auth:'persisted',termination:{kind:'observed',exitCode:outcome.exitCode,signal:null,forced:false,shutdownConfirmed:true},tools:toolVersions});
    const manifest=await stageTesterArmyEvidence({result:controller,root:publicRoot,directory:join(directory,`staged-${mode}`),cwd,env:{PATH:process.env.PATH}});
    verify(manifest.workflow==='testerarmy'&&manifest.slots.length===8&&manifest.slots.find((slot)=>slot.role==='original').sha256===evidence.recording.sha256&&manifest.slots.find((slot)=>slot.role==='playback').transform.frames===15,'Native publisher manifest keeps the unchanged original and labeled H264 all-frame derivative.');
    if(mode==='repaired') {
      const reportPath=join(publicRoot,evidence.report.path), originalReport=await readFile(reportPath);
      await writeFile(reportPath,'changed framework report');
      await assert.rejects(stageTesterArmyEvidence({result:controller,root:publicRoot,directory:join(directory,'changed-report-stage'),cwd,env:{PATH:process.env.PATH}}));
      await writeFile(reportPath,originalReport);counters.assertions++;
    }
    verify(publicationStatus(controller,{state:'unavailable',url:null}).state==='INCONCLUSIVE'&&publicationStatus(controller,{state:'unavailable',url:null}).observed_state===admission.state,'Required publication failure retains observed verdict but gates workflow status.');
    for(const field of ['auth','uncertain-auth','cleanup','termination']) {
      const invalid=structuredClone(controller);
      if(field==='auth')invalid.auth='write-back-failed';
      if(field==='uncertain-auth')invalid.auth='uncertain';
      if(field==='cleanup')invalid.cleanup={state:'unconfirmed',sessionId};
      if(field==='termination')invalid.termination.forced=true;
      verify(!testerArmyResultSchema.safeParse(invalid).success,'No definitive verdict with failed auth, cleanup, or forced termination.');
    }
    for(const mutate of [r=>r.schemaVersion='report-future',r=>r.run.results.push(structuredClone(r.run.results[0])),r=>r.run.results[0].selected=false,r=>r.run.results[0].repeat=1,r=>r.run.results[0].attempts.push(structuredClone(r.run.results[0].attempts[0])),r=>r.run.status='interrupted',r=>r.run.status='blocked',r=>r.run.status='error',r=>r.run.results[0].status='skipped',r=>r.run.results[0].attempts[0].steps=r.run.results[0].attempts[0].steps.filter(s=>s.label!=='unknown-stat'),r=>r.run.results[0].attempts[0].artifacts=r.run.results[0].attempts[0].artifacts.filter(a=>a.kind!=='video'),r=>r.run.results[0].attempts[0].artifacts.find(a=>a.kind==='screenshot').producer={kind:'attempt'},r=>r.run.results[0].attempts[0].steps.find(s=>s.kind==='assertion').label='wrong embedded identity']) {
      const changed=structuredClone(outcome.report);mutate(changed);assert.throws(()=>admitReport(changed,leaseLedger,target,outcome.exitCode));counters.assertions++;
    }

    await assert.rejects(admitEvidence({admission,root:join(directory,'output/results'),directory:publicRoot,target:{...target,criteria:{...target.criteria,sha256:'0'.repeat(64)}},ledger:leaseLedger,cwd,env:{PATH:process.env.PATH}}));
    if(mode==='repaired') {
      const workflow=await readFile(join(cwd,'.eas/workflows/testerarmy-ios.yml'),'utf8');
      const uploadGlob=workflow.match(/path: (agent-output\/testerarmy\/public\/\*\*\/\*)/)[1];
      for(const index of [0,3]) {
        const corrupt=structuredClone(admission);const artifact=corrupt.screenshots[index].artifact;
        const canary=Buffer.from('synthetic-private-canary-is-not-a-PNG');
        await writeFile(join(directory,'output/results',artifact.path),canary);artifact.size=canary.length;artifact.sha256=digest(canary);
        const uploadCwd=join(directory,`rejected-${index}`),brokenRoot=join(uploadCwd,'agent-output/testerarmy/public',attemptId);
        await mkdir(brokenRoot,{recursive:true});
        let rejected;
        await assert.rejects(admitEvidence({admission:corrupt,root:join(directory,'output/results'),directory:brokenRoot,target,ledger:leaseLedger,cwd,env:{PATH:process.env.PATH}}),error=>{
          rejected=error.cause;
          return rejected?.args.at(-1).endsWith(`/${corrupt.screenshots[index].id}.png`)&&rejected.termination.kind==='exited'&&!!rejected.stderr.trim()&&rejected.observation.cleanup.confirmed;
        });
        await writeFile(join(brokenRoot,'result.json'),JSON.stringify({state:'INCONCLUSIVE',reason:'Framework media or source admission failed.'}));
        const uploaded=[];
        for await(const path of glob(uploadGlob,{cwd:uploadCwd})) {
          if(!(await lstat(join(uploadCwd,path))).isFile())continue;
          uploaded.push(path);
          verify(!(await readFile(join(uploadCwd,path))).includes(canary),'Rejected bytes never appear under the actual workflow upload glob.');
        }
        verify(uploaded.length===1&&uploaded[0].endsWith('/result.json'),'First and later media failures retain only safe result diagnostics under the upload glob.');
        mediaRejections.push({index,canonical:`${corrupt.screenshots[index].id}.png`,decodeExit:rejected.observation.exitCode,decoderDiagnostic:true,cleanupConfirmed:rejected.observation.cleanup.confirmed,uploadedFiles:uploaded.map(path=>path.split('/').at(-1))});
        await copyFile(png,join(directory,'output/results',artifact.path));
      }
    }
    const artifact=admission.screenshots[0].artifact;
    const artifactsRoot=join(directory,'output/results');
    for(const changed of [{...artifact,path:'../outside.png'},{...artifact,path:'/absolute.png'},{...artifact,sha256:'0'.repeat(64)},{...artifact,size:artifact.size+1},{...artifact,path:undefined,url:'https://synthetic.invalid/remote.png'}]) await assert.rejects(artifactBytes(artifactsRoot,changed,Date.parse(before)));
    const originalPath=join(artifactsRoot,artifact.path), backup=join(directory,`backup-${mode}.png`);
    await copyFile(originalPath,backup);await rm(originalPath);await symlink(backup,originalPath);
    await assert.rejects(artifactBytes(artifactsRoot,artifact,Date.parse(before)));await rm(originalPath);await link(backup,originalPath);
    await assert.rejects(artifactBytes(artifactsRoot,artifact,Date.parse(before)));await rm(originalPath);await copyFile(backup,originalPath);await utimes(originalPath,new Date(0),new Date(0));
    await assert.rejects(artifactBytes(artifactsRoot,artifact,Date.parse(before)));
    outcomes.push({mode,status:outcome.status,exitCode:outcome.exitCode,checks:admission.checks.map(({id,state})=>({id,state}))});
  }
  const acceptedLabels=[];
  for(const [mode,label,expected] of [['omitted',undefined,'PASS'],['other-label','Usage 4.2','PASS'],['bare-unknown','4.2','FAIL'],['blank-prefix','   4.2, ranked 2nd','FAIL']]) {
    await rm(join(directory,'cache'),{recursive:true,force:true});
    process.env.FAKE_MODE=mode;
    if(label===undefined)delete process.env.FAKE_UNKNOWN_LABEL;else process.env.FAKE_UNKNOWN_LABEL=label;
    const before=new Date(Date.now()-2).toISOString();
    const outcome=await run({cwd:directory,config,files:['tests/jordan.e2e.ts']});
    const admission=admitReport(outcome.report,{...ledger,runId:outcome.report.run.id,requestedAt:before,readyAt:before},target,outcome.exitCode);
    verify(admission.state===expected&&admission.checks.find(check=>check.id==='unknown-stat').state===expected&&admission.checks.filter(check=>check.id!=='unknown-stat').every(check=>check.state==='PASS'),'Frozen unknown-stat criteria accept omission and another safe label, reject numeric-only or blank prefix, and preserve the other player checks.');
    acceptedLabels.push({mode,state:admission.state,exitCode:outcome.exitCode});
  }
  delete process.env.FAKE_UNKNOWN_LABEL;
  const childXdg=join(directory,'child-xdg'),childAuth=await seedSubscription(seed,childXdg);
  const abortFile=join(directory,'collect-abort'),marker=join(directory,'child-refresh-started'),finished=join(directory,'child-refresh-finished');
  const setup=join(directory,'mock-refresh.mjs');
  await writeFile(setup,`import {writeFileSync} from 'node:fs';globalThis.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;if(url==='https://auth.openai.com/oauth/token'){writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,signalPresent:!!init?.signal}));await new Promise(r=>setTimeout(r,10000));writeFileSync(${JSON.stringify(finished)},'done');return Response.json({access_token:'synthetic-rotated-access',refresh_token:'synthetic-rotated-refresh',expires_in:3600});}throw new Error('Synthetic model transport abandoned. No external request sent.');};`);
  const workerEnv={...runnerEnvironment({PATH:process.env.PATH,EXPO_TOKEN:'synthetic-developer'},directory,childXdg),TESTERARMY_CONTEXT:collectContext,FAKE_IDENTITY:identityLabel(target),FAKE_PNG:png,FAKE_VIDEO:video};
  const authExecutions=[];
  for(const mode of ['seed','cancelled','timeout','abandoned']) {
    await rm(join(directory,'outcome.json'),{force:true});await rm(abortFile,{force:true});await rm(marker,{force:true});await rm(finished,{force:true});
    await writeFile(childAuth,JSON.stringify({openai:{...credential.openai,expires:mode==='abandoned'?Date.now()+3600000:credential.openai.expires}}));
    await writeFile(config,`import ${JSON.stringify(setup)};import production from ${JSON.stringify(join(packageDirectory,'e2e.config.ts'))};import {offlineEngine,offlineExecutor} from ${JSON.stringify(join(packageDirectory,'offline-engine.mjs'))};export default {...production,targets:[{...production.targets[0],engine:offlineEngine()}],assertionTimeout:30,cleanupTimeout:3000,timeout:${mode==='timeout'?1000:10000},maxDuration:10000${mode==='seed'?',agents:{default:{executor:offlineExecutor}}':''}};`);
    const cancelled=new AbortController();
    const watcher=mode==='cancelled'?setInterval(()=>{if(existsSync(marker))cancelled.abort();},20):undefined;
    const before=new Date(Date.now()-2).toISOString();
    let child;
    try { child=await runWorker({cwd:directory,env:{...workerEnv,FAKE_MODE:mode==='seed'?'seed':'repaired'},abortFile,signal:cancelled.signal,gracefulMs:15000,hardMs:20000}); }
    finally {clearInterval(watcher);}
    const report=JSON.parse(await readFile(join(directory,'output/report.json'),'utf8'));
    const childLedger={...ledger,runId:report.run.id,requestedAt:before,readyAt:before};
    let execution='unfinished';
    if(mode==='seed') {
      verify(admitWorkerReport(child,report,childLedger,target).state==='FAIL'&&child.observation.exitCode===1,'A genuine completed assertion exit 1 is admitted by the controller completion boundary.');
      execution='completed';
    } else assert.throws(()=>admitWorkerReport(child,report,childLedger,target));
    const auth=await finalizeSubscription({file:childAuth,eas,cwd:directory,env:{PATH:process.env.PATH,AGENT_AUTH_WRITE_TOKEN:'synthetic-writer'},execution});
    verify(auth===(mode==='seed'?'persisted':'uncertain'),'Successful credential writeback preserves uncertainty for interrupted, timed-out, or abandoned-model execution.');
    if(mode!=='seed')verify(await finalizeSubscription({file:childAuth,eas:{file:process.execPath,args:['-e','process.exit(1)','--']},cwd:directory,env:{AGENT_AUTH_WRITE_TOKEN:'synthetic'},execution})==='uncertain','Failed writeback cannot erase execution uncertainty.');
    if(mode==='cancelled'||mode==='timeout') {
      verify(existsSync(marker)&&!existsSync(finished)&&(JSON.parse(await readFile(childAuth,'utf8'))).openai.refresh==='synthetic-refresh','Real public ChatGPT worker exits with an unfinished signal-independent refresh.');
      const started=JSON.parse(await readFile(marker,'utf8'));
      verify(!started.signalPresent,'Real upstream token refresh receives no caller cancellation signal.');
      assert.throws(()=>process.kill(started.pid,0),error=>error.code==='ESRCH');
    }
    if(mode==='cancelled')verify(child.termination.kind==='exited'&&child.observation.exitCode===130&&!child.observation.cleanup.forced&&child.observation.cleanup.confirmed&&report.run.status==='interrupted','Normal exit 130 and confirmed process disappearance do not certify pending refresh drain.');
    authExecutions.push({mode,status:report.run.status,exitCode:child.observation.exitCode,auth,termination:child.termination,cleanup:child.observation.cleanup});
  }
  const normal=join(directory,'normal-worker.mjs');await writeFile(normal,"process.exitCode=1;\n");
  const terminated=await runWorker({cwd:directory,env:{PATH:process.env.PATH},abortFile:join(directory,'abort-normal'),signal:new AbortController().signal,worker:normal,gracefulMs:2000,hardMs:3000});
  verify(terminated.observation.exitCode===1&&!terminated.observation.cleanup.forced&&terminated.observation.cleanup.confirmed,'Actual nonzero worker shutdown is retained without forced termination.');
  const stuck=join(directory,'stuck-worker.mjs');await writeFile(stuck,'setInterval(()=>{},1000);');
  const forced=await runWorker({cwd:directory,env:{PATH:process.env.PATH},abortFile:join(directory,'abort-forced'),signal:new AbortController().signal,worker:stuck,gracefulMs:20,hardMs:100});
  verify(forced.termination.kind!=='exited'&&forced.observation.cleanup.forced,'Hard watchdog remains distinguishable from normal finalizers.');
  process.stdout.write(JSON.stringify({...counters,outcomes,acceptedLabels,authExecutions,recoveryReceipt,mediaRejections})+'\n');
} finally { await rm(directory,{recursive:true,force:true}); }
