import { describe, it, expect } from 'vitest';
import { parseCaptureErrors } from '../capture-errors';

describe('parseCaptureErrors', () => {
    it('reads the stored comma list and drops values outside the dictionary', () => {
        expect(parseCaptureErrors('camera-denied,unknown,mediapipe-failed')).toEqual(['camera-denied', 'mediapipe-failed']);
    });

    it('returns no errors for a session without failures', () => {
        expect(parseCaptureErrors(null)).toEqual([]);
    });
});
