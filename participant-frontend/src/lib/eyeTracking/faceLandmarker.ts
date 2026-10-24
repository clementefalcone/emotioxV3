import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FACE_LANDMARKER_MODEL_URL, getVisionTasksWasmBaseUrl } from './constants';

/**
 * Loads WASM and creates a single-face Video-mode Face Landmarker.
 * Caller must call `close()` when done.
 */
export async function createFaceLandmarker(outputFaceBlendshapes = false): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(getVisionTasksWasmBaseUrl());
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes,
    outputFacialTransformationMatrixes: true,
  });
}
