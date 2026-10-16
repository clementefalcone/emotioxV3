import { describe, it, expect } from 'vitest';
import { evaluateFacePosition } from '../facePosition';

const makeFace = (noseX: number, noseY: number, eyeSpan: number) => {
    const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    landmarks[1] = { x: noseX, y: noseY };
    landmarks[468] = { x: 0.5 - eyeSpan / 2, y: 0.45 };
    landmarks[473] = { x: 0.5 + eyeSpan / 2, y: 0.45 };
    return landmarks;
};

const straight = { pitch: 0, yaw: 0 };

describe('evaluateFacePosition', () => {
    it.each([
        ['no landmarks', null, straight, 'noFace'],
        ['landmarks without iris points', makeFace(0.5, 0.5, 0.1).slice(0, 468), straight, 'noFace'],
        ['nose off center', makeFace(0.7, 0.5, 0.1), straight, 'center'],
        ['eyes too close together (far away)', makeFace(0.5, 0.5, 0.04), straight, 'moveCloser'],
        ['eyes too far apart (too close)', makeFace(0.5, 0.5, 0.3), straight, 'moveBack'],
        ['head turned', makeFace(0.5, 0.5, 0.1), { pitch: 0, yaw: 30 }, 'lookStraight'],
        ['head tilted down', makeFace(0.5, 0.5, 0.1), { pitch: -25, yaw: 0 }, 'lookStraight'],
        ['centered, at arm length, looking straight', makeFace(0.52, 0.48, 0.1), { pitch: 10, yaw: -10 }, 'ok'],
    ])('%s', (_, landmarks, pose, expected) => {
        expect(evaluateFacePosition(landmarks, pose)).toBe(expected);
    });
});
