import { calculateCSAT, calculateCV, getCESZones } from '../../components/results/shared/utils/calculations';
import type { EnterpriseSmartVOCResult } from '../../services/analytics.service';

export type SmartVOCMetricKey = 'nps' | 'csat' | 'ces' | 'cv';

export type SmartVOCMetricValues = Record<SmartVOCMetricKey, number | null>;

export interface StudySmartVOCSummary extends SmartVOCMetricValues {
    researchId: string;
    name: string;
    enterpriseName: string | null;
    responses: number;
}

export interface MonthlySmartVOCSummary extends SmartVOCMetricValues {
    month: string;
    responses: number;
}

export interface ClientSmartVOCSummary {
    total: SmartVOCMetricValues & { responses: number; promoters: number; neutrals: number; detractors: number };
    studies: StudySmartVOCSummary[];
    months: MonthlySmartVOCSummary[];
}

interface ScoreSet {
    nps: number[];
    csat: number[];
    cv: number[];
    cesPolarity: number[];
}

const emptyScoreSet = (): ScoreSet => ({ nps: [], csat: [], cv: [], cesPolarity: [] });

const toCesPolarity = (value: number, scaleMax: number): number => {
    const zones = getCESZones(scaleMax);
    if (value >= zones.positive[0] && value <= zones.positive[1]) return 1;
    if (value >= zones.negative[0] && value <= zones.negative[1]) return -1;
    return 0;
};

const countNps = (scores: number[]) => ({
    promoters: scores.filter(s => s >= 9).length,
    neutrals: scores.filter(s => s >= 7 && s <= 8).length,
    detractors: scores.filter(s => s <= 6).length,
});

const roundOrNull = (scores: unknown[], value: () => number): number | null =>
    scores.length === 0 ? null : Math.round(value());

const computeMetrics = (set: ScoreSet): SmartVOCMetricValues => ({
    nps: roundOrNull(set.nps, () => {
        const { promoters, detractors } = countNps(set.nps);
        return ((promoters - detractors) / set.nps.length) * 100;
    }),
    csat: roundOrNull(set.csat, () => calculateCSAT(set.csat)),
    ces: roundOrNull(set.cesPolarity, () => {
        const positive = set.cesPolarity.filter(p => p === 1).length;
        const negative = set.cesPolarity.filter(p => p === -1).length;
        return ((positive - negative) / set.cesPolarity.length) * 100;
    }),
    cv: roundOrNull(set.cv, () => calculateCV(set.cv)),
});

const toMonthKey = (date: string) => date.slice(0, 7);

export const buildClientSmartVOCSummary = (results: EnterpriseSmartVOCResult[]): ClientSmartVOCSummary => {
    const totalSet = emptyScoreSet();
    const monthSets = new Map<string, ScoreSet>();
    const monthSet = (date: string) => {
        const key = toMonthKey(date);
        const existing = monthSets.get(key) ?? emptyScoreSet();
        monthSets.set(key, existing);
        return existing;
    };

    const studies = results.map(result => {
        const studySet = emptyScoreSet();
        const cesMax = result.scaleConfigs?.ces?.max ?? 5;
        const { npsScores, csatScores, cesScores, cvScores } = result.metrics;

        npsScores.forEach(s => { studySet.nps.push(s.value); monthSet(s.date).nps.push(s.value); });
        csatScores.forEach(s => { studySet.csat.push(s.value); monthSet(s.date).csat.push(s.value); });
        cvScores.forEach(s => { studySet.cv.push(s.value); monthSet(s.date).cv.push(s.value); });
        cesScores.forEach(s => {
            const polarity = toCesPolarity(s.value, cesMax);
            studySet.cesPolarity.push(polarity);
            monthSet(s.date).cesPolarity.push(polarity);
        });

        totalSet.nps.push(...studySet.nps);
        totalSet.csat.push(...studySet.csat);
        totalSet.cv.push(...studySet.cv);
        totalSet.cesPolarity.push(...studySet.cesPolarity);

        return {
            researchId: result.researchId,
            name: result.researchName,
            enterpriseName: result.enterpriseName,
            responses: result.uniqueParticipants,
            ...computeMetrics(studySet),
        };
    });

    const months = Array.from(monthSets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, set]) => ({
            month,
            responses: Math.max(set.nps.length, set.csat.length, set.cv.length, set.cesPolarity.length),
            ...computeMetrics(set),
        }));

    return {
        total: {
            responses: studies.reduce((sum, s) => sum + s.responses, 0),
            ...countNps(totalSet.nps),
            ...computeMetrics(totalSet),
        },
        studies,
        months,
    };
};
