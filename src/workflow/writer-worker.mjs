import {parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {launch,hash,verifyVideo} from './video.mjs';
import {FORMATS,frameColumns,appendCSV,atomicJSON} from './config.mjs';
const {dir,camera,config,ffmpeg,sessionId}=workerData;
const frameFile=path.join(dir,`camera_${camera.id}_frames.csv`);
const frameFD=fs.openSync(frameFile,'wx');fs.writeSync(frameFD,frameColumns.join(',')+'\n');
let chain=Promise.resolve(),segment=null,segments=[],total=0,failed=false,encode=null,hashFD;
const send=x=>parentPort.postMessage(x);
async function closeSegment(){
  if(!segment)return;
  encode.stdin.end();await encode.done;
  fs.fsyncSync(hashFD);fs.closeSync(hashFD);hashFD=undefined;fs.fsyncSync(frameFD);
  segment.encoded=true;
  atomicJSON(path.join(dir,`camera_${camera.id}_segments.json`),segments);
  send({type:'segment',segment});segment=null;encode=null;
}
function openSegment(index){
  const part=segments.length+1,name=`camera_${camera.id}_part${String(part).padStart(5,'0')}.mkv`;
  segment={file:name,hash_file:name+'.hashes.jsonl',part,first_sim_index:index,frames:0,encoded:false,verified:false,pixel_format:camera.pixelFormat};segments.push(segment);
  hashFD=fs.openSync(path.join(dir,segment.hash_file),'wx');
  atomicJSON(path.join(dir,`camera_${camera.id}_segments.json`),segments);
  encode=launch(ffmpeg,['-v','error','-n','-f','rawvideo','-pixel_format',FORMATS[camera.pixelFormat].ffmpeg,'-video_size',`${camera.width}x${camera.height}`,'-framerate',String(config.fps),'-i','pipe:0','-an','-c:v','ffv1','-level','3','-threads','1','-g','1','-slicecrc','1',path.join(dir,name)]);
  encode.stdout.resume();
}
async function write(frame){
  if(config.scenario==='slow-writer')await delay(80);
  if(config.scenario==='writer-failure'&&total>=config.faultPulse)throw new Error('INJECTED_WRITER_FAILURE');
  if(segment&&Math.floor(frame.index/config.fps/config.segmentSeconds)!==Math.floor(segment.first_sim_index/config.fps/config.segmentSeconds))await closeSegment();
  if(!segment)openSegment(frame.index);
  const b=Buffer.from(frame.pixels),sha256=hash(b),videoIndex=segment.frames;
  await new Promise((resolve,reject)=>encode.stdin.write(b,e=>e?reject(e):resolve()));
  const row={session_id:sessionId,camera_serial:'',video_part:segment.file,video_frame_index:videoIndex,
    camera_block_id:'',camera_timestamp_ticks:'',camera_tick_hz:'',pc_receive_monotonic_ns:frame.pcNs,
    record_status:'submitted_to_encoder',frame_width:camera.width,frame_height:camera.height,
    sim_camera_id:camera.id,sim_event_id:frame.eventId,sim_block_id:frame.block,sim_camera_ticks:frame.cameraTicks,
    clock_domain:`sim_camera_${camera.id}`,sha256,pixel_format:camera.pixelFormat};
  appendCSV(frameFD,frameColumns,row);
  fs.appendFileSync(hashFD,JSON.stringify({video_frame_index:videoIndex,sha256})+'\n');
  segment.frames++;total++;send({type:'written',index:frame.index,part:segment.file,videoIndex});
}
async function fault(e){
  if(failed)return;failed=true;send({type:'fault',error:e.message});
  try{await closeSegment();}catch(closeError){send({type:'fault',error:closeError.message});}
}
parentPort.on('message',message=>{
  chain=chain.then(async()=>{
    if(message.type==='frame'){if(!failed)await write(message.frame);}
    else if(message.type==='finish'){
      try{await closeSegment();for(const s of segments)if(s.encoded){try{s.verification=await verifyVideo(ffmpeg,path.join(dir,s.file),path.join(dir,s.hash_file),camera.pixelFormat);s.verified=true;}catch(e){s.verification_error=e.message;failed=true;send({type:'fault',error:e.message});}}}
      catch(e){await fault(e);}
      atomicJSON(path.join(dir,`camera_${camera.id}_segments.json`),segments);
      if(hashFD!==undefined){fs.closeSync(hashFD);hashFD=undefined;}fs.fsyncSync(frameFD);fs.closeSync(frameFD);
      send({type:'finished',total,segments,failed});parentPort.close();
    }
  }).catch(fault);
});
send({type:'ready'});
