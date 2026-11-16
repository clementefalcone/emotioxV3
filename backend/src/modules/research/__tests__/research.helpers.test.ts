import { describe, it, expect } from 'vitest';
import { buildOwnershipClause } from '../research.helpers';

describe('buildOwnershipClause', () => {
    it('lets an admin see every research', () => {
        expect(buildOwnershipClause('admin-1', 'admin')).toEqual({ clause: '1=1', params: [] });
    });

    it.each(['viewer', 'researcher'])('limits a %s to owned or shared researches', (role) => {
        const { clause, params } = buildOwnershipClause('user-1', role);
        expect(clause).toBe('(r.created_by = ? OR r.id IN (SELECT research_id FROM research_collaborators WHERE user_id = ?))');
        expect(params).toEqual(['user-1', 'user-1']);
    });
});
