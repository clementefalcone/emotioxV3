import { describe, it, expect, vi } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../config/database', () => ({ default: { query: (...args: unknown[]) => mockQuery(...args) } }));

import { deleteAllByResearch, deleteParticipant } from '../participants.service';

describe('participant deletes read the affected row count', () => {
    it('reports a deleted participant as deleted and a missing one as not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        await expect(deleteParticipant('r-1', 'p-1')).resolves.toBe(true);
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        await expect(deleteParticipant('r-1', 'ghost')).resolves.toBe(false);
    });

    it('reports how many participants were deleted', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 7 });
        await expect(deleteAllByResearch('r-1')).resolves.toBe(7);
    });
});
