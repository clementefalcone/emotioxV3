import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import pool from '../../config/database';
import { ensureDirectoryExists, getMediaPath } from '../../config/local-storage';

const VIDEO_EXTENSIONS: Record<string, string> = {
    'video/webm': 'webm',
    'video/mp4': 'mp4',
};
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9_.@-]{1,255}$/;
const WEBCAM_RECORDING_COMPONENT_ID = 'webcam-recording';

export class WebcamRecordingRejectedError extends Error {
    constructor(message: string, readonly statusCode: number) {
        super(message);
    }
}

interface WebcamRecordingUpload {
    researchId: string;
    moduleId: string;
    participantId: string;
    contentType: string;
    data: Buffer;
}

interface ModuleComponent {
    id?: string;
    value?: unknown;
}

const isWebcamRecordingEnabled = (rawConfig: unknown): boolean => {
    const config = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
    const components: ModuleComponent[] = config?.structure?.components ?? [];
    return components.some(component => component.id === WEBCAM_RECORDING_COMPONENT_ID && component.value === 'true');
};

export const saveWebcamRecording = async (upload: WebcamRecordingUpload): Promise<{ mediaPath: string }> => {
    const { researchId, moduleId, participantId, contentType, data } = upload;
    if (!PARTICIPANT_ID_PATTERN.test(participantId)) {
        throw new WebcamRecordingRejectedError(`participantId must match ${PARTICIPANT_ID_PATTERN}, got "${participantId}"`, 400);
    }
    const extension = VIDEO_EXTENSIONS[contentType.split(';')[0].trim()];
    if (!extension) {
        throw new WebcamRecordingRejectedError(`Content-Type must be video/webm or video/mp4, got "${contentType}"`, 400);
    }
    if (data.length === 0) {
        throw new WebcamRecordingRejectedError('Webcam recording body is empty', 400);
    }

    const moduleResult = await pool.query(
        `SELECT m.config FROM modules m
         JOIN researches r ON r.id = m.research_id
         WHERE m.id = ? AND m.research_id = ? AND r.status = 'active' AND r.deleted_at IS NULL`,
        [moduleId, researchId],
    );
    if (moduleResult.rows.length === 0) {
        throw new WebcamRecordingRejectedError(`Module ${moduleId} not found in active research ${researchId}`, 404);
    }
    if (!isWebcamRecordingEnabled(moduleResult.rows[0].config)) {
        throw new WebcamRecordingRejectedError(`Webcam recording is not enabled for module ${moduleId}`, 422);
    }

    const consentResult = await pool.query(
        `SELECT 1 FROM consent_records
         WHERE research_id = ? AND subject_id = ? AND context = 'eye_tracking' AND decision = 'accepted'
         LIMIT 1`,
        [researchId, participantId],
    );
    if (consentResult.rows.length === 0) {
        throw new WebcamRecordingRejectedError(`Participant ${participantId} has no accepted eye tracking consent in research ${researchId}`, 403);
    }

    const mediaPath = `research/${researchId}/webcam/${randomUUID()}.${extension}`;
    const filePath = getMediaPath(mediaPath);
    ensureDirectoryExists(filePath);
    await fs.writeFile(filePath, data);
    console.info(JSON.stringify({ event: 'webcam_recording_saved', researchId, moduleId, bytes: data.length }));
    return { mediaPath };
};
