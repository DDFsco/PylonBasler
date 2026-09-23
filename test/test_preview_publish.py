import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from camera_preview import publish_preview

class PreviewPublishTests(unittest.TestCase):
    def test_transient_sharing_conflict_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / 'preview.json'
            target.write_text('{"old":true}')
            original = pathlib.Path.replace
            calls = []
            def replace(source, destination):
                calls.append(1)
                if len(calls) < 3:
                    self.assertEqual(target.read_text(), '{"old":true}')
                    raise PermissionError('sharing violation')
                return original(source, destination)
            with patch.object(pathlib.Path, 'replace', replace):
                publish_preview(target, {'frame': 12})
            self.assertEqual(len(calls), 3)
            self.assertIn('12', target.read_text())

    def test_permanent_denial_is_bounded_and_keeps_last_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / 'preview.json'
            target.write_text('previous')
            with patch.object(pathlib.Path, 'replace', side_effect=PermissionError('denied')) as replace:
                with self.assertRaises(PermissionError):
                    publish_preview(target, {'frame': 13}, attempts=3)
                self.assertEqual(replace.call_count, 3)
            self.assertEqual(target.read_text(), 'previous')

if __name__ == '__main__':
    unittest.main()
