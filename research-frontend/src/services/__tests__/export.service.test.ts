import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ default: { get } }));

import { downloadResearchExport } from '../export.service';

const RESULTS_BY_PATH: Record<string, unknown> = {
    demographics: { participants: [{ participantId: 'p-1', demographics: {} }], demographicTypes: [] },
    'cognitive-tasks': { modules: [] },
    screener: { responses: [{ participantId: 'p-1', value: 'Yes' }] },
    'implicit-association': { modules: [] },
    smartvoc: { csatScores: [], cesScores: [], npsScores: [], cvScores: [], vocResponses: [], nevResponsesData: [] },
    'eye-tracking': { stimuli: [] },
    'implicit-association/raw-trials': { trials: [{
        participantId: 'p-1', module: 'IAT 1', testType: 'objects-comparing', phase: 'block-1', trialNumber: 3,
        targetId: 't-1', targetName: 'Curacaví', criterionId: 'c-1', criterionLabel: 'Positivo', attributeLabel: 'Lejos', rt: 640, correct: true,
    }] },
};

const answerFrom = (results: Record<string, unknown>) =>
    get.mockImplementation(async (url: string) => {
        const path = url.replace('/analytics/research/r-1/', '');
        if (!(path in results)) throw new Error(`HTTP 500 on ${url}`);
        return { results: results[path] };
    });

describe('downloadResearchExport', () => {
    const downloads: Record<string, string> = {};

    beforeEach(() => {
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

    it('includes screener answers and the IAT attribute of each trial', async () => {
        answerFrom(RESULTS_BY_PATH);
        await downloadResearchExport('r-1', 'Estudio');
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(downloads['Estudio_Participants.csv']).toContain('Screener');
        expect(downloads['Estudio_Participants.csv']).toContain('Yes');
        expect(downloads['Estudio_IAT_Raw_Trials.csv']).toContain('attributeLabel');
        expect(downloads['Estudio_IAT_Raw_Trials.csv']).toContain('Lejos');
    });

    it('fails instead of exporting a partial file when a section cannot load', async () => {
        const { 'eye-tracking': _missing, ...withoutEyeTracking } = RESULTS_BY_PATH;
        void _missing;
        answerFrom(withoutEyeTracking);

        await expect(downloadResearchExport('r-1', 'Estudio')).rejects.toThrow('HTTP 500 on /analytics/research/r-1/eye-tracking');
        expect(Object.keys(downloads)).toEqual([]);
    });
});
