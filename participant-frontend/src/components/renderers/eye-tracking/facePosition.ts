import { frameDistance, type FrameSize } from '../../../lib/eyeTracking/frameGeometry';

export type FacePosition = 'noFace' | 'center' | 'moveCloser' | 'moveBack' | 'lookStraight' | 'ok';

interface Landmark { x: number; y: number }
interface HeadPose { pitch: number; yaw: number }

const NOSE_TIP = 1;
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;
const MAX_CENTER_OFFSET = 0.15;
const MIN_EYE_SPAN = 0.06;
const MAX_EYE_SPAN = 0.25;
const MAX_HEAD_ANGLE_DEG = 20;

export function evaluateFacePosition(landmarks: readonly Landmark[] | null, pose: HeadPose, frame: FrameSize): FacePosition {
    if (!landmarks || landmarks.length <= RIGHT_IRIS || frame.width <= 0 || frame.height <= 0) return 'noFace';
    const nose = landmarks[NOSE_TIP];
    if (Math.hypot(nose.x - 0.5, nose.y - 0.5) > MAX_CENTER_OFFSET) return 'center';
    const eyeSpan = frameDistance(landmarks[LEFT_IRIS], landmarks[RIGHT_IRIS], frame);
    if (eyeSpan < MIN_EYE_SPAN) return 'moveCloser';
    if (eyeSpan > MAX_EYE_SPAN) return 'moveBack';
    if (Math.abs(pose.yaw) > MAX_HEAD_ANGLE_DEG || Math.abs(pose.pitch) > MAX_HEAD_ANGLE_DEG) return 'lookStraight';
    return 'ok';
}
