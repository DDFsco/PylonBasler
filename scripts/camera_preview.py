"""Small display-only RGB preview; never used as recording input."""
import base64
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import numpy as np

WINDOWS_FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

def publish_preview(path, value, attempts=8):
    """Retry transient Windows sharing conflicts on a preview worker, not capture."""
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value), encoding='utf-8')
    for attempt in range(attempts):
        try:
            temp.replace(path)
            return
        except PermissionError:
            if attempt + 1 == attempts:
                raise
            time.sleep(0.01)

def preview(payload, width, height, pixel, max_width=480):
    raw = np.frombuffer(payload, dtype='<u2' if pixel == 'Mono16' else 'u1').reshape(height, width)
    if not isinstance(max_width, int) or not 64 <= max_width <= 1920:
        raise ValueError('Preview width must be between 64 and 1920 pixels')
    if pixel == 'BayerRG8':
        h, w = height // 2 * 2, width // 2 * 2
        # Subsample the mosaic before allocating RGB planes. Live preview is
        # display-only, so this keeps its memory traffic independent of the
        # native recording resolution.
        step = max(1, ((w // 2) + max_width - 1) // max_width)
        stride = 2 * step
        red = raw[:h:stride, :w:stride]
        green = ((raw[:h:stride, 1:w:stride].astype(np.uint16) +
                  raw[1:h:stride, :w:stride]) // 2).astype(np.uint8)
        blue = raw[1:h:stride, 1:w:stride]
        rgb = np.stack((red, green, blue), axis=-1)
    else:
        gray = (raw >> 8).astype(np.uint8) if pixel == 'Mono16' else raw
        step = max(1, (gray.shape[1] + max_width - 1) // max_width)
        gray = gray[::step, ::step]
        rgb = np.repeat(gray[:, :, None], 3, axis=2)
    rgb = rgb.copy()
    return {'width': rgb.shape[1], 'height': rgb.shape[0], 'channels': 3,
            'data': base64.b64encode(rgb.tobytes()).decode(),
            'display_conversion': 'Bayer RG 2x2 RGB, no color calibration' if pixel == 'BayerRG8' else pixel}


def resolve_segment(report, index):
    """Return the video file and segment-local frame index."""
    segments = report.get('segments')
    if not segments:
        return 'camera.mkv', index
    for segment in segments:
        first = int(segment['first_frame'])
        count = int(segment['decoded_frames'])
        if first <= index < first + count:
            return segment['file'], index - first
    raise ValueError('Frame index is not represented by a verified segment')

if __name__ == '__main__':
    folder, index = pathlib.Path(sys.argv[1]), int(sys.argv[2])
    report = json.loads((folder / 'report.json').read_text())
    if index < 0 or index >= report.get('decoded_frames', 0):
        raise ValueError('Frame index outside decoded recording')
    pixel = report['pixel_format']
    fmt = {'Mono8': 'gray', 'BayerRG8': 'gray', 'Mono16': 'gray16le'}[pixel]
    width, height = report['width'], report['height']
    if not (0 < width <= 8192 and 0 < height <= 8192):
        raise ValueError('Invalid dimensions')
    root = pathlib.Path(__file__).resolve().parents[1]
    configured_ffmpeg = os.environ.get('FFMPEG_PATH')
    bundled_ffmpeg = next((root / 'work/tools/ffmpeg').glob('*/bin/ffmpeg.exe'), None)
    exe = pathlib.Path(configured_ffmpeg) if configured_ffmpeg else bundled_ffmpeg or shutil.which('ffmpeg')
    if not exe:
        raise RuntimeError('FFmpeg was not found. Run scripts/setup.ps1 or set FFMPEG_PATH.')
    video_file, local_index = resolve_segment(report, index)
    fps = float(report['target_fps'])
    if not 0 < fps <= 1000:
        raise ValueError('Invalid recording frame rate')
    # FFVHUFF is intra-frame. Input seeking avoids decoding every preceding
    # frame and makes replay time independent of the global frame index.
    data = subprocess.run([str(exe), '-v', 'error', '-xerror', '-ss', f'{local_index / fps:.9f}',
        '-i', str(folder / video_file), '-frames:v', '1', '-pix_fmt', fmt,
        '-f', 'rawvideo', 'pipe:1'], capture_output=True, timeout=15, check=True,
        creationflags=WINDOWS_FLAGS).stdout
    result = preview(data, width, height, pixel)
    result.update(serial=report['serial'], frame_index=index, segment=video_file,
                  segment_frame_index=local_index, source='decoded_saved_video')
    print(json.dumps(result))
