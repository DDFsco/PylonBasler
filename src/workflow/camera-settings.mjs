import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../../scripts/camera_settings.py',import.meta.url));
export function cameraSettings(request){return new Promise((resolve,reject)=>{
  const project=fileURLToPath(new URL('../../',import.meta.url));
  const venv=path.join(project,'.venv','Scripts','python.exe'),bundled=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const python=process.env.CAMERA_PYTHON??(fs.existsSync(venv)?venv:(fs.existsSync(bundled)?bundled:(process.platform==='win32'?'python':'python3')));
  const p=spawn(python,[script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
  p.stdout.on('data',b=>{out+=b;});p.stderr.on('data',b=>{err=(err+b).slice(-4000);});p.stdin.on('error',()=>{});p.on('error',reject);
  p.on('close',code=>{try{if(code!==0)throw Error(err||`Camera settings exit ${code}`);resolve(JSON.parse(out));}catch(e){reject(e);}});
  p.stdin.end(JSON.stringify(request));
});}
