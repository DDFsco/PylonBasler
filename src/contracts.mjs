// Hardware adapters must implement these contracts; none are implemented here.
export class Camera { capture(pulse) { throw new Error('Camera.capture not implemented'); } }
export class TTL { observe(pulse) { throw new Error('TTL.observe not implemented'); } }
export class Neural { preview(pulse) { throw new Error('Neural.preview not implemented'); } }
export class Writer { write(stream, row) { throw new Error('Writer.write not implemented'); } }

export class StateMachine {
  state = 'IDLE'; history = ['IDLE'];
  move(next) {
    const path = ['IDLE','CONFIGURED','PRECHECKED','ARMED','RECORDING','FINALIZING','COMPLETE'];
    if (this.state === 'COMPLETE' || this.state === 'FAULT' ||
        (next !== 'FAULT' && path[path.indexOf(this.state)+1] !== next))
      throw new Error(`Invalid transition ${this.state} -> ${next}`);
    this.state = next; this.history.push(next);
  }
}

export class BoundedQueue {
  items = []; highWater = 0;
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid queue capacity');
    this.capacity = capacity;
  }
  push(item) {
    if (this.items.length >= this.capacity) throw new Error('QUEUE_OVERFLOW');
    this.items.push(item); this.highWater = Math.max(this.highWater, this.items.length);
  }
  peek() { return this.items[0]; }
  shift() { return this.items.shift(); }
}

export const schemas = {
  frames: 'session_id,camera_serial,video_part,video_frame_index,camera_block_id,camera_timestamp_ticks,camera_tick_hz,pc_receive_monotonic_ns,record_status,frame_width,frame_height,sim_camera_id,sim_event_id,sim_block_id,sim_camera_ticks,sim_camera_tick_hz,clock_domain',
  ttl: 'ttl_index,edge,tdt_sample_index,tdt_sample_rate_hz,tdt_time_s,event_source,event_channel,sim_event_id,sim_sample_index,sim_sample_rate_hz,sim_time_s,clock_domain',
  map: 'camera_serial,video_part,video_frame_index,camera_block_id,ttl_index,tdt_sample_index,match_status,quality_flag,sim_camera_id,sim_event_id,sim_block_id',
  neural: 'channel,tdt_sample_index,tdt_time_s,value,unit,decimation_factor,sim_sample_index,sim_sample_rate_hz,sim_time_s,clock_domain'
};
