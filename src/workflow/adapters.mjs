// Real adapters implement prepare/arm/start/stop/health; unavailable capabilities fail closed.
export class Adapter {
  state='IDLE';
  async prepare(){this.state='PREPARED';}
  async arm(){if(this.state!=='PREPARED')throw new Error('Adapter not prepared');this.state='ARMED';}
  async start(){if(this.state!=='ARMED')throw new Error('Adapter not armed');this.state='RUNNING';}
  async stop(){this.state='STOPPED';}
  health(){return {state:this.state,simulation:true};}
}
export class ImageCamera extends Adapter {
  constructor(camera){super();this.camera=camera;}
  capture(index,eventId){
    if(this.state!=='RUNNING')throw new Error('Camera is not running');
    const c=this.camera,bpp=c.pixelFormat==='Mono16'?2:1,b=new Uint8Array(c.width*c.height*bpp);
    const view=new DataView(b.buffer);
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const n=y*c.width+x,code=c.id.charCodeAt(c.id.length-1);
      const v=(x*7+y*13+index*17+code*19)&(bpp===2?65535:255);
      if(bpp===2)view.setUint16(n*2,v,true);else b[n]=v;
    }
    view.setUint32(0,index,true); // visible/pixel-verifiable identity, not timing evidence
    return {pixels:b,index,eventId,cameraTicks:1000000+index*10000,pcNs:process.hrtime.bigint().toString()};
  }
}
export class SyntheticTrigger extends Adapter {
  pulse(index){if(this.state!=='RUNNING')throw new Error('Trigger not ready');return {id:`sim-event-${index}`,index};}
}
export class SyntheticNeural extends Adapter {
  sample(index,fps){const sample=Math.round(index*10000/fps);return {channel:'SIM_SINE',sample_index:sample,sample_rate_hz:10000,value:Math.sin(2*Math.PI*sample/10000),unit:'simulation_arbitrary',clock_domain:'sim_neural_clock'};}
}
// Read-only TDT endpoints verified against the installed vendor SynapseAPI.py.
export class SynapseStatus {
  constructor(base='http://127.0.0.1:24414'){this.base=base;}
  async read(){
    const paths={mode:'/system/mode',status:'/system/status',sampling_rates:'/processor/samprate',tank:'/tank/name',block:'/block/name'};
    const out={available:false,read_only:true,checked_utc:new Date().toISOString(),waveform_preview:'not_implemented'};
    for(const [k,p] of Object.entries(paths))try{const r=await fetch(this.base+p,{signal:AbortSignal.timeout(1500)});if(!r.ok)throw new Error(`HTTP ${r.status}`);out[k]=await r.json();}catch(e){out[k]={error:e.message};}
    out.available=typeof out.mode?.mode==='string';return out;
  }
}
