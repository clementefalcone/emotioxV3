import pool from '../../config/database';
import { parseJsonRecord } from '../public/public.types';

export interface PrivacyNotice {
    controllerName: string;
    contactEmail: string;
    policyUrl: string;
}

const readText = (record: Record<string, unknown>, key: string): string => {
    const value = record[key];
    return typeof value === 'string' ? value.trim() : '';
};

export const readPrivacyNotice = (config: unknown): PrivacyNotice => {
    const privacy = parseJsonRecord(parseJsonRecord(config).privacy);
    const policyUrl = readText(privacy, 'policyUrl');
    const contactEmail = readText(privacy, 'contactEmail');
    return {
        controllerName: readText(privacy, 'controllerName'),
        contactEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) ? contactEmail : '',
        policyUrl: /^https?:\/\/\S+$/i.test(policyUrl) ? policyUrl : '',
    };
};

export const getPrivacyNotice = async (researchId: string): Promise<PrivacyNotice> => {
    const result = await pool.query('SELECT config FROM researches WHERE id = ? AND deleted_at IS NULL', [researchId]);
    return readPrivacyNotice(result.rows[0]?.config);
};
