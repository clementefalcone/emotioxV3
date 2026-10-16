export interface MonthlyCreations {
    month: string;
    draft: number;
    active: number;
    completed: number;
}

type CountedStatus = 'draft' | 'active' | 'completed';

const COUNTED_STATUSES: Record<string, CountedStatus> = { draft: 'draft', active: 'active', completed: 'completed' };

const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();

const monthLabel = (index: number) =>
    new Date(Math.floor(index / 12), index % 12, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

export const buildMonthlyCreations = (researches: Array<{ created_at: string; status: string }>, now: Date): MonthlyCreations[] => {
    if (researches.length === 0) return [];
    const createdMonths = researches.map(research => monthIndex(new Date(research.created_at)));
    const firstMonth = Math.min(...createdMonths);
    const months = Array.from({ length: monthIndex(now) - firstMonth + 1 }, (_, offset) => ({
        month: monthLabel(firstMonth + offset), draft: 0, active: 0, completed: 0,
    }));
    researches.forEach((research, i) => {
        months[createdMonths[i] - firstMonth][COUNTED_STATUSES[research.status] ?? 'draft']++;
    });
    return months;
};
