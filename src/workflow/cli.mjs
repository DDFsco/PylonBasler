import fs from 'node:fs';
import {Session} from './session.mjs';
import {inspectSession} from './recovery.mjs';
import {SynapseStatus} from './adapters.mjs';
const [command,target,configFile]=process.argv.slice(2);
try{
  if(command==='run'){
    const config=configFile?JSON.parse(fs.readFileSync(configFile,'utf8')):{};
    const s=new Session(target??'outputs/sessions',config);await s.precheck();await s.arm();s.start();
    process.once('SIGINT',()=>{if(s.state==='RECORDING')s.stop();});
    const r=await s.completion;console.log(JSON.stringify({directory:s.dir,...r},null,2));process.exitCode=r.simulation_pass?0:2;
  }else if(command==='audit'){console.log(JSON.stringify(await inspectSession(target),null,2));}
  else if(command==='tdt-status'){console.log(JSON.stringify(await new SynapseStatus().read(),null,2));}
  else throw new Error('Usage: node src/workflow/cli.mjs run OUTPUT_ROOT [CONFIG.json] | audit SESSION_DIR | tdt-status');
}catch(e){console.error(e.message);process.exitCode=1;}
