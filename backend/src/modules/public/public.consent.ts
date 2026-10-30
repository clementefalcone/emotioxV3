import { createHash } from 'crypto';
import pool from '../../config/database';

const CONSENT_CONTEXTS = new Set(['eye_tracking', 'emotion_analysis', 'website_tracking']);
const CONSENT_DECISIONS = new Set(['accepted', 'declined', 'withdrawn']);
const MAX_SUBJECT_ID_LENGTH = 255;
const MAX_CONSENT_TEXT_LENGTH = 10000;
const MAX_LOCALE_LENGTH = 16;

export class ConsentValidationError extends Error {}

interface ConsentRecordInput {
    subjectId: string;
    context: string;
    decision: string;
    text: string;
    locale: string;
}

const readBoundedString = (body: Record<string, unknown>, field: keyof ConsentRecordInput, maxLength: number): string => {
    const value = body[field];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
        throw new ConsentValidationError(`Field ${field} must be a non-empty string of at most ${maxLength} characters`);
    }
    return value;
};

const parseConsentRecord = (body: Record<string, unknown>): ConsentRecordInput => {
    const input = {
        subjectId: readBoundedString(body, 'subjectId', MAX_SUBJECT_ID_LENGTH),
        context: readBoundedString(body, 'context', MAX_SUBJECT_ID_LENGTH),
        decision: readBoundedString(body, 'decision', MAX_SUBJECT_ID_LENGTH),
        text: readBoundedString(body, 'text', MAX_CONSENT_TEXT_LENGTH),
        locale: readBoundedString(body, 'locale', MAX_LOCALE_LENGTH),
    };
    if (!CONSENT_CONTEXTS.has(input.context)) {
        throw new ConsentValidationError(`Field context must be one of ${[...CONSENT_CONTEXTS].join(', ')}, got ${input.context}`);
    }
    if (!CONSENT_DECISIONS.has(input.decision)) {
        throw new ConsentValidationError(`Field decision must be one of ${[...CONSENT_DECISIONS].join(', ')}, got ${input.decision}`);
    }
    return input;
};

export const recordConsent = async (researchId: string, body: Record<string, unknown>): Promise<boolean> => {
    const input = parseConsentRecord(body);
    const research = await pool.query('SELECT id FROM researches WHERE id = ? AND deleted_at IS NULL', [researchId]);
    if (research.rows.length === 0) return false;
    await pool.query(
        `INSERT INTO consent_records (id, research_id, subject_id, context, decision, consent_text, consent_text_sha256, locale)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
        [researchId, input.subjectId, input.context, input.decision, input.text, createHash('sha256').update(input.text).digest('hex'), input.locale],
    );
    console.info(JSON.stringify({ event: 'consent_recorded', researchId, context: input.context, decision: input.decision }));
    return true;
};
