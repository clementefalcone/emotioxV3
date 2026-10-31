import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

const getConsentRecords = vi.hoisted(() => vi.fn());
vi.mock('../../../services/researchInProgress.service', () => ({ researchInProgressService: { getConsentRecords } }));

import { ConsentRecordsSection } from '../ConsentRecordsSection';
import { buildCsv } from '../../../utils/csvDownload';

const record = (id: string, decision: 'accepted' | 'declined' | 'withdrawn') => ({
    id, subject_id: `p-${id}`, context: 'eye_tracking' as const, decision,
    consent_text: 'Acepto, "con" comas', consent_text_sha256: 'abc', locale: 'es', created_at: '2026-10-31T12:00:00Z',
});

const renderSection = () => render(
    <QueryClientProvider client={new QueryClient()}>
        <ConsentRecordsSection researchId="r-1" />
    </QueryClientProvider>,
);

describe('ConsentRecordsSection', () => {
    it('counts each decision and lists the records', async () => {
        getConsentRecords.mockResolvedValue([record('1', 'accepted'), record('2', 'accepted'), record('3', 'withdrawn')]);
        renderSection();
        expect(await screen.findByText('Aceptó: 2')).toBeTruthy();
        expect(screen.getByText('Rechazó: 0')).toBeTruthy();
        expect(screen.getByText('Retiró: 1')).toBeTruthy();
        expect(screen.getByText('p-3')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Descargar CSV' })).toBeTruthy();
    });

    it('says when there are no records yet', async () => {
        getConsentRecords.mockResolvedValue([]);
        renderSection();
        expect(await screen.findByText('Aún no hay consentimientos registrados.')).toBeTruthy();
    });
});

describe('buildCsv', () => {
    it('quotes cells with commas or quotes', () => {
        expect(buildCsv([record('1', 'accepted')], ['subject_id', 'consent_text'])).toBe('subject_id,consent_text\np-1,"Acepto, ""con"" comas"');
    });
});
