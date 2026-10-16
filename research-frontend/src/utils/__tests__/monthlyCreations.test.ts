import { describe, it, expect } from 'vitest';
import { buildMonthlyCreations } from '../monthlyCreations';

describe('buildMonthlyCreations', () => {
    const now = new Date(2026, 9, 16);

    it('fills every month from the first project to today, empty ones included', () => {
        const months = buildMonthlyCreations([
            { created_at: '2026-05-10T12:00:00Z', status: 'active' },
            { created_at: '2026-08-03T12:00:00Z', status: 'completed' },
        ], now);
        expect(months.map(month => month.month)).toEqual(['May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26']);
        expect(months[0].active).toBe(1);
        expect(months[1]).toEqual({ month: 'Jun 26', draft: 0, active: 0, completed: 0 });
        expect(months[3].completed).toBe(1);
    });

    it('counts unknown statuses as draft', () => {
        expect(buildMonthlyCreations([{ created_at: '2026-10-01T12:00:00Z', status: 'archived' }], now)).toEqual([
            { month: 'Oct 26', draft: 1, active: 0, completed: 0 },
        ]);
    });

    it('returns no months without projects', () => {
        expect(buildMonthlyCreations([], now)).toEqual([]);
    });
});
