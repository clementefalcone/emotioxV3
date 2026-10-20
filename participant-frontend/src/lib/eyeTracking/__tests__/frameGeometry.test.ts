import { describe, it, expect } from 'vitest';
import { eyeAspectRatio } from '../frameGeometry';

const eye = { top: 0, bottom: 1, inner: 2, outer: 3 };

const eyeInFrame = (widthPx: number, heightPx: number, frame: { width: number; height: number }) => {
    const cx = frame.width / 2;
    const cy = frame.height / 2;
    const toNormalized = (x: number, y: number) => ({ x: x / frame.width, y: y / frame.height });
    return [
        toNormalized(cx, cy - heightPx / 2),
        toNormalized(cx, cy + heightPx / 2),
        toNormalized(cx - widthPx / 2, cy),
        toNormalized(cx + widthPx / 2, cy),
    ];
};

describe('eyeAspectRatio', () => {
    it.each([
        ['landscape webcam', { width: 1280, height: 720 }],
        ['portrait phone camera', { width: 720, height: 1280 }],
        ['square frame', { width: 640, height: 640 }],
    ])('measures a 40x10 px eye as 0.25 on a %s', (_, frame) => {
        expect(eyeAspectRatio(eyeInFrame(40, 10, frame), eye, frame)).toBeCloseTo(0.25, 6);
    });

    it('returns 0 when an eye landmark is missing', () => {
        expect(eyeAspectRatio([], eye, { width: 1280, height: 720 })).toBe(0);
    });
});
