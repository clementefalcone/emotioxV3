export const CAPTURE_ERROR_KINDS = ['camera-denied', 'camera-unavailable', 'mediapipe-failed', 'face-models-failed'] as const;
export type CaptureErrorKind = typeof CAPTURE_ERROR_KINDS[number];

export const isCaptureErrorKind = (value: unknown): value is CaptureErrorKind =>
    CAPTURE_ERROR_KINDS.includes(value as CaptureErrorKind);

export const parseCaptureErrors = (raw: unknown): CaptureErrorKind[] =>
    typeof raw === 'string' ? raw.split(',').filter(isCaptureErrorKind) : [];
