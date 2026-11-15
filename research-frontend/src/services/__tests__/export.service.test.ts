import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ default: { get } }));

import { downloadRawData, downloadSectionCsv, type ResultsSection } from '../export.service';

const RESPONSES = [
    { participant_id: 'p-2', module_id: 'm-screener', module_name: 'Screener', question_id: null, component_id: 'c-1', question_text: null, value: '"Yes"', created_at: '2026-11-01T10:00:00Z' },
    { participant_id: 'p-1', module_id: 'm-screener', module_name: 'Screener', question_id: null, component_id: 'c-1', question_text: null, value: '"No"', created_at: '2026-11-01T09:00:00Z' },
    { participant_id: 'p-1', module_id: 'm-other', module_name: 'Single Choice', question_id: null, component_id: 'c-2', question_text: null, value: '["A","B"]', created_at: '2026-11-01T09:05:00Z' },
];

const RESULTS_BY_PATH: Record<string, unknown> = {
    demographics: { participants: [{ participantId: 'p-1', demographics: { Edad: '25-34' } }], demographicTypes: ['Edad'] },
    smartvoc: {
        metrics: { npsScores: [{ participantId: 'p-1', value: 9, date: '2026-11-01' }], csatScores: [], cesScores: [], cvScores: [] },
        vocResponses: [],
        nevResponsesData: [],
    },
    'eye-tracking?stageId=s-shelf': { stimuli: [{
        moduleName: 'Shelf',
        participants: [{
            participantId: 'p-1', deviceType: 'desktop', qualityGrade: 'good', calibrationRmsePx: 150, faceDetectedPercent: 100, totalFixations: 12, totalDwellTime: 4000,
            aoiMetrics: [
                { label: 'Pepsi', dwellTimePercent: 40, fixationCount: 5, avgTTFF: 300, isNoticed: true },
                { label: 'Piri', dwellTimePercent: 0, fixationCount: 0, avgTTFF: 0, isNoticed: false },
            ],
        }],
    }] },
};

const answerFrom = (results: Record<string, unknown>) =>
    get.mockImplementation(async (url: string) => {
        if (url.startsWith('/responses/research/r-1')) return { responses: RESPONSES };
        const path = url.replace('/analytics/research/r-1/', '');
        if (!(path in results)) throw new Error(`HTTP 500 on ${url}`);
        return { results: results[path] };
    });

const section = (stageType: string, overrides: Partial<ResultsSection> = {}): ResultsSection =>
    ({ stageType, stageId: 's-1', label: stageType, moduleIds: [], ...overrides });

describe('export.service', () => {
    const downloads: Record<string, string> = {};

    beforeEach(() => {
        answerFrom(RESULTS_BY_PATH);
        vi.stubGlobal('URL', { ...URL, createObjectURL: (blob: Blob) => { (globalThis as Record<string, unknown>).lastBlob = blob; return 'blob:x'; }, revokeObjectURL: vi.fn() });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            downloads[this.download] = '';
            void ((globalThis as Record<string, unknown>).lastBlob as Blob).text().then(text => { downloads[this.download] = text; });
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        for (const name of Object.keys(downloads)) delete downloads[name];
    });

    const flushDownloads = () => new Promise(resolve => setTimeout(resolve, 0));

    it('exports RAW DATA as one row per response, ordered by participant and time', async () => {
        await downloadRawData('r-1', 'Estudio');
        await flushDownloads();

        const lines = downloads['Estudio_RAW_DATA.csv'].trim().split('\n');
        expect(lines).toHaveLength(4);
        expect(lines[1]).toContain('p-1,Screener');
        expect(lines[2]).toContain('A; B');
        expect(lines[3]).toContain('p-2,Screener');
    });

    it('exports a section as one row per participant with only that section modules, demographics and the shown participants', async () => {
        await downloadSectionCsv('r-1', 'Estudio', { section: section('screener', { label: 'Screener', moduleIds: ['m-screener'] }), participantIds: ['p-1'] });
        await flushDownloads();

        const csv = downloads['Estudio_Screener.csv'];
        expect(csv.split('\n')[0]).toContain('participantId,Edad,Screener');
        expect(csv).toContain('p-1,25-34,No');
        expect(csv).not.toContain('Single Choice');
        expect(csv).not.toContain('p-2');
    });

    it('exports the eye tracking section with each participant AOI metrics as columns', async () => {
        await downloadSectionCsv('r-1', 'Estudio', { section: section('eye-tracking', { stageId: 's-shelf', label: 'Shelf' }) });
        await flushDownloads();

        const [header, row] = downloads['Estudio_Shelf.csv'].trim().split('\n');
        expect(header).toContain('Pepsi · tiempo de mirada %');
        expect(header).toContain('Piri · notada');
        expect(row).toContain('p-1,25-34,Shelf,desktop,good,150,100,12,4000,40,5,300,sí,0,0,,no');
    });

    it('reads SmartVOC scores from the analytics metrics', async () => {
        await downloadSectionCsv('r-1', 'Estudio', { section: section('smart-voc', { label: 'SmartVOC' }) });
        await flushDownloads();

        expect(downloads['Estudio_SmartVOC.csv']).toContain('p-1,25-34,9');
    });

    it('fails instead of exporting a partial file when the section cannot load', async () => {
        await expect(downloadSectionCsv('r-1', 'Estudio', { section: section('eye-tracking', { stageId: 's-missing' }) }))
            .rejects.toThrow('HTTP 500 on /analytics/research/r-1/eye-tracking?stageId=s-missing');
        expect(Object.keys(downloads)).toEqual([]);
    });
});
