// Offline calibrated matching. Never substitutes ordinal pairing for missing evidence.
// Ticks must be safe integers; reject values that have lost precision at the API boundary.
export function matchCalibrated(frames,ttls,calibration){
  const valid=calibration?.validated===true&&typeof calibration.evidence==='string'&&calibration.evidence.length>0&&
    Number.isFinite(calibration.samplesPerTick)&&calibration.samplesPerTick>0&&
    Number.isSafeInteger(calibration.anchorTick)&&Number.isSafeInteger(calibration.anchorSample)&&
    Number.isFinite(calibration.uncertaintySamples)&&calibration.uncertaintySamples>=0&&
    Number.isSafeInteger(calibration.validFromTick)&&Number.isSafeInteger(calibration.validToTick)&&
    typeof calibration.cameraClock==='string'&&typeof calibration.tdtClock==='string';
  const map=frames.map(f=>({frame_id:f.id,ttl_index:null,status:'ambiguous',reason:'no_valid_calibration'}));
  if(!valid)return map;
  const candidates=frames.map(f=>{
    if(f.clock!==calibration.cameraClock||!Number.isSafeInteger(f.ticks)||f.ticks<calibration.validFromTick||f.ticks>calibration.validToTick)return null;
    const predicted=calibration.anchorSample+(f.ticks-calibration.anchorTick)*calibration.samplesPerTick;
    return ttls.map((t,i)=>({t,i})).filter(({t})=>t.clock===calibration.tdtClock&&Number.isSafeInteger(t.sample)&&Math.abs(t.sample-predicted)<=calibration.uncertaintySamples).map(x=>x.i);
  });
  const usages=new Map();for(const c of candidates??[])if(c?.length===1)usages.set(c[0],(usages.get(c[0])??0)+1);
  const used=new Set();
  candidates.forEach((c,i)=>{
    if(c===null){map[i].reason='outside_calibration_domain_or_interval';return;}
    if(!c.length){map[i].status='missing_ttl';map[i].reason='no_candidate_within_measured_uncertainty';return;}
    if(c.length!==1||usages.get(c[0])!==1){map[i].reason='multiple_candidates_or_shared_event';return;}
    map[i]={frame_id:frames[i].id,ttl_index:ttls[c[0]].index,status:'matched_calibrated',reason:calibration.evidence};used.add(c[0]);
  });
  for(let i=0;i<ttls.length;i++)if(!used.has(i))map.push({frame_id:null,ttl_index:ttls[i].index,status:'unmatched_ttl',reason:'no_unique_calibrated_frame'});
  return map;
}
