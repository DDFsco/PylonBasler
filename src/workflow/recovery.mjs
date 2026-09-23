import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {verifyVideo} from './video.mjs';
import {findFFmpeg} from './config.mjs';
import {parseCSV} from './tdt-import.mjs';
export async function inspectSession(dir,ffmpeg=findFFmpeg()){
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  const result={session_id:manifest.session_id,schema_version:manifest.schema_version,original_state:manifest.state,hardware_acceptance:false,
    legacy_metadata_only:manifest.schema_version==='0.1',journal_rows:0,malformed_journal_rows:0,segments:[],issues:[]};
  const journal=path.join(dir,'logs/events.jsonl');
  if(fs.existsSync(journal))for await(const line of readline.createInterface({input:fs.createReadStream(journal),crlfDelay:Infinity}))try{JSON.parse(line);result.journal_rows++;}catch{result.malformed_journal_rows++;}
  if(result.malformed_journal_rows)result.issues.push('Journal has malformed/truncated rows; originals preserved');
  if(!['COMPLETE','FAULT'].includes(manifest.state))result.issues.push('Interrupted or unfinished session');
  if(result.legacy_metadata_only){result.issues.push('Legacy metadata-only session: no video evidence');return result;}
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.mkv'))){
    const row={file,verified:false};
    try{
      const camera=manifest.config.cameras.find(c=>file.startsWith(`camera_${c.id}_part`));if(!camera)throw new Error('Unknown camera');
      Object.assign(row,await verifyVideo(ffmpeg,path.join(dir,file),path.join(dir,file+'.hashes.jsonl'),camera.pixelFormat),{verified:true});
    }catch(e){row.error=e.message;result.issues.push(`${file}: ${e.message}`);}result.segments.push(row);
  }
  if(!result.segments.length)result.issues.push('No video segments');
  result.frame_metadata_rows=0;
  for(const camera of manifest.config.cameras){
    const counts=new Map();
    try{
      let header,currentPart=null,hashes=[];
      for await(const line of readline.createInterface({input:fs.createReadStream(path.join(dir,`camera_${camera.id}_frames.csv`)),crlfDelay:Infinity})){
        const cells=parseCSV(line)[0];if(!cells)continue;if(!header){header=cells;continue;}
        if(cells.length!==header.length)throw new Error('Truncated frame metadata');
        const r=Object.fromEntries(header.map((k,i)=>[k,cells[i]]));
        if(!/^\d+$/.test(r.video_frame_index)||!r.sha256)throw new Error('Invalid frame metadata');
        if(!/^camera_SIM_[1-6]_part\d{5,}\.mkv$/.test(r.video_part))throw new Error('Invalid segment reference');
        if(currentPart!==r.video_part){currentPart=r.video_part;hashes=fs.readFileSync(path.join(dir,currentPart+'.hashes.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x).sha256);}
        if(hashes[Number(r.video_frame_index)]!==r.sha256)throw new Error('Frame CSV pixel hash differs from encoder evidence');
        const expected=counts.get(r.video_part)??0;if(Number(r.video_frame_index)!==expected)throw new Error('Frame metadata index is duplicated or discontinuous');
        counts.set(r.video_part,expected+1);result.frame_metadata_rows++;
      }
      for(const [file,count] of counts){const s=result.segments.find(s=>s.file===file);if(!s?.verified||s.decoded_frames!==count)result.issues.push(`Metadata/decode mismatch: ${file}`);}
      for(const s of result.segments.filter(s=>s.file.startsWith(`camera_${camera.id}_`)))if(!counts.has(s.file))result.issues.push(`Missing metadata: ${s.file}`);
    }catch(e){result.issues.push(`${camera.id}: ${e.message}`);}
  }
  result.recovery_policy='Read-only audit. Verified segments are usable image evidence; do not infer complete recording or timing acceptance. Preserve originals.';
  return result;
}
