"""Camera configuration only; never starts acquisition."""
import json, math, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'work/python-deps'))
from pypylon import pylon, genicam
FIELDS = ['ExposureAuto','ExposureTime','GainAuto','Gain','Width','Height','OffsetX','OffsetY','PixelFormat']
ENUMS = {'ExposureAuto','GainAuto','PixelFormat'}
INTS = {'Width','Height','OffsetX','OffsetY'}

def snapshot(camera):
    result = {'serial':camera.GetDeviceInfo().GetSerialNumber(),'fields':{}}
    for name in FIELDS + ['ResultingFrameRate','AcquisitionFrameRateEnable','AcquisitionFrameRate']:
        try:
            n = camera.GetNodeMap().GetNode(name)
            if not genicam.IsReadable(n): continue
            item = {'value':n.GetValue(),'writable':genicam.IsWritable(n) and name in FIELDS}
            if name in ENUMS:
                item['choices'] = [e.GetSymbolic() for e in n.GetEntries() if genicam.IsAvailable(e)]
                if name == 'PixelFormat': item['choices'] = [x for x in item['choices'] if x in ['Mono8','Mono16','BayerRG8']]
            elif name in FIELDS:
                item.update(min=n.GetMin(),max=n.GetMax())
                if name in INTS: item['step'] = n.GetInc()
            result['fields'][name] = item
        except genicam.GenericException: continue
    return result

def validate(changes, current):
    if not isinstance(changes,dict) or not changes or any(k not in FIELDS for k in changes): raise ValueError('No valid settings selected')
    for name,value in changes.items():
        info = current['fields'].get(name)
        if not info: raise ValueError(name+' unavailable')
        override = (name=='ExposureTime' and changes.get('ExposureAuto')=='Off') or (name=='Gain' and changes.get('GainAuto')=='Off')
        auto = {'ExposureTime':'ExposureAuto','Gain':'GainAuto'}.get(name)
        if auto and current['fields'].get(auto,{}).get('value','Off')!='Off' and changes.get(auto)!='Off': raise ValueError(name+': disable automatic control first')
        if not info['writable'] and not override: raise ValueError(name+' is read-only; disable automatic control first')
        if name in ENUMS:
            if value not in info['choices']: raise ValueError(name+': unsupported value')
        else:
            if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value): raise ValueError(name+': finite number required')
            if not info['min']<=value<=info['max']: raise ValueError(f"{name}: range {info['min']} to {info['max']}")
            if name in INTS and (int(value)!=value or (value-info['min'])%info['step']): raise ValueError(name+': invalid increment')

def write(camera, values):
    nm=camera.GetNodeMap()
    roi=bool(set(values)&INTS)
    offsets={k:nm.GetNode(k).GetValue() for k in ['OffsetX','OffsetY']} if roi else {}
    if roi:
        for k in offsets:
            n=nm.GetNode(k)
            if genicam.IsWritable(n): n.SetValue(n.GetMin())
    for manual,auto in [('ExposureTime','ExposureAuto'),('Gain','GainAuto')]:
        if manual in values: nm.GetNode(auto).SetValue('Off')
    for k in ['PixelFormat','Width','Height','ExposureTime','Gain','ExposureAuto','GainAuto']:
        if k in values: nm.GetNode(k).SetValue(int(values[k]) if k in INTS else values[k])
    if roi:
        for k in offsets: nm.GetNode(k).SetValue(int(values.get(k,offsets[k])))

def execute(request):
    f=pylon.TlFactory.GetInstance(); devices=f.EnumerateDevices()
    if request.get('operation')=='list': return {'devices':[{'serial':d.GetSerialNumber(),'model':d.GetModelName()} for d in devices]}
    matches=[d for d in devices if d.GetSerialNumber()==request.get('serial')]
    if len(matches)!=1: raise ValueError('Selected camera not found')
    c=pylon.InstantCamera(f.CreateDevice(matches[0]))
    try:
        c.Open(); before=snapshot(c)
        if request.get('operation')=='read': return before
        if request.get('operation')!='apply': raise ValueError('Invalid operation')
        changes=request.get('changes');validate(changes,before)
        keys=set(changes)
        if keys&INTS: keys|=INTS
        old={k:before['fields'][k]['value'] for k in keys if k in before['fields']}
        try:
            write(c,changes); after=snapshot(c);after['applied']=True;after['requested']=changes;return after
        except Exception as e:
            rollback='restored'
            try: write(c,old)
            except Exception as restore: rollback='FAILED: '+str(restore)
            return {'error':str(e),'rollback':rollback,'actual':snapshot(c)}
    finally:
        if c.IsOpen():c.Close()

if __name__=='__main__':
    try: print(json.dumps(execute(json.load(sys.stdin))))
    except Exception as e: print(json.dumps({'error':str(e)}))
