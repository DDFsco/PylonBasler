import pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from camera_settings import validate
class CameraSettingsTests(unittest.TestCase):
    def test_reject_before_writing(self):
        current={'fields':{'Width':{'writable':True,'min':4,'max':1448,'step':4},'ExposureAuto':{'writable':True,'choices':['Off','Continuous']},'ExposureTime':{'writable':False,'min':21,'max':1000000}}}
        for change in [{'Width':5},{'Width':True},{'Width':float('nan')},{'Width':2000},{'TriggerMode':'On'},{'ExposureAuto':'bad'},{'ExposureTime':5000}]:
            with self.assertRaises(ValueError):validate(change,current)
        validate({'ExposureAuto':'Off','ExposureTime':5000},current)
        validate({'Width':1440},current)
if __name__=='__main__':unittest.main()
