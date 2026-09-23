import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const project=fileURLToPath(new URL('../../',import.meta.url));
export function validateSettings(options={}){
  const {fps=10,seconds=10}=options;
  if(!Number.isInteger(fps)||fps<1||fps>100||!Number.isInteger(seconds)||seconds<1||seconds>14400)throw new Error('A real study requires integer fps from 1–100 and duration from 1–14,400 seconds');
  return {fps,seconds};
}
export function validateSerials(value){
  const serials=Array.isArray(value)?value:[value];
  if(serials.length<1||serials.length>6||serials.some(s=>typeof s!=='string'||!/^\d{6,12}$/.test(s)))throw new Error('Enter 1–6 camera serial numbers');
  if(new Set(serials).size!==serials.length)throw new Error('Duplicate camera serial number');
  return serials;
}
export function summarizeChecks(reports){
  const valid=reports.every(r=>r.first_pc_monotonic_ns&&r.last_pc_monotonic_ns);
  const first=valid?reports.map(r=>BigInt(r.first_pc_monotonic_ns)):[];
  const last=valid?reports.map(r=>BigInt(r.last_pc_monotonic_ns)):[];
  const overlap=valid?Math.max(0,Number(last.reduce((a,b)=>a<b?a:b)-first.reduce((a,b)=>a>b?a:b))/1e9):0;
  const passed=reports.every(r=>r.state==='COMPLETE'&&r.video_verified&&r.settings_restored===true)&&overlap>0;
  return {state:passed?'COMPLETE':'FAULT',mode:'real_multi_camera_study',camera_count:reports.length,
    capture_mode:'free_run_no_ttl',ttl_required:false,ttl_recorded:false,
    hardware_acceptance:false,synchronization_verified:false,video_verified:passed,
    pc_receive_overlap_s:overlap,overlap_basis:'host_monotonic_receive_times_not_exposure_sync',
    received_frames:reports.reduce((n,r)=>n+(r.received_frames??0),0),
    written_frames:reports.reduce((n,r)=>n+(r.written_frames??0),0),
    decoded_frames:reports.reduce((n,r)=>n+(r.decoded_frames??0),0),
    faults:[...reports.flatMap(r=>(r.faults??[]).map(message=>`${r.serial??'camera'}: ${message}`)),...(!overlap?['Concurrent receive overlap not verified']:[])],streams:reports};
}
export class RealCameraCheck {
  state='IDLE'; report=null; child=null; directory=null;
  constructor(root=path.join(project,'outputs/real-camera-checks')){this.root=root;}
  status(){return {state:this.state,mode:this.members?'real_multi_camera_study':'real_single_camera_study',capture_mode:'free_run_no_ttl',ttl_required:false,report:this.report};}
  previews(){
    if(this.members)return this.members.flatMap(m=>m.previews());
    if(!this.directory)return [];
    try{return [{...JSON.parse(fs.readFileSync(path.join(this.directory,'preview.json'),'utf8')),active:!!this.child}];}catch{return [];}
  }
  start(serial,options={}){
    if(this.child)throw new Error('A real camera study is already active');
    const serials=validateSerials(serial);
    const settings=validateSettings(options);
    if(serials.length>1)return this.startGroup(serials,settings);
    serial=serials[0];this.members=null;
    const venv=path.join(project,'.venv','Scripts','python.exe');
    const bundled=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
    const python=process.env.CAMERA_PYTHON??(fs.existsSync(venv)?venv:(fs.existsSync(bundled)?bundled:(process.platform==='win32'?'python':'python3')));
    this.directory=path.join(this.root,'run_'+randomUUID());fs.mkdirSync(this.directory,{recursive:true});
    this.state='RUNNING';this.report=null;
    const child=spawn(python,[path.join(project,'scripts/real-camera-check.py'),'--serial',serial,'--fps',String(settings.fps),'--seconds',String(settings.seconds),'--output',this.directory],{cwd:project,windowsHide:true,stdio:['ignore','pipe','pipe']});
    this.child=child;let output='',errors='';
    child.stdout.on('data',b=>{output=(output+b).slice(-100000);});child.stderr.on('data',b=>{errors=(errors+b).slice(-8192);});
    child.on('error',e=>{errors=e.message;});
    this.completion=new Promise(resolve=>child.once('close',code=>{
      clearTimeout(timer);
      try{this.report=JSON.parse(output.trim());}catch{this.report={state:'FAULT',faults:[errors||`Camera process exited ${code}`],settings_restored:'unknown',directory:this.directory};}
      this.state=code===0&&this.report.video_verified?'COMPLETE':'FAULT';
      this.report.state=this.state;fs.writeFileSync(path.join(this.directory,'process-result.json'),JSON.stringify(this.report,null,2));
      this.child=null;resolve(this.report);
    }));
    const timer=setTimeout(()=>this.stop('Recording watchdog timeout'),(settings.seconds+Math.max(120,settings.seconds*2))*1000); // includes lossless decode verification
    return this.status();
  }
  startGroup(serials,settings){
    this.directory=path.join(this.root,'group_'+randomUUID());fs.mkdirSync(this.directory,{recursive:true});
    this.members=serials.map(()=>new RealCameraCheck(this.directory));this.child={};this.state='RUNNING';this.report=null;
    const promises=this.members.map((member,i)=>{
      try{member.start(serials[i],settings);return member.completion.then(r=>{if(r.state!=='COMPLETE')this.stop(`Stopped because camera ${serials[i]} failed`);return r;});}
      catch(e){return Promise.resolve({state:'FAULT',serial:serials[i],faults:[e.message]});}
    });
    this.completion=Promise.all(promises).then(reports=>{
      this.report=summarizeChecks(reports);this.report.directory=this.directory;
      this.state=this.report.state;this.child=null;
      fs.writeFileSync(path.join(this.directory,'group-report.json'),JSON.stringify(this.report,null,2));return this.report;
    });
    return this.status();
  }
  stop(reason='Stopped by operator'){if(this.child){if(this.members)this.members.forEach(m=>m.stop(reason));else {const file=path.join(this.directory,'STOP');if(!fs.existsSync(file))fs.writeFileSync(file,reason);}this.state='STOPPING';}return this.status();}
}
