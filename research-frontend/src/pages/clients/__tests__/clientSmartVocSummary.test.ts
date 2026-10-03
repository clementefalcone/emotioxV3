import { describe, it, expect } from 'vitest';
import { buildClientSmartVOCSummary } from '../clientSmartVocSummary';
import type { EnterpriseSmartVOCResult } from '../../../services/analytics.service';

const scores = (values: number[], date: string) => values.map(value => ({ value, date }));

const makeResult = (
    researchId: string,
    metrics: { nps?: number[]; csat?: number[]; ces?: number[]; cv?: number[] },
    date: string,
    cesMax?: number,
): EnterpriseSmartVOCResult => ({
    researchId,
    researchName: `${researchId} study`,
    enterpriseName: null,
    totalResponses: 0,
    uniqueParticipants: (metrics.nps ?? metrics.csat ?? metrics.ces ?? metrics.cv ?? []).length,
    scaleConfigs: cesMax ? { ces: { min: 1, max: cesMax } } : undefined,
    metrics: {
        npsScores: scores(metrics.nps ?? [], date),
        csatScores: scores(metrics.csat ?? [], date),
        cesScores: scores(metrics.ces ?? [], date),
        cvScores: scores(metrics.cv ?? [], date),
    },
} as unknown as EnterpriseSmartVOCResult);

describe('buildClientSmartVOCSummary', () => {
    it('weights the client NPS by responses instead of averaging study scores', () => {
        const big = makeResult('big', { nps: [...Array(9).fill(0), 10] }, '2026-08-10');
        const small = makeResult('small', { nps: [10] }, '2026-09-10');

        const summary = buildClientSmartVOCSummary([big, small]);

        expect(summary.studies.map(s => [s.name, s.nps])).toEqual([['big study', -80], ['small study', 100]]);
        expect(summary.total.nps).toBe(-64);
        expect(summary.total).toMatchObject({ promoters: 2, neutrals: 0, detractors: 9, responses: 11 });
    });

    it('classifies CES with each study scale before combining', () => {
        const fivePoint = makeResult('a', { ces: [5, 1] }, '2026-09-01', 5);
        const tenPoint = makeResult('b', { ces: [8, 8] }, '2026-09-02', 10);

        const summary = buildClientSmartVOCSummary([fivePoint, tenPoint]);

        expect(summary.studies.map(s => s.ces)).toEqual([0, 100]);
        expect(summary.total.ces).toBe(50);
    });

    it('groups scores into sorted months and leaves metrics without data as null', () => {
        const september = makeResult('a', { csat: [5, 5] }, '2026-09-15');
        const august = makeResult('b', { csat: [1, 5] }, '2026-08-03');

        const summary = buildClientSmartVOCSummary([september, august]);

        expect(summary.months).toEqual([
            { month: '2026-08', responses: 2, nps: null, csat: 50, ces: null, cv: null },
            { month: '2026-09', responses: 2, nps: null, csat: 100, ces: null, cv: null },
        ]);
        expect(summary.total.nps).toBeNull();
    });
});
