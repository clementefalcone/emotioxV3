import pool from '../../config/database';

export interface ConsentRecordRow {
    id: string;
    subject_id: string;
    context: 'eye_tracking' | 'emotion_analysis' | 'website_tracking';
    decision: 'accepted' | 'declined' | 'withdrawn';
    consent_text: string;
    consent_text_sha256: string;
    locale: string;
    created_at: string;
}

export const listConsentRecords = async (researchId: string): Promise<ConsentRecordRow[]> => {
    const result = await pool.query(
        `SELECT id, subject_id, context, decision, consent_text, consent_text_sha256, locale, created_at
         FROM consent_records WHERE research_id = ? ORDER BY created_at DESC`,
        [researchId]
    );
    return result.rows as ConsentRecordRow[];
};
