import type { FrameSize } from '../../../lib/eyeTracking/frameGeometry';
import type { getDeviceType } from './types';

export type FacePosition = 'noFace' | 'center' | 'moveCloser' | 'moveBack' | 'lookStraight' | 'ok';

export interface DistanceRangeCm { readonly min: number; readonly max: number; readonly target: number }

interface Landmark { x: number; y: number }
interface HeadPose { pitch: number; yaw: number }

interface FacePositionInput {
    readonly landmarks: readonly Landmark[] | null;
    readonly pose: HeadPose;
    readonly frame: FrameSize;
    readonly distanceRange: DistanceRangeCm;
}

export interface FacePositionResult {
    readonly position: FacePosition;
    readonly distanceCm: number | null;
}

export const FACE_DISTANCE_RANGES_CM: Record<ReturnType<typeof getDeviceType>, DistanceRangeCm> = {
    desktop: { min: 35, max: 70, target: 50 },
    tablet: { min: 25, max: 55, target: 40 },
    mobile: { min: 25, max: 35, target: 30 },
};

const NOSE_TIP = 1;
const RIGHT_IRIS = 473;
const IRIS_EDGES = [[469, 471], [474, 476]] as const;
const IRIS_DIAMETER_CM = 1.17;
const CAMERA_FOV_LONG_SIDE_DEG = 60;
const MAX_CENTER_OFFSET = 0.15;
const MAX_HEAD_ANGLE_DEG = 20;

export function estimateFaceDistanceCm(landmarks: readonly Landmark[] | null, frame: FrameSize): number | null {
    if (!landmarks || landmarks.length <= IRIS_EDGES[1][1] || frame.width <= 0 || frame.height <= 0) return null;
    const irisDiametersPx = IRIS_EDGES.map(([inner, outer]) => Math.hypot(
        (landmarks[inner].x - landmarks[outer].x) * frame.width,
        (landmarks[inner].y - landmarks[outer].y) * frame.height,
    ));
    const irisDiameterPx = (irisDiametersPx[0] + irisDiametersPx[1]) / 2;
    if (irisDiameterPx <= 0) return null;
    const focalLengthPx = Math.max(frame.width, frame.height) / 2 / Math.tan((CAMERA_FOV_LONG_SIDE_DEG / 2) * Math.PI / 180);
    return focalLengthPx * IRIS_DIAMETER_CM / irisDiameterPx;
}

export function evaluateFacePosition({ landmarks, pose, frame, distanceRange }: FacePositionInput): FacePositionResult {
    const distanceCm = estimateFaceDistanceCm(landmarks, frame);
    if (!landmarks || landmarks.length <= RIGHT_IRIS || distanceCm === null) return { position: 'noFace', distanceCm: null };
    const nose = landmarks[NOSE_TIP];
    if (Math.hypot(nose.x - 0.5, nose.y - 0.5) > MAX_CENTER_OFFSET) return { position: 'center', distanceCm };
    if (distanceCm > distanceRange.max) return { position: 'moveCloser', distanceCm };
    if (distanceCm < distanceRange.min) return { position: 'moveBack', distanceCm };
    if (Math.abs(pose.yaw) > MAX_HEAD_ANGLE_DEG || Math.abs(pose.pitch) > MAX_HEAD_ANGLE_DEG) return { position: 'lookStraight', distanceCm };
    return { position: 'ok', distanceCm };
}
