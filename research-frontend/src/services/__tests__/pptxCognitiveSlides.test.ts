import { describe, it, expect, vi } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import type { CognitiveTaskResults } from '../analytics.service';

vi.mock('../analytics.service', () => ({
    getChoiceResponses: vi.fn(async () => ({
        totalResponses: 2, questionText: '¿Cumples los requisitos?', responses: [],
        choiceCounts: [{ choice: 'NO', count: 2, percentage: 100 }, { choice: 'SI', count: 0, percentage: 0 }],
    })),
    getScaleResponses: vi.fn(async () => ({
        totalResponses: 53, average: 3.6, questionText: '¿Qué tan fácil fue?', responses: [],
        distribution: [{ value: 1, count: 2, percentage: 4 }, { value: 5, count: 12, percentage: 23 }],
    })),
    getRankingResponses: vi.fn(async () => ({
        totalResponses: 10, responses: [],
        rankings: [{ item: 'A', meanPosition: 1.4, count: 10 }, { item: 'B', meanPosition: 2.1, count: 10 }],
    })),
    getNavigationFlowResults: vi.fn(async () => ({
        totalResponses: 54, completedFlows: 54, completionRate: 100, totalClicks: 60, correctClicks: 54,
        accuracy: 90, averageDuration: 49, heatmapData: [], responses: [],
    })),
    getTextAnalysis: vi.fn(async () => null),
}));

import { addCognitiveSlides, findSlideBuilder } from '../pptxCognitiveSlides';

const module = (moduleName: string, totalResponses = 10) => ({
    moduleId: moduleName, moduleName, description: '', totalResponses, responses: [],
}) as CognitiveTaskResults['modules'][number];

const exportSlides = async (modules: CognitiveTaskResults['modules']) => {
    const pptx = new PptxGenJS();
    await addCognitiveSlides(pptx, 'research-1', { modules });
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer);
    const charts = Object.keys(zip.files).filter(name => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    const slides = await Promise.all(Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((first, second) => Number(first.match(/\d+/)?.[0]) - Number(second.match(/\d+/)?.[0]))
        .map(name => zip.file(name)?.async('string') ?? ''));
    return { charts, slides };
};

describe('addCognitiveSlides', () => {
    it('draws native charts for choice, scale and ranking from their own endpoints', async () => {
        const { charts, slides } = await exportSlides([module('Single Choice'), module('Linear Scale'), module('Ranking')]);
        expect(charts).toHaveLength(3);
        expect(slides).toHaveLength(3);
        slides.forEach(slide => expect(slide).toContain('<p:graphicFrame'));
        expect(slides[0]).toContain('¿Cumples los requisitos?');
        expect(slides[1]).toContain('3.6');
    });

    it('adds navigation flow metrics instead of skipping the module', async () => {
        const { slides } = await exportSlides([module('Navigation Flow')]);
        expect(slides).toHaveLength(1);
        expect(slides[0]).toContain('100%');
        expect(slides[0]).toContain('90%');
        expect(slides[0]).toContain('49s');
    });

    it('skips modules without responses and types it does not export', async () => {
        const { slides } = await exportSlides([module('Linear Scale', 0), module('Preference Test')]);
        expect(slides).toHaveLength(0);
    });

    it.each([
        ['Single Choice', true], ['Multiple Choice', true], ['Linear Scale', true], ['Ranking', true],
        ['Navigation Flow', true], ['Short Text', true], ['Long Text', true], ['Preference Test', false],
    ])('%s has a slide builder: %s', (name, hasBuilder) => {
        expect(Boolean(findSlideBuilder(name))).toBe(hasBuilder);
    });
});
