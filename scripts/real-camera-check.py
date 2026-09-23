"""Bounded real-camera study in free-run or external-TTL trigger mode."""
import argparse
import csv
import datetime
import hashlib
import json
import pathlib
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'work/python-deps'))
from pypylon import pylon
from camera_preview import preview, publish_preview
from camera_settings import snapshot


def save(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2), encoding='utf-8')
    temp.replace(path)


def run(serial, output, fps=10, seconds=10, camera_count=1,
        capture_mode='free_run_no_ttl', trigger_source='Line1', trigger_wait_seconds=120):
    if not (isinstance(fps, int) and 1 <= fps <= 100 and isinstance(seconds, int) and 1 <= seconds <= 14400):
        raise ValueError('A real study requires fps 1–100 and duration 1–14,400 seconds')
    if not isinstance(camera_count, int) or not 1 <= camera_count <= 6:
        raise ValueError('Camera count must be between 1 and 6')
    if capture_mode not in {'free_run_no_ttl', 'external_ttl_frame_start'}:
        raise ValueError('Capture mode must be free_run_no_ttl or external_ttl_frame_start')
    if not isinstance(trigger_source, str) or not trigger_source.startswith('Line'):
        raise ValueError('External trigger source must be a physical camera input line')
    if not isinstance(trigger_wait_seconds, int) or not 5 <= trigger_wait_seconds <= 600:
        raise ValueError('Trigger wait must be 5–600 seconds')
    ttl_mode = capture_mode == 'external_ttl_frame_start'
    target = fps * seconds
    configured_ffmpeg = os.environ.get('FFMPEG_PATH')
    bundled_ffmpeg = next((ROOT / 'work/tools/ffmpeg').glob('*/bin/ffmpeg.exe'), None)
    ffmpeg = pathlib.Path(configured_ffmpeg) if configured_ffmpeg else bundled_ffmpeg or shutil.which('ffmpeg')
    if not ffmpeg:
        raise RuntimeError('FFmpeg was not found. Run scripts/setup.ps1 or set FFMPEG_PATH.')
    factory = pylon.TlFactory.GetInstance()
    devices = [d for d in factory.EnumerateDevices() if d.GetSerialNumber() == serial]
    if len(devices) != 1:
        raise RuntimeError('Exactly one camera must match the selected serial')
    output.mkdir(parents=True, exist_ok=True)
    folder = output / ('real_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S_') + uuid.uuid4().hex[:8])
    folder.mkdir()
    report = {'state': 'PRECHECK', 'mode': 'real_single_camera_study', 'serial': serial,
              'capture_mode': capture_mode, 'ttl_required': ttl_mode, 'ttl_recorded': False,
              'trigger_source': trigger_source if ttl_mode else None,
              'trigger_activation': 'RisingEdge' if ttl_mode else None,
              'model': devices[0].GetModelName(), 'target_fps': fps, 'target_frames': target,
              'target_seconds': seconds, 'queue_capacity': 16, 'queue_high_water': 0,
              'group_camera_count': camera_count, 'video_codec': 'FFVHUFF',
              'hardware_acceptance': False, 'synchronization_verified': False,
              'received_frames': 0, 'written_frames': 0, 'decoded_frames': 0,
              'faults': [], 'settings_restored': False, 'video_verified': False,
              'directory': str(folder), 'timestamp_units': 'camera_native_ticks_unconverted'}
    camera = pylon.InstantCamera(factory.CreateDevice(devices[0]))
    original = {}
    encoder = None
    worker = None
    items = queue.Queue(maxsize=16)
    writer_errors = []
    hashes = []
    times = []
    block_ids = []
    ticks = []
    stderr = None
    stop_writer = threading.Event()
    preview_items = queue.Queue(maxsize=1)
    preview_stop = threading.Event()
    preview_target_fps = 10
    report['preview_target_fps'] = preview_target_fps
    preview_times = []
    def publish_displays():
        while not preview_stop.is_set() or not preview_items.empty():
            try:
                payload, index, pc = preview_items.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                display = preview(payload, width, height, pixel, max_width=320)
                display.update(serial=serial, frame_index=index, source='live_camera',
                               updated_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
                publish_preview(output / 'preview.json', display)
                report.pop('preview_error', None)
                report['preview_updates'] = report.get('preview_updates', 0) + 1
                preview_times.append(pc)
            except Exception as exc:
                report['preview_error'] = str(exc)
                report['preview_failed_updates'] = report.get('preview_failed_updates', 0) + 1
    preview_worker = threading.Thread(target=publish_displays, daemon=True)
    preview_worker.start()
    save(folder / 'report.json', report)
    try:
        camera.Open()
        # Preserve every trigger selector before configuring free run or the
        # external FrameStart input. The original camera setup is restored later.
        selector = camera.TriggerSelector.Value
        trigger_settings = {}
        original['trigger_selector'] = selector
        original['trigger_settings'] = trigger_settings
        try:
            for name in camera.TriggerSelector.Symbolics:
                camera.TriggerSelector.Value = name
                values = {'mode': camera.TriggerMode.Value}
                for field in ['TriggerSource', 'TriggerActivation']:
                    try:
                        values[field] = getattr(camera, field).Value
                    except Exception:
                        pass
                trigger_settings[name] = values
                if camera.TriggerMode.Value != 'Off':
                    camera.TriggerMode.Value = 'Off'
                if camera.TriggerMode.Value != 'Off':
                    raise RuntimeError('Unable to disable trigger while configuring: ' + name)
            if ttl_mode:
                camera.TriggerSelector.Value = 'FrameStart'
                if trigger_source not in camera.TriggerSource.Symbolics:
                    raise RuntimeError(f'{trigger_source} is not available as a FrameStart trigger source')
                camera.TriggerSource.Value = trigger_source
                camera.TriggerActivation.Value = 'RisingEdge'
                try:
                    original['exposure_mode'] = camera.ExposureMode.Value
                    camera.ExposureMode.Value = 'Timed'
                except Exception:
                    pass
                try:
                    original['line_selector'] = camera.LineSelector.Value
                    camera.LineSelector.Value = trigger_source
                    original['line_mode'] = camera.LineMode.Value
                    if camera.LineMode.Value != 'Input':
                        camera.LineMode.Value = 'Input'
                    report['trigger_line_status_at_arm'] = bool(camera.LineStatus.Value)
                except Exception as exc:
                    report['trigger_line_configuration_note'] = str(exc)
                camera.TriggerMode.Value = 'On'
                if (camera.TriggerMode.Value != 'On' or camera.TriggerSource.Value != trigger_source or
                        camera.TriggerActivation.Value != 'RisingEdge'):
                    raise RuntimeError('External FrameStart trigger configuration readback failed')
        finally:
            camera.TriggerSelector.Value = selector
        pixel = camera.PixelFormat.Value
        formats = {'Mono8': ('gray', 1), 'BayerRG8': ('gray', 1), 'Mono16': ('gray16le', 2)}
        if pixel not in formats:
            raise RuntimeError('Unsupported native pixel format: ' + pixel)
        fmt, bpp = formats[pixel]
        width, height = camera.Width.Value, camera.Height.Value
        frame_bytes = width * height * bpp
        queue_capacity = min(64, 256 * 1024 * 1024 // frame_bytes - 12)
        if queue_capacity < 8:
            raise RuntimeError('Image buffer memory limit exceeded')
        items = queue.Queue(maxsize=queue_capacity)
        report['queue_capacity'] = queue_capacity
        # Every camera process sees the same volume. Reserve enough for the
        # complete group at near-raw size so concurrent studies cannot each
        # pass a one-camera check against the same free bytes.
        required_bytes = int(frame_bytes * target * camera_count * 1.1 + 512 * 1024 * 1024)
        report['disk_required_bytes'] = required_bytes
        report['disk_free_bytes_at_start'] = shutil.disk_usage(folder).free
        if report['disk_free_bytes_at_start'] < required_bytes:
            raise RuntimeError(f'Insufficient disk space: require {required_bytes} bytes for {camera_count} camera(s)')
        rate = camera.GetNodeMap().GetNode('AcquisitionFrameRate')
        original.update(rate=rate.GetValue(), enabled=camera.AcquisitionFrameRateEnable.Value)
        if ttl_mode:
            try:
                camera.AcquisitionFrameRateEnable.Value = False
            except Exception:
                pass
        else:
            camera.AcquisitionFrameRateEnable.Value = True
            rate.SetValue(float(fps))
            if abs(rate.GetValue() - fps) > 0.01:
                raise RuntimeError('Frame-rate setting readback failed')
        report['resulting_fps_readback'] = camera.ResultingFrameRate.Value
        report['exposure_time_us'] = camera.ExposureTime.Value
        report['exposure_auto'] = camera.ExposureAuto.Value
        report['camera_parameters_at_start'] = snapshot(camera)
        if ttl_mode and report['exposure_time_us'] >= 1_000_000 / fps:
            raise RuntimeError(f"Exposure {report['exposure_time_us']} us is too long for {fps} TTL pulses/s")
        if not ttl_mode and report['resulting_fps_readback'] < fps * 0.95:
            raise RuntimeError(f"Requested {fps} fps, resulting {report['resulting_fps_readback']:.3f} fps; exposure {report['exposure_time_us']} us. Exposure/ROI/transport settings cannot meet requested frame rate")
        report.update(width=width, height=height, pixel_format=pixel,
                      original_settings=original, state='PREPARING')
        save(folder / 'report.json', report)
        stderr = open(folder / 'encoder.log', 'wb')
        encoder = subprocess.Popen([str(ffmpeg), '-v', 'error', '-n', '-f', 'rawvideo',
            '-pixel_format', fmt, '-video_size', f'{width}x{height}', '-framerate', str(fps),
            '-i', 'pipe:0', '-an', '-c:v', 'ffvhuff', '-pred', 'left', '-threads', '2',
            str(folder / 'camera.mkv')],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=stderr,
            creationflags=subprocess.CREATE_NO_WINDOW)

        def write_frames():
            try:
                with open(folder / 'frames.csv', 'w', newline='') as out:
                    csv_writer = csv.writer(out)
                    csv_writer.writerow(['index', 'block_id', 'camera_ticks', 'pc_monotonic_ns', 'sha256'])
                    while not stop_writer.is_set() or not items.empty():
                        try:
                            index, block, stamp, pc, payload = items.get(timeout=0.1)
                        except queue.Empty:
                            continue
                        # Feed the encoder first so it can work while the C
                        # hashing routine verifies the source frame.
                        encoder.stdin.write(payload)
                        digest = hashlib.sha256(payload).hexdigest()
                        csv_writer.writerow([index, block, stamp, pc, digest])
                        hashes.append(digest)
                        report['written_frames'] += 1
                encoder.stdin.close()
            except Exception as exc:
                writer_errors.append(str(exc))

        worker = threading.Thread(target=write_frames, daemon=True)
        worker.start()
        camera.MaxNumBuffer = 8
        camera.StartGrabbingMax(target, pylon.GrabStrategy_OneByOne)
        report['state'] = 'ARMED_WAITING_FOR_TTL' if ttl_mode else 'RECORDING'
        report['armed_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save(output / 'armed.json', {'serial': serial, 'capture_mode': capture_mode,
             'trigger_source': trigger_source if ttl_mode else None, 'armed_utc': report['armed_utc']})
        save(folder / 'report.json', report)
        arm_deadline = time.monotonic() + trigger_wait_seconds
        deadline = None if ttl_mode else time.monotonic() + seconds + 10
        next_preview = 0
        while camera.IsGrabbing():
            if writer_errors:
                raise RuntimeError('Writer failed: ' + writer_errors[0])
            now = time.monotonic()
            if ttl_mode and not report['received_frames'] and now > arm_deadline:
                raise RuntimeError(f'No TTL-triggered frame received on {trigger_source} within {trigger_wait_seconds} seconds')
            if deadline is not None and now > deadline:
                raise RuntimeError('Capture deadline exceeded or TTL pulse train stopped early')
            if (output / 'STOP').exists():
                raise RuntimeError((output / 'STOP').read_text(encoding='utf-8').strip() or 'Stop requested')
            grab = camera.RetrieveResult(500 if ttl_mode else 2000, pylon.TimeoutHandling_Return)
            try:
                if grab is None:
                    continue
                if not grab.GrabSucceeded():
                    raise RuntimeError(grab.ErrorDescription)
                pc = time.monotonic_ns()
                block, stamp = int(grab.BlockID), int(grab.TimeStamp)
                payload = grab.Array.tobytes()
                if len(payload) != frame_bytes:
                    raise RuntimeError('Unexpected image payload size')
                index = report['received_frames']
                report['received_frames'] += 1
                if ttl_mode and index == 0:
                    report['state'] = 'RECORDING'
                    report['first_ttl_frame_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    deadline = time.monotonic() + seconds + 10
                    save(output / 'trigger-received.json', {'serial': serial, 'frame_index': 0,
                         'pc_monotonic_ns': str(pc), 'camera_ticks': str(stamp),
                         'received_utc': report['first_ttl_frame_utc']})
                times.append(pc)
                block_ids.append(block)
                ticks.append(stamp)
                try:
                    items.put_nowait((index, block, stamp, pc, payload))
                    report['queue_high_water'] = max(report['queue_high_water'], items.qsize())
                except queue.Full:
                    raise RuntimeError('Writer queue overflow')
                # Recording has priority over display. If the encoder has
                # accumulated even a small backlog, skip preview work until
                # the queue recovers instead of allowing a study to fail.
                preview_queue_limit = max(1, queue_capacity // 16)
                if time.monotonic() >= next_preview and items.qsize() <= preview_queue_limit:
                    next_preview = time.monotonic() + 1 / preview_target_fps
                    try:
                        preview_items.put_nowait((payload, index, pc))
                    except queue.Full:
                        report['preview_skipped_updates'] = report.get('preview_skipped_updates', 0) + 1
                elif time.monotonic() >= next_preview:
                    next_preview = time.monotonic() + 1 / preview_target_fps
                    report['preview_throttled_updates'] = report.get('preview_throttled_updates', 0) + 1
            finally:
                if grab is not None:
                    grab.Release()
        if report['received_frames'] != target:
            raise RuntimeError('Unexpected capture frame count')
    except Exception as exc:
        report['faults'].append(str(exc))
    finally:
        preview_stop.set()
        preview_worker.join(timeout=2)
        if camera.IsGrabbing():
            camera.StopGrabbing()
        if camera.IsOpen():
            try:
                if original:
                    restored = True
                    if 'rate' in original:
                        camera.GetNodeMap().GetNode('AcquisitionFrameRate').SetValue(original['rate'])
                        camera.AcquisitionFrameRateEnable.Value = original['enabled']
                        restored = restored and (
                            camera.AcquisitionFrameRateEnable.Value == original['enabled'] and
                            abs(camera.GetNodeMap().GetNode('AcquisitionFrameRate').GetValue() - original['rate']) < 0.01)
                    for name, values in original.get('trigger_settings', {}).items():
                        camera.TriggerSelector.Value = name
                        camera.TriggerMode.Value = 'Off'
                        for field in ['TriggerSource', 'TriggerActivation']:
                            if field in values:
                                try:
                                    getattr(camera, field).Value = values[field]
                                    restored = restored and getattr(camera, field).Value == values[field]
                                except Exception:
                                    restored = False
                        camera.TriggerMode.Value = values['mode']
                        restored = restored and camera.TriggerMode.Value == values['mode']
                    if 'exposure_mode' in original:
                        camera.ExposureMode.Value = original['exposure_mode']
                        restored = restored and camera.ExposureMode.Value == original['exposure_mode']
                    if 'line_selector' in original:
                        camera.LineSelector.Value = original['line_selector']
                        if 'line_mode' in original:
                            try:
                                camera.LineMode.Value = original['line_mode']
                                restored = restored and camera.LineMode.Value == original['line_mode']
                            except Exception:
                                restored = False
                    if 'trigger_selector' in original:
                        camera.TriggerSelector.Value = original['trigger_selector']
                    report['settings_restored'] = restored
                    if not report['settings_restored']:
                        raise RuntimeError('Settings restoration readback mismatch')
            except Exception as exc:
                report['faults'].append('Restore settings: ' + str(exc))
            camera.Close()
        stop_writer.set()
        if worker:
            worker.join(timeout=30)
            if worker.is_alive():
                encoder.kill()
                worker.join(timeout=5)
                report['faults'].append('Writer drain timeout')
        if encoder:
            try:
                if encoder.wait(timeout=10) != 0:
                    report['faults'].append('Encoder failed; see encoder.log')
            except subprocess.TimeoutExpired:
                encoder.kill()
                encoder.wait()
                report['faults'].append('Encoder exit timeout')
        if stderr:
            stderr.close()
        report['faults'].extend(writer_errors)
    if len(times) > 1:
        report['first_pc_monotonic_ns'] = str(times[0])
        report['last_pc_monotonic_ns'] = str(times[-1])
        report['pc_receive_fps'] = (len(times) - 1) * 1e9 / (times[-1] - times[0])
        report['block_ids_contiguous'] = all(b == a + 1 for a, b in zip(block_ids, block_ids[1:]))
        report['camera_ticks_monotonic'] = all(b > a for a, b in zip(ticks, ticks[1:]))
        if not report['block_ids_contiguous'] or not report['camera_ticks_monotonic']:
            report['faults'].append('Frame identity or camera timestamp discontinuity')
    if len(preview_times) > 1:
        report['preview_observed_fps'] = (len(preview_times) - 1) * 1e9 / (preview_times[-1] - preview_times[0])
    if hashes:
        try:
            result = subprocess.run([str(ffmpeg), '-v', 'error', '-xerror', '-i', str(folder / 'camera.mkv'),
                '-map', '0:v:0', '-fps_mode', 'passthrough', '-pix_fmt', fmt,
                '-f', 'framehash', '-hash', 'sha256', 'pipe:1'], capture_output=True, text=True,
                timeout=max(60, seconds * 4), creationflags=subprocess.CREATE_NO_WINDOW, check=True)
            decoded = [line.split(',')[-1].strip() for line in result.stdout.splitlines() if line and not line.startswith('#')]
            report['decoded_frames'] = len(decoded)
            report['pixel_hashes_match'] = decoded == hashes
            if decoded != hashes:
                raise RuntimeError('Decoded frame hashes mismatch')
        except Exception as exc:
            report['faults'].append('Decode verification: ' + str(exc))
    report['unwritten_frames'] = report['received_frames'] - report['written_frames']
    report['video_verified'] = (not report['faults'] and report['received_frames'] == report['written_frames'] == report['decoded_frames'] == target and report.get('pixel_hashes_match', False))
    report['target_receive_rate_met'] = report.get('pc_receive_fps', 0) >= fps * 0.95
    report['ttl_edges_inferred_from_frames'] = report['received_frames'] if ttl_mode else 0
    report['camera_ttl_trigger_verified'] = bool(ttl_mode and report['received_frames'] == target)
    if report['video_verified'] and not report['target_receive_rate_met']:
        report['faults'].append('Complete video but measured PC receive rate below 95% of target')
    report['state'] = 'COMPLETE' if report['video_verified'] and not report['faults'] else 'FAULT'
    save(folder / 'report.json', report)
    print(json.dumps(report), flush=True)
    return 0 if report['state'] == 'COMPLETE' else 2


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', required=True)
    parser.add_argument('--fps', type=int, default=10)
    parser.add_argument('--seconds', type=int, default=10)
    parser.add_argument('--camera-count', type=int, default=1)
    parser.add_argument('--capture-mode', choices=['free_run_no_ttl', 'external_ttl_frame_start'], default='free_run_no_ttl')
    parser.add_argument('--trigger-source', default='Line1')
    parser.add_argument('--trigger-wait-seconds', type=int, default=120)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'outputs/real-camera-checks')
    args = parser.parse_args()
    sys.exit(run(args.serial, args.output, args.fps, args.seconds, args.camera_count,
                 args.capture_mode, args.trigger_source, args.trigger_wait_seconds))
