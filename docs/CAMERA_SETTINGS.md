# Camera settings

Open `http://127.0.0.1:8765`, select **Discover cameras**, choose a camera by serial number, and select **Read settings**. Apply changes with **Apply to this camera**.

The panel exposes the automatic exposure mode, exposure time, automatic gain mode, gain, ROI dimensions and offsets, and supported recording pixel formats reported by the camera. Limits and increments come directly from the selected device. ROI limits can change after another ROI value changes, so large adjustments may require more than one step.

Settings apply only to the selected camera. Reading or changing settings never starts a recording and does not save a permanent camera UserSet. During a recording or finalization, the service blocks settings access so another process cannot take control of the camera.

For manual exposure or gain, first turn the corresponding automatic mode off and apply that change. Then enter the manual value. If an apply operation fails, the software attempts to restore every affected value and reports the restoration outcome.

The estimated resulting frame rate is guidance only. Every real study checks the camera's rate readback before recording and measures the actual PC receive rate afterward.
