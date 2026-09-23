import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {RealMedia} from '../src/workflow/real-media.mjs';
import {attachRealTDT} from '../src/workflow/tdt-import.mjs';
test('real replay rejects traversal and frame indices before decoding',async()=>{
  const media=new RealMedia('work/media-test');
  for(const id of ['../outside','C:/outside','group_x/../../real_x','real_x/../real_y'])assert.throws(()=>media.locate(id),/Invalid/);
  for(const index of [-1,1.5,NaN])await assert.rejects(media.frame('real_test',index),/Invalid frame/);
});
test('real history includes completed decoded recordings only',()=>{
  const root=fs.mkdtempSync('work/media-history-');
  for(const [name,frames] of [['real_good',2],['real_partial',0]]){
    const dir=path.join(root,'group_a','run_b',name);fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({serial:'40475309',decoded_frames:frames,state:'COMPLETE'}));fs.writeFileSync(path.join(dir,'camera.mkv'),'fixture');
  }
  const records=new RealMedia(root).list();assert.equal(records.length,1);assert.equal(records[0].id,'group_a/run_b/real_good');
});
test('real TDT attachment compares rising edges with triggered camera frames',()=>{
  const root=fs.mkdtempSync('work/real-tdt-'),dir=path.join(root,'real_triggered'),block=path.join(root,'native-block');fs.mkdirSync(dir);fs.mkdirSync(block);
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({state:'COMPLETE',serial:'40488229',capture_mode:'external_ttl_frame_start',target_frames:2,received_frames:2,camera_ttl_trigger_verified:true}));
  const csv='ttl_index,edge,tdt_sample_index,tdt_sample_rate_hz,event_source,event_channel\n0,rising,10,10000,TDT,CAM\n1,rising,110,10000,TDT,CAM\n';
  const result=attachRealTDT(dir,{nativeBlockPath:block,ttlCSV:csv,operator:'tester'});
  assert.equal(result.rising_edge_count,2);assert.equal(result.rising_edge_count_matches_target,true);assert.equal(result.verification_status,'COUNTS_MATCH_PENDING_TIMING_CALIBRATION');
});
