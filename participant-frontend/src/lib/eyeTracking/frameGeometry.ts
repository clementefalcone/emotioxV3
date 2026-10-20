export interface FrameSize { width: number; height: number }

interface Point { x: number; y: number }

export interface EyeLandmarkIndices {
    readonly top: number;
    readonly bottom: number;
    readonly inner: number;
    readonly outer: number;
}

function frameDistance(a: Point, b: Point, frame: FrameSize): number {
    const longSide = Math.max(frame.width, frame.height);
    return Math.hypot((a.x - b.x) * frame.width / longSide, (a.y - b.y) * frame.height / longSide);
}

export function eyeAspectRatio(landmarks: readonly Point[], eye: EyeLandmarkIndices, frame: FrameSize): number {
    const top = landmarks[eye.top];
    const bottom = landmarks[eye.bottom];
    const inner = landmarks[eye.inner];
    const outer = landmarks[eye.outer];
    if (!top || !bottom || !inner || !outer) return 0;
    const width = frameDistance(inner, outer, frame);
    return width > 1e-6 ? frameDistance(top, bottom, frame) / width : 0;
}
