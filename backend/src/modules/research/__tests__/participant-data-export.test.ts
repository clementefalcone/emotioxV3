import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../config/database', () => ({ default: { query: (...args: unknown[]) => mockQuery(...args) } }));
vi.mock('../research.helpers', () => ({ buildOwnershipClause: vi.fn(() => ({ clause: 'user_id = ?', params: ['user-1'] })) }));

import { exportParticipantData } from '../participant-data-export';

const answer = (rowsByTable: Record<string, unknown[]>, hasResearch = true) => {
    mockQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM researches')) return { rows: hasResearch ? [{ id: 'r-1' }] : [] };
        const table = Object.keys(rowsByTable).find(name => sql.includes(`FROM ${name} `));
        return { rows: table ? rowsByTable[table] : [] };
    });
};

describe('exportParticipantData', () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    it('returns every table holding the participant data, including consent records', async () => {
        answer({
            responses: [{ id: 'resp-1', participant_id: 'p-1' }],
            participant_demographics: [{ id: 'd-1', participant_id: 'p-1' }],
            consent_records: [{ id: 'c-1', subject_id: 'p-1', decision: 'accepted' }],
        });

        const result = await exportParticipantData('r-1', 'p-1', 'user-1');

        expect(result).toMatchObject({
            researchId: 'r-1',
            participantId: 'p-1',
            tables: {
                responses: [{ id: 'resp-1', participant_id: 'p-1' }],
                participant_demographics: [{ id: 'd-1', participant_id: 'p-1' }],
                participants: [],
                consent_records: [{ id: 'c-1', subject_id: 'p-1', decision: 'accepted' }],
            },
        });
        const scoped = mockQuery.mock.calls.filter(([sql]) => !sql.startsWith('SELECT id FROM researches'));
        expect(scoped.every(([, params]) => params[0] === 'r-1' && params[1] === 'p-1')).toBe(true);
    });

    it('rejects a study the user cannot access and a participant with no data', async () => {
        answer({}, false);
        await expect(exportParticipantData('r-1', 'p-1', 'user-2')).rejects.toThrow('Research not found');
        answer({});
        await expect(exportParticipantData('r-1', 'ghost', 'user-1')).rejects.toThrow('Participant not found: ghost in research r-1');
    });
});
