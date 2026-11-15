import { create } from 'zustand';

export type DemographicFiltersState = Record<string, string[]>;
export type SentimentFilter = string[];

export interface ResultsFilterValues {
    demographicFilters: DemographicFiltersState;
    userIdFilter: string;
    completionMin: number;
    sentimentFilter: SentimentFilter;
}

interface ResultsFilterState {
    filtersByResearch: Record<string, ResultsFilterValues>;
    updateFilters: (researchId: string, changes: Partial<ResultsFilterValues>) => void;
}

const completionMinKey = (researchId: string): string => `completionMin-${researchId}`;

const readSavedCompletionMin = (researchId: string): number => {
    try {
        return Number(localStorage.getItem(completionMinKey(researchId)) ?? 0);
    } catch {
        return 0;
    }
};

const saveCompletionMin = (researchId: string, completionMin: number): void => {
    try {
        if (completionMin > 0) localStorage.setItem(completionMinKey(researchId), String(completionMin));
        else localStorage.removeItem(completionMinKey(researchId));
    } catch {
        return;
    }
};

export const initialResultsFilters = (researchId: string): ResultsFilterValues => ({
    demographicFilters: {},
    userIdFilter: '',
    completionMin: readSavedCompletionMin(researchId),
    sentimentFilter: [],
});

export const useResultsFilterStore = create<ResultsFilterState>((set) => ({
    filtersByResearch: {},
    updateFilters: (researchId, changes) => {
        if (changes.completionMin !== undefined) saveCompletionMin(researchId, changes.completionMin);
        set(state => ({
            filtersByResearch: {
                ...state.filtersByResearch,
                [researchId]: { ...(state.filtersByResearch[researchId] ?? initialResultsFilters(researchId)), ...changes },
            },
        }));
    },
}));
