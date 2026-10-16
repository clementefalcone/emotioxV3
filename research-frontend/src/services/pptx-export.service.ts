/**
 * PPTX Export Service
 * Generates a Google Slides-compatible presentation from SmartVOC and Cognitive Task results.
 */

import PptxGenJS from 'pptxgenjs';
import type { SmartVOCAnalytics } from './smartVOC.service';
import type { CognitiveTaskResults, IATModuleResult } from './analytics.service';
import { getTextAnalysis } from './analytics.service';
import { ACCENT, DARK, BODY, LIGHT_BG, GREEN, RED, AMBER, FONT, addSlideHeader, addThemesSlide } from './pptxSlideKit';
import { addCognitiveSlides } from './pptxCognitiveSlides';

interface ExportContext {
    researchName: string;
    researchId: string;
    smartvoc: SmartVOCAnalytics | null;
    cognitive: CognitiveTaskResults | null;
    executiveSummary?: {
        overview: string;
        keyFindings: string[];
        recommendations: string[];
    } | null;
    iat?: { modules: IATModuleResult[] } | null;
}

export async function generateResultsPptx(ctx: ExportContext): Promise<void> {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'EmotioX';
    pptx.title = `${ctx.researchName} — Results`;

    // ── Slide 1: Title ──────────────────────────────────────────────
    const titleSlide = pptx.addSlide();
    titleSlide.background = { fill: DARK };
    titleSlide.addText(ctx.researchName, {
        x: 0.8, y: 2.2, w: 11, h: 1.2,
        fontSize: 36, fontFace: FONT, color: 'FFFFFF', bold: true,
    });
    titleSlide.addText('Research Results', {
        x: 0.8, y: 3.4, w: 11, h: 0.6,
        fontSize: 18, fontFace: FONT, color: ACCENT,
    });
    titleSlide.addText(`Generated ${new Date().toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}`, {
        x: 0.8, y: 4.2, w: 11, h: 0.4,
        fontSize: 11, fontFace: FONT, color: '94A3B8',
    });
    titleSlide.addText('EmotioX', {
        x: 0.8, y: 6.5, w: 3, h: 0.4,
        fontSize: 12, fontFace: FONT, color: ACCENT, bold: true,
    });

    // ── Slide 2: Executive Summary (if available) ────────────────────
    if (ctx.executiveSummary) {
        const esSlide = pptx.addSlide();
        addSlideHeader(esSlide, 'Executive Summary');

        esSlide.addText(ctx.executiveSummary.overview, {
            x: 0.8, y: 1.4, w: 11.4, h: 1.2,
            fontSize: 13, fontFace: FONT, color: BODY, lineSpacingMultiple: 1.4,
            valign: 'top',
        });

        if (ctx.executiveSummary.keyFindings.length > 0) {
            esSlide.addText('Key Findings', {
                x: 0.8, y: 2.8, w: 5, h: 0.4,
                fontSize: 12, fontFace: FONT, color: DARK, bold: true,
            });
            const findings = ctx.executiveSummary.keyFindings.map((f, i) => ({
                text: `${i + 1}. ${f}`,
                options: { fontSize: 11, fontFace: FONT, color: BODY, lineSpacingMultiple: 1.5, bullet: false as const },
            }));
            esSlide.addText(findings, {
                x: 0.8, y: 3.2, w: 5.5, h: 3.5,
                valign: 'top',
            });
        }

        if (ctx.executiveSummary.recommendations.length > 0) {
            esSlide.addText('Recommendations', {
                x: 6.8, y: 2.8, w: 5, h: 0.4,
                fontSize: 12, fontFace: FONT, color: DARK, bold: true,
            });
            const recs = ctx.executiveSummary.recommendations.map(r => ({
                text: r,
                options: { fontSize: 11, fontFace: FONT, color: BODY, lineSpacingMultiple: 1.5, bullet: { code: '25CF', color: GREEN } as const },
            }));
            esSlide.addText(recs, {
                x: 6.8, y: 3.2, w: 5.5, h: 3.5,
                valign: 'top',
            });
        }
    }

    // ── SmartVOC Slides ──────────────────────────────────────────────
    if (ctx.smartvoc) {
        const m = ctx.smartvoc.metrics;

        // Metrics overview
        const metricsSlide = pptx.addSlide();
        addSlideHeader(metricsSlide, 'SmartVOC — Metrics Overview');

        const cards: Array<{ label: string; value: string; color: string }> = [];
        if (m.npsScore !== undefined) cards.push({ label: 'NPS', value: String(m.npsScore), color: m.npsScore >= 0 ? GREEN : RED });
        if (m.satisfaction !== undefined) cards.push({ label: 'CSAT', value: `${Math.round(m.satisfaction)}%`, color: m.satisfaction >= 70 ? GREEN : AMBER });
        if (m.cesScores?.length > 0) {
            const avg = Math.round(m.cesScores.reduce((s, c) => s + c.value, 0) / m.cesScores.length * 10) / 10;
            cards.push({ label: 'CES', value: String(avg), color: avg >= 4 ? GREEN : AMBER });
        }
        if (m.cvScores?.length > 0) {
            const avg = Math.round(m.cvScores.reduce((s, c) => s + c.value, 0) / m.cvScores.length * 10) / 10;
            cards.push({ label: 'CV', value: String(avg), color: avg >= 4 ? GREEN : AMBER });
        }
        cards.push({ label: 'CPV', value: String(Math.round(m.cpvValue)), color: ACCENT });

        const cardW = Math.min(2.2, 11 / Math.max(cards.length, 1));
        cards.forEach((card, i) => {
            const x = 0.8 + i * (cardW + 0.3);
            metricsSlide.addShape(pptx.ShapeType.roundRect, {
                x, y: 1.6, w: cardW, h: 1.4,
                fill: { color: LIGHT_BG }, rectRadius: 0.1,
            });
            metricsSlide.addText(card.value, {
                x, y: 1.7, w: cardW, h: 0.7,
                fontSize: 28, fontFace: FONT, color: card.color, bold: true, align: 'center',
            });
            metricsSlide.addText(card.label, {
                x, y: 2.4, w: cardW, h: 0.4,
                fontSize: 11, fontFace: FONT, color: BODY, align: 'center',
            });
        });

        // NPS breakdown
        if (m.promoters + m.neutrals + m.detractors > 0) {
            const total = m.promoters + m.neutrals + m.detractors;
            const npsData = [
                { label: 'Promoters', val: m.promoters, pct: Math.round(m.promoters / total * 100), color: GREEN },
                { label: 'Neutrals', val: m.neutrals, pct: Math.round(m.neutrals / total * 100), color: AMBER },
                { label: 'Detractors', val: m.detractors, pct: Math.round(m.detractors / total * 100), color: RED },
            ];

            metricsSlide.addText('NPS Breakdown', {
                x: 0.8, y: 3.4, w: 5, h: 0.4,
                fontSize: 12, fontFace: FONT, color: DARK, bold: true,
            });

            npsData.forEach((d, i) => {
                const y = 3.9 + i * 0.6;
                metricsSlide.addText(`${d.label}: ${d.val} (${d.pct}%)`, {
                    x: 0.8, y, w: 4, h: 0.3,
                    fontSize: 11, fontFace: FONT, color: BODY,
                });
                metricsSlide.addShape(pptx.ShapeType.rect, {
                    x: 0.8, y: y + 0.3, w: 4, h: 0.12,
                    fill: { color: LIGHT_BG },
                });
                metricsSlide.addShape(pptx.ShapeType.rect, {
                    x: 0.8, y: y + 0.3, w: 4 * d.pct / 100, h: 0.12,
                    fill: { color: d.color },
                });
            });
        }

        // NEV emotions
        if (ctx.smartvoc.emotionalStates && Object.keys(ctx.smartvoc.emotionalStates).length > 0) {
            const nevSlide = pptx.addSlide();
            addSlideHeader(nevSlide, 'SmartVOC — Emotional States (NEV)');

            const emotions = Object.entries(ctx.smartvoc.emotionalStates)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10);
            const maxVal = emotions[0]?.[1] || 1;

            emotions.forEach(([emotion, count], i) => {
                const y = 1.6 + i * 0.45;
                const barW = (count / maxVal) * 8;
                nevSlide.addText(emotion, {
                    x: 0.8, y, w: 2.5, h: 0.35,
                    fontSize: 11, fontFace: FONT, color: BODY, align: 'right',
                });
                nevSlide.addShape(pptx.ShapeType.rect, {
                    x: 3.5, y: y + 0.05, w: barW, h: 0.25,
                    fill: { color: ACCENT },
                });
                nevSlide.addText(String(count), {
                    x: 3.5 + barW + 0.15, y, w: 1, h: 0.35,
                    fontSize: 10, fontFace: FONT, color: BODY,
                });
            });
        }

        // VOC sentiment
        const vocCount = ctx.smartvoc.vocResponses.length;
        if (vocCount > 0) {
            const vocSlide = pptx.addSlide();
            addSlideHeader(vocSlide, 'SmartVOC — Voice of Customer');

            const sentCounts = { positive: 0, negative: 0, neutral: 0, indeterminate: 0 };
            for (const v of ctx.smartvoc.vocResponses) {
                const s = (v.sentiment || 'indeterminate').toLowerCase() as keyof typeof sentCounts;
                if (s in sentCounts) sentCounts[s]++;
            }

            const sentItems = [
                { label: 'Positive', count: sentCounts.positive, color: GREEN },
                { label: 'Negative', count: sentCounts.negative, color: RED },
                { label: 'Neutral', count: sentCounts.neutral, color: '9CA3AF' },
                { label: 'Indeterminate', count: sentCounts.indeterminate, color: AMBER },
            ];

            sentItems.forEach((item, i) => {
                const x = 0.8 + i * 3;
                vocSlide.addText(String(item.count), {
                    x, y: 1.6, w: 2.5, h: 0.6,
                    fontSize: 24, fontFace: FONT, color: item.color, bold: true, align: 'center',
                });
                vocSlide.addText(`${item.label} (${vocCount > 0 ? Math.round(item.count / vocCount * 100) : 0}%)`, {
                    x, y: 2.2, w: 2.5, h: 0.3,
                    fontSize: 10, fontFace: FONT, color: BODY, align: 'center',
                });
            });

            // Sample quotes
            const topQuotes = ctx.smartvoc.vocResponses
                .filter(v => v.text && v.text.trim().length > 10)
                .slice(0, 6);
            if (topQuotes.length > 0) {
                vocSlide.addText('Sample Responses', {
                    x: 0.8, y: 3.0, w: 5, h: 0.4,
                    fontSize: 12, fontFace: FONT, color: DARK, bold: true,
                });
                const quotes = topQuotes.map(q => ({
                    text: `"${q.text.slice(0, 120)}${q.text.length > 120 ? '...' : ''}"`,
                    options: {
                        fontSize: 10, fontFace: FONT, color: BODY, italic: true,
                        lineSpacingMultiple: 1.4,
                        bullet: { code: '201C', color: ACCENT } as const,
                    },
                }));
                vocSlide.addText(quotes, {
                    x: 0.8, y: 3.4, w: 11.4, h: 3.5,
                    valign: 'top' as const,
                });
            }
        }

        // Text analysis themes (if cached)
        try {
            const analysis = await getTextAnalysis(ctx.researchId, 'voc');
            if (analysis && analysis.themes.length > 0) {
                addThemesSlide(pptx, 'SmartVOC — Themes', analysis, vocCount);
            }
        } catch { /* no cached analysis */ }
    }

    if (ctx.cognitive) {
        await addCognitiveSlides(pptx, ctx.researchId, ctx.cognitive);
    }

    // ── IAT Slides ────────────────────────────────────────────────────
    if (ctx.iat && ctx.iat.modules.length > 0) {
        for (const mod of ctx.iat.modules) {
            addIATSlide(pptx, mod);
        }
    }

    // ── Final slide ──────────────────────────────────────────────────
    const endSlide = pptx.addSlide();
    endSlide.background = { fill: DARK };
    endSlide.addText('Thank you', {
        x: 0.8, y: 2.5, w: 11, h: 1,
        fontSize: 36, fontFace: FONT, color: 'FFFFFF', bold: true, align: 'center',
    });
    endSlide.addText('EmotioX — UX Research Platform', {
        x: 0.8, y: 3.6, w: 11, h: 0.5,
        fontSize: 14, fontFace: FONT, color: ACCENT, align: 'center',
    });

    // Download
    const fileName = `${ctx.researchName.replace(/[^a-zA-Z0-9_-]/g, '_')}_results.pptx`;
    await pptx.writeFile({ fileName });
}

// ─── IAT Slide ──────────────────────────────────────────────────────

const TEST_TYPE_LABELS: Record<string, string> = {
    attribute_testing: 'Attribute Testing (RTT)',
    comparing_attribute: 'Comparing Attribute',
    objects_comparing: 'Objects Comparing (IAT)',
};

function addIATSlide(pptx: PptxGenJS, mod: IATModuleResult) {
    // Slide 1 — Overview
    const slide = pptx.addSlide();
    addSlideHeader(slide, `Implicit Association — ${TEST_TYPE_LABELS[mod.testType] ?? mod.testType}`);

    if (mod.testTitle) {
        slide.addText(mod.testTitle, {
            x: 0.8, y: 1.2, w: 11, h: 0.35,
            fontSize: 12, fontFace: FONT, color: BODY, italic: true,
        });
    }

    // Metric cards
    const cards: Array<{ label: string; value: string; color: string }> = [
        { label: 'Responses', value: String(mod.totalResponses), color: ACCENT },
        { label: 'Targets', value: String(mod.targets.length), color: DARK },
        { label: 'Attributes', value: String(mod.attributes.length), color: DARK },
    ];

    if (mod.dScore) {
        cards.push({ label: 'D-score', value: String(mod.dScore.value), color: Math.abs(mod.dScore.value) >= 0.35 ? AMBER : GREEN });
        cards.push({ label: 'Effect', value: mod.dScore.effect.charAt(0).toUpperCase() + mod.dScore.effect.slice(1), color: BODY });
        if (mod.dScore.reliability !== null && mod.dScore.reliability !== undefined) {
            cards.push({ label: 'Reliability', value: String(mod.dScore.reliability), color: mod.dScore.reliability >= 0.7 ? GREEN : AMBER });
        }
    }

    if (mod.errorAnalysis) {
        cards.push({ label: 'Error Rate', value: `${mod.errorAnalysis.overallErrorRate}%`, color: mod.errorAnalysis.overallErrorRate > 15 ? RED : GREEN });
    }

    const startY = mod.testTitle ? 1.7 : 1.4;
    const cardW = Math.min(1.6, 11 / Math.max(cards.length, 1));
    cards.forEach((card, i) => {
        const x = 0.8 + i * (cardW + 0.15);
        slide.addShape(pptx.ShapeType.roundRect, {
            x, y: startY, w: cardW, h: 1.1,
            fill: { color: LIGHT_BG }, rectRadius: 0.08,
        });
        slide.addText(card.value, {
            x, y: startY + 0.1, w: cardW, h: 0.5,
            fontSize: 20, fontFace: FONT, color: card.color, bold: true, align: 'center',
        });
        slide.addText(card.label, {
            x, y: startY + 0.6, w: cardW, h: 0.3,
            fontSize: 9, fontFace: FONT, color: BODY, align: 'center',
        });
    });

    // Association scores table
    if (mod.scores.length > 0 && mod.targets.length > 0) {
        const tableY = startY + 1.4;
        const headerRow = [
            { text: 'Attribute', options: { fontSize: 9, fontFace: FONT, color: 'FFFFFF', fill: { color: DARK }, bold: true, align: 'left' as const } },
            ...mod.targets.map(t => ({
                text: t.name,
                options: { fontSize: 9, fontFace: FONT, color: 'FFFFFF', fill: { color: DARK }, bold: true, align: 'center' as const },
            })),
        ];

        const dataRows = mod.scores.slice(0, 8).map(score => [
            { text: score.attributeLabel, options: { fontSize: 9, fontFace: FONT, color: BODY, align: 'left' as const } },
            ...mod.targets.map(t => ({
                text: `${score.targetScores[t.id] ?? 0}%`,
                options: { fontSize: 9, fontFace: FONT, color: DARK, align: 'center' as const, bold: Math.abs(score.targetScores[t.id] ?? 0) >= 70 },
            })),
        ]);

        slide.addTable([headerRow, ...dataRows], {
            x: 0.8, y: tableY, w: 11.4,
            border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
            rowH: 0.3,
            colW: [3, ...mod.targets.map(() => Math.min(2, 8.4 / mod.targets.length))],
        });
    }

    // Slide 2 — D-score detail (only if available)
    if (mod.dScore && mod.participantData) {
        const dsSlide = pptx.addSlide();
        addSlideHeader(dsSlide, `D-score Detail — ${mod.moduleName}`);

        const ds = mod.dScore;
        dsSlide.addText(String(ds.value), {
            x: 0.8, y: 1.4, w: 3, h: 1,
            fontSize: 48, fontFace: FONT, color: ACCENT, bold: true, align: 'center',
        });
        dsSlide.addText(`95% CI: [${ds.ciLower}, ${ds.ciUpper}] · ${ds.validParticipants} participants`, {
            x: 0.8, y: 2.4, w: 3, h: 0.3,
            fontSize: 10, fontFace: FONT, color: BODY, align: 'center',
        });

        // Individual D-scores table (top 15)
        const validPD = mod.participantData
            .filter(p => p.dScore != null)
            .sort((a, b) => Math.abs(b.dScore!) - Math.abs(a.dScore!))
            .slice(0, 15);

        if (validPD.length > 0) {
            const pdHeader = [
                { text: 'Participant', options: { fontSize: 8, fontFace: FONT, color: 'FFFFFF', fill: { color: DARK }, bold: true } },
                { text: 'D-score', options: { fontSize: 8, fontFace: FONT, color: 'FFFFFF', fill: { color: DARK }, bold: true, align: 'center' as const } },
                { text: 'Effect', options: { fontSize: 8, fontFace: FONT, color: 'FFFFFF', fill: { color: DARK }, bold: true, align: 'center' as const } },
                { text: 'Quality', options: { fontSize: 8, fontFace: FONT, color: 'FFFFFF', fill: { color: DARK }, bold: true, align: 'center' as const } },
                { text: 'Accuracy', options: { fontSize: 8, fontFace: FONT, color: 'FFFFFF', fill: { color: DARK }, bold: true, align: 'center' as const } },
            ];

            const pdRows = validPD.map(p => [
                { text: p.participantId.slice(0, 20), options: { fontSize: 8, fontFace: FONT, color: BODY } },
                { text: String(p.dScore), options: { fontSize: 8, fontFace: FONT, color: DARK, bold: true, align: 'center' as const } },
                { text: p.dScoreEffect ?? '-', options: { fontSize: 8, fontFace: FONT, color: BODY, align: 'center' as const } },
                { text: p.quality, options: { fontSize: 8, fontFace: FONT, color: BODY, align: 'center' as const } },
                { text: `${Math.round(p.accuracy * 100)}%`, options: { fontSize: 8, fontFace: FONT, color: BODY, align: 'center' as const } },
            ]);

            dsSlide.addTable([pdHeader, ...pdRows], {
                x: 4.5, y: 1.4, w: 8,
                border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
                rowH: 0.25,
                colW: [2.5, 1.2, 1.3, 1.5, 1.5],
            });
        }

        // Error summary footer
        if (mod.errorAnalysis) {
            dsSlide.addText(
                `Overall: ${mod.errorAnalysis.overallErrorRate}% error rate · ${mod.errorAnalysis.overallFastRate}% fast responses (<300ms)`,
                {
                    x: 0.8, y: 6.5, w: 11, h: 0.3,
                    fontSize: 10, fontFace: FONT, color: BODY,
                },
            );
        }
    }
}
