interface FaceFrameCounts {
  noFaceFrames: number;
  noValidGazeFrames: number;
  validGazeFrames: number;
}

export const faceDetectedPercent = (counts: FaceFrameCounts): number | null => {
  const analyzedFrames = counts.noValidGazeFrames + counts.validGazeFrames;
  if (analyzedFrames === 0) return null;
  return Math.round((1 - counts.noFaceFrames / analyzedFrames) * 1000) / 10;
};
