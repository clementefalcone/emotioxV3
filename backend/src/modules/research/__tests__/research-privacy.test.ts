import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));

import { readPrivacyNotice } from '../research-privacy';

describe('readPrivacyNotice', () => {
    it('reads the controller, contact email and policy link of the study', () => {
        expect(readPrivacyNotice(JSON.stringify({ privacy: { controllerName: ' Acme SpA ', contactEmail: 'privacidad@acme.cl', policyUrl: 'https://acme.cl/privacidad' } })))
            .toEqual({ controllerName: 'Acme SpA', contactEmail: 'privacidad@acme.cl', policyUrl: 'https://acme.cl/privacidad' });
    });

    it('drops a policy link that is not http(s) and an invalid email, so they never reach a page', () => {
        expect(readPrivacyNotice({ privacy: { controllerName: 'Acme', contactEmail: 'no-email', policyUrl: 'javascript:alert(1)' } }))
            .toEqual({ controllerName: 'Acme', contactEmail: '', policyUrl: '' });
    });

    it('returns empty fields for a study without privacy settings', () => {
        expect(readPrivacyNotice(null)).toEqual({ controllerName: '', contactEmail: '', policyUrl: '' });
    });
});
