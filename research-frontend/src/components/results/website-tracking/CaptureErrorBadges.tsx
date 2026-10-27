import { AlertTriangle } from 'lucide-react';
import type { CaptureErrorKind } from '../../../services/tracking.service';

const CAPTURE_ERROR_LABELS: Record<CaptureErrorKind, { label: string; description: string }> = {
    'camera-denied': { label: 'Camera denied', description: 'The visitor refused camera access — no emotions or gaze for this page.' },
    'camera-unavailable': { label: 'No camera', description: 'The camera could not be opened (missing, busy or unsupported browser).' },
    'mediapipe-failed': { label: 'MediaPipe failed', description: 'The face model did not load — no gaze; emotions fell back to face-api.' },
    'face-models-failed': { label: 'Face models failed', description: 'The face-api fallback did not load — no emotions for this page.' },
    'rrweb-truncated': { label: 'Replay truncated', description: 'The recording reached its size limit — the replay stops before the end of this page.' },
    'camera-skipped': { label: 'Camera skipped', description: 'The visitor skipped the camera step — no emotions or gaze for this page.' },
    'calibration-abandoned': { label: 'Calibration abandoned', description: 'The visitor left with the camera open before finishing calibration — no emotions or gaze for this page.' },
};

export const CaptureErrorBadges = ({ errors }: { errors: CaptureErrorKind[] }) => (
    <span className="flex items-center gap-1">
        {errors.map((kind) => (
            <span
                key={kind}
                title={CAPTURE_ERROR_LABELS[kind].description}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-medium whitespace-nowrap"
            >
                <AlertTriangle className="h-3 w-3" />
                {CAPTURE_ERROR_LABELS[kind].label}
            </span>
        ))}
    </span>
);
