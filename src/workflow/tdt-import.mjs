import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {atomicJSON} from './config.mjs';
export function parseCSV(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(!quoted&&field)throw new Error('Malformed CSV quote');else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw new Error('Unterminated CSV field');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}return rows;
}
export function validateTTL(text){
  if(Buffer.byteLength(text)>2*1024*1024)throw new Error('Import exceeds 2 MiB; use streaming export tool for large native data');
  const [header,...rows]=parseCSV(text.replace(/^\uFEFF/,''));
  const required=['ttl_index','edge','tdt_sample_index','tdt_sample_rate_hz','event_source','event_channel'];
  if(!header||new Set(header).size!==header.length||required.some(k=>!header.includes(k)))throw new Error('Missing or duplicate TTL columns');
  if(!rows.length)throw new Error('TTL export has no events');
  const issues=[],seen=new Set();let prior=null,rate=null,rising=0,falling=0;
  rows.forEach((cells,i)=>{
    if(cells.length!==header.length)throw new Error(`Column count on row ${i+2}`);
    const r=Object.fromEntries(header.map((k,j)=>[k,cells[j]]));
    if(!/^\d+$/.test(r.ttl_index)||!/^\d+$/.test(r.tdt_sample_index)||!r.tdt_sample_rate_hz.trim())throw new Error(`Missing/invalid index on row ${i+2}`);
    const index=Number(r.ttl_index),sample=Number(r.tdt_sample_index),hz=Number(r.tdt_sample_rate_hz);
    if(!Number.isSafeInteger(index)||!Number.isSafeInteger(sample)||!Number.isFinite(hz)||hz<=0||!r.event_source||!r.event_channel||!['rising','falling'].includes(r.edge))throw new Error(`Invalid TTL row ${i+2}`);
    if(rate!==null&&rate!==hz)throw new Error('Mixed sample rates require separate clock-domain exports');rate=hz;
    if(r.edge==='rising')rising++;else falling++;
    const identity=`${r.event_source}/${r.event_channel}/${r.edge}/${sample}`;
    if(seen.has(identity))issues.push({row:i+2,issue:'duplicate_edge'});seen.add(identity);
    if(prior!==null&&sample<prior)issues.push({row:i+2,issue:'nonmonotonic_sample_index'});prior=sample;
    if(r.tdt_time_s?.trim()&&(!Number.isFinite(Number(r.tdt_time_s))||Math.abs(Number(r.tdt_time_s)-sample/hz)>0.5/hz))issues.push({row:i+2,issue:'sample_time_inconsistent'});
  });
  return {event_count:rows.length,rising_edge_count:rising,falling_edge_count:falling,sample_rate_hz:rate,issues,alignment_status:'UNALIGNED_REQUIRES_CALIBRATION',hardware_acceptance:false};
}
export function attachTDT(dir,{nativeBlockPath,ttlCSV,operator}){
  if(typeof operator!=='string'||!operator.trim())throw new Error('Operator attribution required');
  const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
  if(!['COMPLETE','FAULT'].includes(m.state))throw new Error('Attach evidence only after session finalization');
  const block=path.resolve(nativeBlockPath??'');if(!nativeBlockPath||!fs.statSync(block).isDirectory())throw new Error('Native block directory required');
  const report=validateTTL(ttlCSV);const evidence=path.join(dir,'tdt_import_'+randomUUID());fs.mkdirSync(evidence);
  fs.writeFileSync(path.join(evidence,'ttl_events.csv'),ttlCSV,{flag:'wx'});
  const binding={native_block_path:block,operator,attached_utc:new Date().toISOString(),native_block_contents_verified:false,
    association:m.mode.startsWith('simulation')?'operator_reference_only_not_temporally_linked_to_simulation':'operator_asserted_pending_verification',
    ttl_sha256:createHash('sha256').update(ttlCSV).digest('hex'),...report};
  atomicJSON(path.join(evidence,'binding.json'),binding);return binding;
}

export function attachRealTDT(dir,{nativeBlockPath,ttlCSV,operator}){
  if(typeof operator!=='string'||!operator.trim())throw new Error('Operator attribution required');
  const report=JSON.parse(fs.readFileSync(path.join(dir,'report.json')));
  if(!['COMPLETE','FAULT'].includes(report.state))throw new Error('Attach evidence only after recording finalization');
  const block=path.resolve(nativeBlockPath??'');
  if(!nativeBlockPath||!fs.statSync(block).isDirectory())throw new Error('Native block directory required');
  const validation=validateTTL(ttlCSV),expected=Number(report.target_frames);
  const countMatch=Number.isSafeInteger(expected)&&validation.rising_edge_count===expected;
  const cameraCountMatch=report.capture_mode==='external_ttl_frame_start'&&report.received_frames===expected&&report.camera_ttl_trigger_verified===true;
  const evidence=path.join(dir,'tdt_import_'+randomUUID());fs.mkdirSync(evidence);
  fs.writeFileSync(path.join(evidence,'ttl_events.csv'),ttlCSV,{flag:'wx'});
  const binding={native_block_path:block,operator:operator.trim(),attached_utc:new Date().toISOString(),
    camera_serial:report.serial,capture_mode:report.capture_mode,expected_rising_edges:expected,
    rising_edge_count_matches_target:countMatch,camera_frame_count_matches_target:cameraCountMatch,
    verification_status:countMatch&&cameraCountMatch&&!validation.issues.length?'COUNTS_MATCH_PENDING_TIMING_CALIBRATION':'MISMATCH',
    native_block_contents_verified:false,ttl_sha256:createHash('sha256').update(ttlCSV).digest('hex'),...validation};
  atomicJSON(path.join(evidence,'binding.json'),binding);return binding;
}
