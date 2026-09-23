import {Session} from '../src/workflow/session.mjs';
import fs from 'node:fs';
import path from 'node:path';
const s=new Session(process.argv[2],{cameraCount:1,durationSeconds:null,segmentSeconds:0.05,realtime:true});
await s.precheck();await s.arm();s.start();
setInterval(()=>{try{const segments=JSON.parse(fs.readFileSync(path.join(s.dir,'camera_SIM_1_segments.json')));if(segments.some(x=>x.encoded)&&s.qc.events>=15)process.stdout.write('READY\n');}catch{}},100).unref();
