export interface MonthlyCreations {
    month: string;
    draft: number;
    active: number;
    completed: number;
}

type CountedStatus = 'draft' | 'active' | 'completed';

const COUNTED_STATUSES: Record<string, CountedStatus> = { draft: 'draft', active: 'active', completed: 'completed' };

const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthLabel = (index: number) => `${MONTH_NAMES[index % 12]} ${String(Math.floor(index / 12) % 100).padStart(2, '0')}`;

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
