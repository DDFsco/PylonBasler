import pathlib
import sys
import unittest

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from camera_preview import preview


class CameraPreviewTests(unittest.TestCase):
    def test_large_mono_frame_is_reduced_before_rgb_output(self):
        frame = np.arange(1920 * 1080, dtype=np.uint8).reshape(1080, 1920)
        result = preview(frame.tobytes(), 1920, 1080, 'Mono8', max_width=320)
        self.assertEqual((result['width'], result['height']), (320, 180))
        self.assertEqual(result['channels'], 3)

    def test_bayer_preview_preserves_rgb_channel_order_and_width_bound(self):
        frame = np.zeros((1080, 1920), dtype=np.uint8)
        frame[0::2, 0::2] = 11
        frame[0::2, 1::2] = 30
        frame[1::2, 0::2] = 50
        frame[1::2, 1::2] = 99
        result = preview(frame.tobytes(), 1920, 1080, 'BayerRG8', max_width=320)
        self.assertEqual((result['width'], result['height']), (320, 180))
        self.assertEqual(result['channels'], 3)


if __name__ == '__main__':
    unittest.main()
