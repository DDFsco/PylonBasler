import {runSession,scenarios} from './simulator.mjs';
const [dir,scenario='clean',pulses='20']=process.argv.slice(2);
if(!dir){console.error(`Usage: node src/cli.mjs NEW_SESSION_DIR [${scenarios.join('|')}] [5..10000 pulses]`);process.exitCode=1;}
else {try{const r=runSession(dir,{scenario,pulses:Number(pulses)});console.log(JSON.stringify(r,null,2));process.exitCode=r.simulation_qc_pass?0:2;}catch(e){console.error(e.message);process.exitCode=1;}}
