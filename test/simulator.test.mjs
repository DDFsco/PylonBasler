import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {runSession,qc} from '../src/simulator.mjs';
import {StateMachine,BoundedQueue,schemas} from '../src/contracts.mjs';
fs.mkdirSync('work/tests',{recursive:true});
const root=fs.mkdtempSync('work/tests/run-');
const run=(name,options={})=>runSession(path.join(root,name),options);
test('clean: complete lifecycle, distinct clocks, empty hardware fields, CSV counts',()=>{
  const r=run('clean');assert.equal(r.state,'COMPLETE');assert.equal(r.simulation_qc_pass,true);
  assert.equal(r.hardware_acceptance,false);assert.equal(r.received_frames,40);assert.equal(r.written.ttl,20);
  const m=JSON.parse(fs.readFileSync(path.join(root,'clean/manifest.json')));
  assert.deepEqual(m.state_history,['IDLE','CONFIGURED','PRECHECKED','ARMED','RECORDING','FINALIZING','COMPLETE']);
  assert.deepEqual(m.hardware.camera_serials,[]);assert.equal(m.video.decoded_frame_count,null);
  for(const [file,key,count] of [['camera_SIM_A_frames.csv','frames',20],['ttl_events.csv','ttl',20],['neural_preview.csv','neural',20]]){
    const rows=fs.readFileSync(path.join(root,'clean',file),'utf8').trim().split('\n');
    assert.equal(rows[0],schemas[key]);assert.equal(rows.length,count+1);
  }
});
for(const [scenario,status,flag] of [['missing-frame','missing_frame'],['missing-ttl','missing_ttl'],
  ['duplicate-frame','ambiguous','duplicate_frame'],['duplicate-ttl','ambiguous','duplicate_ttl'],['ambiguous','ambiguous','no_alignment_evidence']]){
  test(`fault detected: ${scenario}`,()=>{
    const r=run(scenario,{scenario});assert.equal(r.state,'FAULT');assert.equal(r.simulation_qc_pass,false);
    assert.ok(r.issues.some(i=>i.status===status&&(!flag||i.flag===flag)));
    if(scenario==='missing-frame')assert.equal(r.received_frames,39);
    if(scenario==='missing-ttl')assert.equal(r.received_ttls,19);
  });
}
test('alignment uses causal evidence despite reorder, nonconsecutive IDs and unrelated clocks',()=>{
  const f=[{sim_camera_id:'A',sim_event_id:'y',sim_block_id:44,sim_camera_ticks:900000},
    {sim_camera_id:'A',sim_event_id:'x',sim_block_id:9,sim_camera_ticks:1}];
  const t=[{sim_event_id:'x',ttl_index:102},{sim_event_id:'y',ttl_index:6}];
  const r=qc(f,t,['x','y'],['A']);assert.equal(r.simulation_qc_pass,true);
  assert.equal(r.map.find(m=>m.sim_block_id===44).ttl_index,6);
  assert.equal(qc([{...f[0],sim_event_id:''}],t,[],['A']).simulation_qc_pass,false);
});
test('both absent remains ambiguous and never fabricates a frame',()=>{
  const r=qc([],[],['gone'],['A']);assert.equal(r.map[0].quality_flag,'both_missing');assert.equal(r.map[0].sim_block_id,'');
});
test('overflow is bounded, faulted, journaled and drains accepted queue items',()=>{
  const r=run('overflow',{scenario:'overflow',queueCapacity:2});
  assert.equal(r.state,'FAULT');assert.ok(r.faults.some(f=>f.code==='QUEUE_OVERFLOW'));
  assert.ok(Object.values(r.queue_high_water).every(n=>n<=2));
  assert.ok(Object.values(r.pending_records).every(n=>n===0));
  const logs=fs.readFileSync(path.join(root,'overflow/logs/events.jsonl'),'utf8');assert.match(logs,/QUEUE_OVERFLOW/);
  assert.equal(r.received_ttls,3);assert.equal(r.written.ttl,2);
});
test('writer failure retains partial CSV plus pending received metadata in journal',()=>{
  const r=run('writer-failure',{scenario:'writer-failure'});assert.equal(r.state,'FAULT');
  assert.equal(Object.values(r.written).reduce((a,b)=>a+b,0),12);
  assert.ok(Object.values(r.pending_records).some(n=>n>0));
  const log=fs.readFileSync(path.join(root,'writer-failure/logs/events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(log.filter(e=>e.kind==='received').length,16);
  assert.ok(fs.statSync(path.join(root,'writer-failure/camera_SIM_A_frames.csv')).size>0);
});
test('precheck failure prevents arm and record',()=>{
  const r=run('precheck-failure',{scenario:'precheck-failure'});assert.equal(r.received_frames,0);
  const m=JSON.parse(fs.readFileSync(path.join(root,'precheck-failure/manifest.json')));assert.ok(!m.state_history.includes('ARMED'));
});
test('illegal lifecycle transitions and queue capacity rejected',()=>{
  const s=new StateMachine();assert.throws(()=>s.move('RECORDING'));s.move('FAULT');assert.throws(()=>s.move('CONFIGURED'));
  assert.throws(()=>new BoundedQueue(0));const q=new BoundedQueue(1);q.push(1);assert.throws(()=>q.push(2));assert.equal(q.shift(),1);
});
test('existing session preserved and invalid input rejected',()=>{
  assert.throws(()=>run('clean'));assert.throws(()=>run('invalid',{pulses:NaN}));assert.throws(()=>run('unknown',{scenario:'guess'}));
});
test('final report filesystem error cannot leave a COMPLETE manifest',()=>{
  const original=fs.writeFileSync;
  fs.writeFileSync=function(file,...args){
    if(String(file).endsWith('frame_ttl_map.csv'))throw new Error('INJECTED_FINALIZATION_IO_ERROR');
    return original.call(this,file,...args);
  };
  try{assert.throws(()=>run('finalization-io'),/INJECTED_FINALIZATION_IO_ERROR/);}
  finally{fs.writeFileSync=original;}
  const m=JSON.parse(fs.readFileSync(path.join(root,'finalization-io/manifest.json')));
  assert.equal(m.state,'FINALIZING');
  assert.ok(fs.statSync(path.join(root,'finalization-io/camera_SIM_A_frames.csv')).size>0);
});
