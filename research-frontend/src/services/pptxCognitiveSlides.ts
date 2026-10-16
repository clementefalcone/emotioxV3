import PptxGenJS from 'pptxgenjs';
import {
    getChoiceResponses,
    getNavigationFlowResults,
    getRankingResponses,
    getScaleResponses,
    getTextAnalysis,
    type CognitiveTaskResults,
} from './analytics.service';
import { ACCENT, DARK, BODY, GREEN, RED, FONT, addSlideHeader, addThemesSlide } from './pptxSlideKit';

type CognitiveModule = CognitiveTaskResults['modules'][number];

interface SlideInput {
    pptx: PptxGenJS;
    slide: PptxGenJS.Slide;
    researchId: string;
    module: CognitiveModule;
}

const CHART_BOX = { x: 0.8, y: 1.5, w: 11.4, h: 5.4 };

const addQuestionText = (slide: PptxGenJS.Slide, questionText: string | undefined) => {
    if (!questionText) return;
    slide.addText(questionText, {
        x: 0.8, y: 1.0, w: 11.4, h: 0.4,
        fontSize: 12, fontFace: FONT, color: BODY, italic: true,
    });
};

const addMetricCards = (slide: PptxGenJS.Slide, cards: Array<{ label: string; value: string }>) => {
    cards.forEach((card, i) => {
        const x = 0.8 + i * 2.9;
        slide.addText(card.value, {
            x, y: 1.8, w: 2.6, h: 0.8,
            fontSize: 32, fontFace: FONT, color: ACCENT, bold: true, align: 'center',
        });
        slide.addText(card.label, {
            x, y: 2.6, w: 2.6, h: 0.4,
            fontSize: 11, fontFace: FONT, color: BODY, align: 'center',
        });
    });
};

const addChoiceSlide = async ({ pptx, slide, researchId, module }: SlideInput) => {
    const results = await getChoiceResponses(researchId, module.moduleId);
    addQuestionText(slide, results.questionText);
    const choices = [...results.choiceCounts].sort((first, second) => first.count - second.count);
    slide.addChart(pptx.ChartType.bar, [{
        name: 'Responses',
        labels: choices.map(choice => choice.choice),
        values: choices.map(choice => choice.percentage),
    }], {
        ...CHART_BOX,
        barDir: 'bar',
        chartColors: [ACCENT],
        valAxisMaxVal: 100,
        showValue: true,
        dataLabelFormatCode: '0"%"',
        catAxisLabelFontFace: FONT,
        catAxisLabelFontSize: 11,
        valAxisHidden: true,
        valGridLine: { style: 'none' },
    });
};

const addScaleSlide = async ({ pptx, slide, researchId, module }: SlideInput) => {
    const results = await getScaleResponses(researchId, module.moduleId);
    addQuestionText(slide, results.questionText);
    slide.addText(String(Math.round(results.average * 10) / 10), {
        x: 0.8, y: 1.8, w: 2.6, h: 0.9,
        fontSize: 44, fontFace: FONT, color: ACCENT, bold: true, align: 'center',
    });
    slide.addText(`Average · ${results.totalResponses} responses`, {
        x: 0.8, y: 2.7, w: 2.6, h: 0.4,
        fontSize: 11, fontFace: FONT, color: BODY, align: 'center',
    });
    const distribution = [...results.distribution].sort((first, second) => first.value - second.value);
    slide.addChart(pptx.ChartType.bar, [{
        name: 'Responses',
        labels: distribution.map(point => String(point.value)),
        values: distribution.map(point => point.percentage),
    }], {
        x: 3.8, y: 1.5, w: 8.4, h: 5.4,
        barDir: 'col',
        chartColors: [ACCENT],
        valAxisMaxVal: 100,
        showValue: true,
        dataLabelFormatCode: '0"%"',
        catAxisLabelFontFace: FONT,
        valAxisHidden: true,
        valGridLine: { style: 'none' },
    });
};

const addRankingSlide = async ({ pptx, slide, researchId, module }: SlideInput) => {
    const results = await getRankingResponses(researchId, module.moduleId);
    addQuestionText(slide, results.questionText);
    const rankings = [...results.rankings].sort((first, second) => second.meanPosition - first.meanPosition);
    slide.addChart(pptx.ChartType.bar, [{
        name: 'Average position (1 = first)',
        labels: rankings.map(ranking => ranking.label ?? ranking.item),
        values: rankings.map(ranking => Math.round(ranking.meanPosition * 10) / 10),
    }], {
        ...CHART_BOX,
        barDir: 'bar',
        chartColors: [ACCENT],
        showValue: true,
        dataLabelFormatCode: '0.0',
        catAxisLabelFontFace: FONT,
        catAxisLabelFontSize: 11,
        showTitle: true,
        title: 'Average position (1 = first)',
        titleFontSize: 11,
        titleColor: BODY,
        valAxisHidden: true,
        valGridLine: { style: 'none' },
    });
};

const addNavigationFlowSlide = async ({ slide, researchId, module }: SlideInput) => {
    const results = await getNavigationFlowResults(researchId, module.moduleId);
    addMetricCards(slide, [
        { label: 'Responses', value: String(results.totalResponses) },
        { label: 'Completed the flow', value: `${Math.round(results.completionRate)}%` },
        { label: 'Correct clicks', value: `${Math.round(results.accuracy)}%` },
        { label: 'Average time', value: `${Math.round(results.averageDuration)}s` },
    ]);
};

const addTextSlide = async ({ pptx, slide, researchId, module }: SlideInput) => {
    const texts = module.responses
        .filter(r => typeof r.value === 'string' && r.value.trim().length > 0)
        .map(r => ({
            text: r.value as string,
            sentiment: ((r.metadata as Record<string, unknown> | undefined)?.sentiment as string) || '',
        }));

    const sentCounts = { positive: 0, negative: 0, neutral: 0 };
    for (const t of texts) {
        const s = t.sentiment.toLowerCase() as keyof typeof sentCounts;
        if (s in sentCounts) sentCounts[s]++;
    }

    slide.addText(`${texts.length} responses`, {
        x: 0.8, y: 1.6, w: 3, h: 0.4,
        fontSize: 14, fontFace: FONT, color: DARK, bold: true,
    });

    const sentLabels = [
        { l: 'Positive', c: sentCounts.positive, cl: GREEN },
        { l: 'Negative', c: sentCounts.negative, cl: RED },
        { l: 'Neutral', c: sentCounts.neutral, cl: '9CA3AF' },
    ];
    sentLabels.forEach((s, i) => {
        slide.addText(`${s.l}: ${s.c}`, {
            x: 0.8 + i * 2.5, y: 2.1, w: 2, h: 0.3,
            fontSize: 11, fontFace: FONT, color: s.cl,
        });
    });

    const sample = texts.slice(0, 5).map(t => ({
        text: `"${t.text.slice(0, 100)}${t.text.length > 100 ? '...' : ''}"`,
        options: { fontSize: 10, fontFace: FONT, color: BODY, italic: true, lineSpacingMultiple: 1.4, bullet: { code: '201C', color: ACCENT } as const },
    }));
    if (sample.length > 0) {
        slide.addText(sample, { x: 0.8, y: 2.8, w: 11.4, h: 4, valign: 'top' as const });
    }

    const analysis = await getTextAnalysis(researchId, module.moduleId);
    if (analysis && analysis.themes.length > 0) {
        addThemesSlide(pptx, `Themes — ${module.moduleName}`, analysis, texts.length);
    }
};

const SLIDE_BUILDERS: Array<{ nameFragments: string[]; build: (input: SlideInput) => Promise<void> }> = [
    { nameFragments: ['single choice', 'multiple choice'], build: addChoiceSlide },
    { nameFragments: ['linear scale'], build: addScaleSlide },
    { nameFragments: ['ranking'], build: addRankingSlide },
    { nameFragments: ['navigation flow'], build: addNavigationFlowSlide },
    { nameFragments: ['short text', 'long text'], build: addTextSlide },
];

export const findSlideBuilder = (moduleName: string) => {
    const lower = moduleName.toLowerCase();
    return SLIDE_BUILDERS.find(builder => builder.nameFragments.some(fragment => lower.includes(fragment)));
};

export async function addCognitiveSlides(pptx: PptxGenJS, researchId: string, cognitive: CognitiveTaskResults): Promise<void> {
    for (const module of cognitive.modules) {
        const builder = findSlideBuilder(module.moduleName);
        if (!builder || module.totalResponses === 0) continue;
        const slide = pptx.addSlide();
        addSlideHeader(slide, `Cognitive — ${module.moduleName}`);
        await builder.build({ pptx, slide, researchId, module });
    }
}
