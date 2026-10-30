import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));

import pool from '../../../config/database';
import { getScreenerResults } from '../screener.analytics';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const screenerConfig = JSON.stringify({ structure: { components: [
    { id: 'question-title', value: 'Do you drink coffee?' },
    { id: 'yes', value: 'Yes', settings: { isChoice: true, eligibility: 'Qualify' } },
    { id: 'no', value: 'No', settings: { isChoice: true, eligibility: 'Disqualify' } },
] } });

const mockScreenerStudy = () => {
    const now = new Date();
    mockQuery
        .mockResolvedValueOnce({ rows: [{ stage_id: 'stage-1', stage_name: 'Screener' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'module-1', name: 'Screener', config: screenerConfig }] })
        .mockResolvedValueOnce({ rows: [
            { participant_id: 'p-yes-1', value: '"yes"', component_id: 'choice', created_at: now },
            { participant_id: 'p-yes-2', value: '"yes"', component_id: 'choice', created_at: now },
            { participant_id: 'p-no', value: '"no"', component_id: 'choice', created_at: now },
        ] })
        .mockResolvedValueOnce({ rows: [
            { participant_id: 'p-yes-1', status: 'responded' },
            { participant_id: 'p-yes-2', status: 'responded' },
            { participant_id: 'p-no', status: 'disqualified' },
        ] });
};

describe('getScreenerResults', () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    it('counts every participant without a scope', async () => {
        mockScreenerStudy();
        const results = await getScreenerResults('research-1');
        expect(results.totalResponses).toBe(3);
        expect(results.qualified).toBe(2);
        expect(results.disqualified).toBe(1);
    });

    it('counts only the participants in scope', async () => {
        mockScreenerStudy();
        const results = await getScreenerResults('research-1', new Set(['p-yes-1', 'p-no']));
        expect(results.totalResponses).toBe(2);
        expect(results.qualified).toBe(1);
        expect(results.disqualified).toBe(1);
        expect(results.choiceDistribution.find(c => c.choiceId === 'yes')?.count).toBe(1);
    });
});
