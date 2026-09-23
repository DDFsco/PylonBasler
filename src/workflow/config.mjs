import fs from 'node:fs';
import path from 'node:path';
export const FORMATS={Mono8:{bytes:1,ffmpeg:'gray'},BayerRG8:{bytes:1,ffmpeg:'gray'},Mono16:{bytes:2,ffmpeg:'gray16le'}};
export function configOf(input={}){
  const c={mode:'simulation',fps:100,durationSeconds:10,segmentSeconds:60,queueFrames:128,memoryBudgetMB:256,reserveBytes:256*1024*1024,scenario:'clean',faultPulse:12,realtime:true,...input};
  c.cameras=input.cameras??Array.from({length:input.cameraCount??2},(_,i)=>({id:`SIM_${i+1}`,serial:'',width:160,height:96,pixelFormat:'Mono8'}));
  if(c.mode!=='simulation')throw new Error('HARDWARE_GATE_CLOSED: real capture requires validated adapter, wiring and trigger evidence');
  if(!Array.isArray(c.cameras)||c.cameras.length<1||c.cameras.length>6)throw new Error('Select 1..6 cameras');
  const ids=new Set();
  for(const camera of c.cameras){
    if(!/^SIM_[1-6]$/.test(camera.id)||ids.has(camera.id))throw new Error('Duplicate or invalid camera identity');ids.add(camera.id);
    if(camera.serial)throw new Error('Simulation cannot claim a hardware serial');
    for(const k of ['width','height'])if(!Number.isInteger(camera[k])||camera[k]<16||camera[k]>4096)throw new Error('Invalid ROI');
    if(!FORMATS[camera.pixelFormat])throw new Error('Unsupported pixel format');
  }
  for(const [key,min,max] of [['fps',1,100],['segmentSeconds',0.01,60],['queueFrames',1,1024],['memoryBudgetMB',1,2048],['reserveBytes',0,1e15]])
    if(!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw new Error(`Invalid ${key}`);
  if(!Number.isInteger(c.queueFrames))throw new Error('Queue must have integer capacity');
  if(!Number.isInteger(c.fps))throw new Error('Simulation fps must be an integer');
  if(c.durationSeconds!==null&&(!Number.isFinite(c.durationSeconds)||c.durationSeconds<=0||c.durationSeconds>604800))throw new Error('Duration must be positive, <=7 days, or null for manual stop');
  if(!['clean','missing-frame','missing-ttl','duplicate-frame','duplicate-ttl','ambiguous','disconnect','writer-failure','slow-writer','clock-reset','disk-full'].includes(c.scenario))throw new Error('Unknown scenario');
  if(typeof c.realtime!=='boolean'||!Number.isInteger(c.faultPulse)||c.faultPulse<0)throw new Error('Invalid simulation settings');
  const bytes=c.cameras.reduce((n,x)=>n+x.width*x.height*FORMATS[x.pixelFormat].bytes,0);
  // Include one in-flight buffer, a preview/generator buffer, and worker/codec overhead allowance.
  if(bytes*(c.queueFrames+3)>c.memoryBudgetMB*1e6)throw new Error('Queue image memory exceeds budget');
  c.rateBytesPerSecond=bytes*c.fps;c.queueImageBytes=bytes*(c.queueFrames+3);
  return c;
}
export function findFFmpeg(){
  if(process.env.FFMPEG_PATH)return process.env.FFMPEG_PATH;
  const root=path.resolve('work/tools/ffmpeg');
  if(fs.existsSync(root))for(const d of fs.readdirSync(root)){const p=path.join(root,d,'bin','ffmpeg.exe');if(fs.existsSync(p))return p;}
  return 'ffmpeg';
}
export function atomicJSON(file,value){
  const tmp=`${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');
  for(let attempt=0;;attempt++){
    try{fs.renameSync(tmp,file);return;}
    catch(error){
      if(!['EPERM','EACCES'].includes(error.code)||attempt===19){try{fs.unlinkSync(tmp);}catch{}throw error;}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
    }
  }
}
export const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
export function csvLine(keys,row){return keys.map(k=>cell(row[k])).join(',')+'\n';}
export function appendCSV(file,keys,row){fs.appendFileSync(file,csvLine(keys,row));}
export const frameColumns='session_id,camera_serial,video_part,video_frame_index,camera_block_id,camera_timestamp_ticks,camera_tick_hz,pc_receive_monotonic_ns,record_status,frame_width,frame_height,sim_camera_id,sim_event_id,sim_block_id,sim_camera_ticks,clock_domain,sha256,pixel_format'.split(',');
export const ttlColumns='ttl_index,edge,tdt_sample_index,tdt_sample_rate_hz,tdt_time_s,event_source,event_channel,sim_event_id,sim_sample_index,sim_sample_rate_hz,clock_domain'.split(',');
export const mapColumns='camera_serial,video_part,video_frame_index,camera_block_id,ttl_index,tdt_sample_index,match_status,quality_flag,sim_camera_id,sim_event_id'.split(',');
