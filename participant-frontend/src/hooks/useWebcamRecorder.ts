import { useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { publicService } from '../services/public.service';
import { useParticipantStore } from '../stores/useParticipantStore';
import { usePreviewMode } from './usePreviewMode';

const WEBCAM_VIDEO_BITS_PER_SECOND = 300_000;
const WEBCAM_CHUNK_MS = 1000;
const WEBCAM_MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

const findWebcamMimeType = (): string | undefined =>
    typeof MediaRecorder === 'undefined' ? undefined : WEBCAM_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type));

export interface WebcamRecordingReference {
    readonly mediaPath: string;
    readonly offsetMs: number;
}

export const useWebcamRecorder = () => {
    const { researchId } = useParams<{ researchId: string }>();
    const { isPreviewMode } = usePreviewMode();
    const participantId = useParticipantStore((state) => state.participantId);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startedAtRef = useRef(0);

    const start = useCallback((stream: MediaStream): boolean => {
        const mimeType = findWebcamMimeType();
        if (!mimeType || recorderRef.current) return false;
        const recorder = new MediaRecorder(new MediaStream(stream.getVideoTracks()), {
            mimeType,
            videoBitsPerSecond: WEBCAM_VIDEO_BITS_PER_SECOND,
        });
        chunksRef.current = [];
        recorder.ondataavailable = event => {
            if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.start(WEBCAM_CHUNK_MS);
        recorderRef.current = recorder;
        startedAtRef.current = Date.now();
        return true;
    }, []);

    const stop = useCallback((): Promise<Blob | null> => {
        const recorder = recorderRef.current;
        recorderRef.current = null;
        if (!recorder || recorder.state === 'inactive') return Promise.resolve(null);
        return new Promise(resolve => {
            recorder.onstop = () => {
                const recording = new Blob(chunksRef.current, { type: recorder.mimeType.split(';')[0] });
                chunksRef.current = [];
                resolve(recording.size > 0 ? recording : null);
            };
            recorder.stop();
        });
    }, []);

    const stopAndUpload = useCallback(async (moduleId: string, viewingStartedAt: number): Promise<WebcamRecordingReference | null> => {
        const offsetMs = startedAtRef.current - viewingStartedAt;
        const recording = await stop();
        if (!recording || isPreviewMode) return null;
        if (!researchId || !participantId) {
            throw new Error(`Cannot upload webcam recording for module ${moduleId}: research ${researchId ?? 'missing'}, participant ${participantId ?? 'missing'}`);
        }
        const { mediaPath } = await publicService.uploadWebcamRecording(researchId, moduleId, participantId, recording);
        return { mediaPath, offsetMs };
    }, [isPreviewMode, participantId, researchId, stop]);

    return { start, stopAndUpload };
};
