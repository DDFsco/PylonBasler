import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Session} from '../src/workflow/session.mjs';
import {configOf} from '../src/workflow/config.mjs';
import {OnlineQC} from '../src/workflow/quality.mjs';
import {inspectSession} from '../src/workflow/recovery.mjs';
import {validateTTL,attachTDT} from '../src/workflow/tdt-import.mjs';
import {createApp} from '../src/server.mjs';
import {spawn} from 'node:child_process';
fs.mkdirSync('work/workflow-tests',{recursive:true});const root=fs.mkdtempSync('work/workflow-tests/run-');
async function run(input={},services={}){const s=new Session(root,{cameraCount:1,durationSeconds:0.08,realtime:false,faultPulse:3,...input},services);await s.precheck();await s.arm();s.start();await s.completion;return s;}
for(const count of [1,2,6])test(`${count} cameras: actual video encoding, segmentation and pixel-exact decoding`,async()=>{
  const s=await run({cameraCount:count,segmentSeconds:0.04});assert.equal(s.state,'COMPLETE',JSON.stringify(s.faults));assert.equal(s.report.decoded_frames,count*8);assert.equal(s.report.segments.length,count*2);assert.ok(s.report.segments.every(x=>x.verified));assert.equal(s.report.hardware_acceptance,false);
});
for(const pixelFormat of ['BayerRG8','Mono16'])test(`${pixelFormat} preserves native pixel bytes through FFV1`,async()=>{
  const s=await run({cameras:[{id:'SIM_1',serial:'',width:32,height:24,pixelFormat}]});assert.equal(s.report.video_verified,true,JSON.stringify(s.faults));assert.equal(s.report.decoded_frames,8);
});
for(const scenario of ['missing-frame','missing-ttl','duplicate-frame','duplicate-ttl','ambiguous','clock-reset','disconnect','disk-full','writer-failure'])test(`injected ${scenario} cannot pass acceptance`,async()=>{
  const s=await run({scenario});assert.equal(s.state,'FAULT');assert.equal(s.report.simulation_pass,false);assert.equal(s.report.hardware_acceptance,false);
  assert.ok(s.faults.length);assert.ok(fs.existsSync(path.join(s.dir,'logs/events.jsonl')));
  if(scenario==='writer-failure'){assert.ok(s.report.received_frames>s.report.encoder_submitted_frames);assert.ok(s.report.segments.some(x=>x.verified));}
});
test('slow writer faults before exceeding bounded queue',async()=>{
  const s=await run({scenario:'slow-writer',realtime:true,queueFrames:2,durationSeconds:1});assert.equal(s.state,'FAULT');assert.ok(s.faults.some(f=>f.message.includes('QUEUE_OVERFLOW')));assert.ok(Object.values(s.report.streams).every(x=>x.high_water<=2));
});
test('disk-capacity precheck fails before a session or writer is opened',async()=>{
  const s=new Session(root,{}, {space:()=>0});await assert.rejects(s.precheck(),/DISK_CAPACITY/);assert.equal(s.state,'CONFIGURED');assert.equal(fs.existsSync(s.dir),false);assert.throws(()=>s.start());
});
test('manual stop drains and verifies output, double-start rejected',async()=>{
  const s=new Session(root,{cameraCount:1,durationSeconds:null});await s.precheck();await s.arm();s.start();assert.throws(()=>s.start());
  while(s.qc.events<5&&s.state==='RECORDING')await delay(10);s.stop();await s.completion;assert.equal(s.state,'COMPLETE',JSON.stringify(s.faults));assert.equal(s.report.stop_reason,'operator');assert.equal(s.report.received_frames,s.report.decoded_frames);
});
test('invalid identities, memory budgets and hardware mode fail closed',()=>{
  for(const cameraCount of [0,7])assert.throws(()=>configOf({cameraCount}));
  assert.throws(()=>configOf({mode:'hardware'}),/HARDWARE_GATE/);
  assert.throws(()=>configOf({cameras:[{id:'SIM_1',serial:'40475309',width:32,height:32,pixelFormat:'Mono8'}]}));
  assert.throws(()=>configOf({cameraCount:6,memoryBudgetMB:1,queueFrames:1024}),/memory/);
  assert.throws(()=>configOf({durationSeconds:NaN}));
});
test('two-hour-plus six-camera virtual-time QC uses bounded state',()=>{
  const ids=Array.from({length:6},(_,i)=>`SIM_${i+1}`),q=new OnlineQC(ids);const total=720001;
  for(let i=0;i<total;i++){const event=`e${i}`;q.inspect({id:event},[{eventId:event}],ids.map(id=>({id,eventId:event,block:i+1,ticks:i*10000})));}
  assert.equal(q.events,total);assert.equal(q.issueCount,0);assert.equal(q.prev.size,6);assert.equal(q.sample.length,0);
});
test('truncated final segment and journal are detected without modifying originals',async()=>{
  const s=await run();const video=path.join(s.dir,s.report.segments[0].file);fs.truncateSync(video,128);
  fs.appendFileSync(path.join(s.dir,'logs/events.jsonl'),'{"incomplete":');
  const before=fs.readFileSync(path.join(s.dir,'manifest.json'));const r=await inspectSession(s.dir);
  assert.ok(r.issues.length>=2);assert.equal(r.malformed_journal_rows,1);assert.equal(r.segments[0].verified,false);assert.deepEqual(fs.readFileSync(path.join(s.dir,'manifest.json')),before);
});
const valid='ttl_index,edge,tdt_sample_index,tdt_sample_rate_hz,event_source,event_channel\n0,rising,10,10000,TDT,TRIG\n1,rising,110,10000,TDT,TRIG\n';
test('native TTL import validates clocks and does not fabricate a simulation alignment',async()=>{
  assert.equal(validateTTL(valid).event_count,2);assert.throws(()=>validateTTL(valid.replace(',10,',',,')));assert.throws(()=>validateTTL(valid.replace('1,rising,110,10000','1,rising,110,20000')));
  assert.equal(validateTTL(valid.replace('1,rising,110','1,rising,10')).issues[0].issue,'duplicate_edge');
  const s=await run(),native=path.join(root,'native-placeholder');fs.mkdirSync(native);
  const before=fs.readFileSync(path.join(s.dir,'manifest.json'));const r=attachTDT(s.dir,{nativeBlockPath:native,ttlCSV:valid,operator:'test operator'});
  assert.equal(r.native_block_contents_verified,false);assert.equal(r.alignment_status,'UNALIGNED_REQUIRES_CALIBRATION');assert.equal(r.association,'operator_reference_only_not_temporally_linked_to_simulation');assert.deepEqual(fs.readFileSync(path.join(s.dir,'manifest.json')),before);
});
test('loopback API controls full workflow and rejects unauthorized requests',async()=>{
  const app=createApp(root);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
  const request=(route,data,extra={})=>fetch(origin+'/api/'+route,{method:data?'POST':'GET',headers:{'X-Session-Token':app.token,'Content-Type':'application/json',...extra},body:data?JSON.stringify(data):undefined});
  try{
    assert.equal((await fetch(origin+'/api/status')).status,403);
    assert.equal((await request('configure',{}, {Origin:'https://example.org'})).status,403);
    assert.equal((await request('start',{})).status,400);
    assert.equal((await request('configure',{cameraCount:1,durationSeconds:0.05,realtime:false})).status,200);
    for(const op of ['precheck','arm','start'])assert.equal((await request(op,{})).status,200);
    await app.session.completion;
    const status=await (await request('status')).json();assert.equal(status.state,'COMPLETE');
    const list=await (await request('sessions')).json();assert.ok(list.some(x=>x.id===status.session_id));
    const review=await (await request('review?id='+status.session_id)).json();assert.equal(review.qc.video_verified,true);
    assert.equal((await request('review?id=../')).status,400);
    const image=await request('frame?id='+status.session_id+'&file='+review.qc.segments[0].file+'&index=0');assert.equal(image.status,200,await image.clone().text());assert.ok((await image.json()).png.startsWith('iVBOR'));
  }finally{await new Promise(r=>app.server.close(r));}
});
test('completed elapsed time stays frozen, and changed disk capacity prevents start',async()=>{
  const s=await run();const time=s.status().elapsed_wall_s;await delay(20);assert.equal(s.status().elapsed_wall_s,time);
  let capacity=1e12;const blocked=new Session(root,{}, {space:()=>capacity});await blocked.precheck();await blocked.arm();capacity=0;assert.throws(()=>blocked.start(),/DISK_CAPACITY_CHANGED/);assert.equal(fs.existsSync(blocked.dir),false);
});
test('frame CSV tampering is detected during read-only audit',async()=>{
  const s=await run();const file=path.join(s.dir,'camera_SIM_1_frames.csv');const text=fs.readFileSync(file,'utf8');fs.writeFileSync(file,text.replace(/[a-f0-9]{64}/,'0'.repeat(64)));const audit=await inspectSession(s.dir);assert.ok(audit.issues.some(x=>x.includes('pixel hash')));
});
test('abrupt process interruption retains closed segments and incomplete state',async()=>{
  const target=fs.mkdtempSync(path.join(root,'interrupted-'));
  const child=spawn(process.execPath,['scripts/interrupted-fixture.mjs',target],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);
  const closed=new Promise(r=>child.once('close',r));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Interrupt fixture timeout '+stderr));},15000);child.stdout.on('data',b=>{if(b.toString().includes('READY')){clearTimeout(timer);resolve();}});child.once('error',e=>{clearTimeout(timer);reject(e);});});
  child.kill();await closed;await delay(300);
  const sessionDir=path.join(target,fs.readdirSync(target).find(x=>x.startsWith('session_')));const m=JSON.parse(fs.readFileSync(path.join(sessionDir,'manifest.json')));assert.notEqual(m.state,'COMPLETE');
  const audit=await inspectSession(sessionDir);assert.ok(audit.issues.some(x=>x.includes('unfinished')));assert.ok(audit.segments.some(x=>x.verified));
});
