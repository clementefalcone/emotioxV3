import { describe, it, expect } from 'vitest';
import { evaluateFacePosition, estimateFaceDistanceCm, FACE_DISTANCE_RANGES_CM } from '../facePosition';

const landscape = { width: 1280, height: 720 };
const portrait = { width: 720, height: 1280 };
const focalLengthPx = (frame: { width: number; height: number }) => Math.max(frame.width, frame.height) / 2 / Math.tan(Math.PI / 6);

const makeFace = (frame: { width: number; height: number }, distanceCm: number, noseX = 0.5, noseY = 0.5) => {
    const irisWidth = focalLengthPx(frame) * 1.17 / distanceCm / frame.width;
    const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    landmarks[1] = { x: noseX, y: noseY };
    for (const [center, inner, outer] of [[0.45, 469, 471], [0.55, 474, 476]]) {
        landmarks[inner] = { x: center - irisWidth / 2, y: 0.45 };
        landmarks[outer] = { x: center + irisWidth / 2, y: 0.45 };
    }
    return landmarks;
};

const straight = { pitch: 0, yaw: 0 };
const desktop = FACE_DISTANCE_RANGES_CM.desktop;
const mobile = FACE_DISTANCE_RANGES_CM.mobile;

describe('estimateFaceDistanceCm', () => {
    it.each([['landscape webcam', landscape], ['portrait phone camera', portrait]])('reads the distance from the iris size on a %s', (_, frame) => {
        expect(estimateFaceDistanceCm(makeFace(frame, 50), frame)).toBeCloseTo(50, 6);
    });

    it('returns null without a frame size or iris landmarks', () => {
        expect(estimateFaceDistanceCm(makeFace(landscape, 50), { width: 0, height: 0 })).toBeNull();
        expect(estimateFaceDistanceCm(makeFace(landscape, 50).slice(0, 468), landscape)).toBeNull();
    });
});

describe('evaluateFacePosition', () => {
    const evaluate = (landmarks: ReturnType<typeof makeFace> | null, pose = straight, frame = landscape, distanceRange = desktop) =>
        evaluateFacePosition({ landmarks, pose, frame, distanceRange }).position;

    it.each([
        ['no landmarks', null, straight, 'noFace'],
        ['nose off center', makeFace(landscape, 50, 0.7), straight, 'center'],
        ['farther than the desktop range', makeFace(landscape, 80), straight, 'moveCloser'],
        ['closer than the desktop range', makeFace(landscape, 30), straight, 'moveBack'],
        ['head turned', makeFace(landscape, 50), { pitch: 0, yaw: 30 }, 'lookStraight'],
        ['head tilted down', makeFace(landscape, 50), { pitch: -25, yaw: 0 }, 'lookStraight'],
        ['centered at 50 cm looking straight', makeFace(landscape, 50, 0.52, 0.48), { pitch: 10, yaw: -10 }, 'ok'],
    ])('%s', (_, landmarks, pose, expected) => {
        expect(evaluate(landmarks, pose)).toBe(expected);
    });

    it('applies the phone range on a portrait phone camera', () => {
        expect(evaluate(makeFace(portrait, 30), straight, portrait, mobile)).toBe('ok');
        expect(evaluate(makeFace(portrait, 50), straight, portrait, mobile)).toBe('moveCloser');
    });

    it('returns the measured distance with the position', () => {
        expect(evaluateFacePosition({ landmarks: makeFace(landscape, 80), pose: straight, frame: landscape, distanceRange: desktop }).distanceCm).toBeCloseTo(80, 6);
    });
});
