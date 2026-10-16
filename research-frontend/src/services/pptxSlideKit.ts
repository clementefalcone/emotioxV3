import PptxGenJS from 'pptxgenjs';
import type { TextAnalysis } from './analytics.service';

// ─── Brand ────────────────────────────────────────────────────────────
export const ACCENT = '006AFF';
export const DARK = '1E293B';
export const BODY = '64748B';
export const LIGHT_BG = 'F1F5F9';
export const GREEN = '22C55E';
export const RED = 'EF4444';
export const AMBER = 'F59E0B';
export const FONT = 'Plus Jakarta Sans';

export function addSlideHeader(slide: PptxGenJS.Slide, title: string) {
    slide.addShape('rect' as unknown as PptxGenJS.ShapeType, {
        x: 0, y: 0, w: '100%', h: 0.06,
        fill: { color: ACCENT },
    });
    slide.addText(title, {
        x: 0.8, y: 0.4, w: 11, h: 0.6,
        fontSize: 20, fontFace: FONT, color: DARK, bold: true,
    });
}

export function addThemesSlide(pptx: PptxGenJS, title: string, analysis: TextAnalysis, totalEntries: number) {
    const slide = pptx.addSlide();
    addSlideHeader(slide, title);

    analysis.themes.slice(0, 5).forEach((theme, i) => {
        const y = 1.6 + i * 1.1;
        const sentColor = theme.sentimentScore > 0.2 ? GREEN : theme.sentimentScore < -0.2 ? RED : '9CA3AF';
        const sentLabel = theme.sentimentScore > 0.2 ? 'positive' : theme.sentimentScore < -0.2 ? 'negative' : 'neutral';
        const mentionShare = totalEntries > 0 ? Math.min(theme.count / totalEntries, 1) : 0;

        slide.addText(theme.name, {
            x: 0.8, y, w: 6, h: 0.35,
            fontSize: 13, fontFace: FONT, color: DARK, bold: true,
        });
        slide.addText(`${theme.count} mentions (${Math.round(mentionShare * 100)}%) · ${sentLabel}`, {
            x: 7, y, w: 4, h: 0.35,
            fontSize: 10, fontFace: FONT, color: sentColor, align: 'right',
        });
        slide.addText(theme.description, {
            x: 0.8, y: y + 0.35, w: 10.5, h: 0.35,
            fontSize: 10, fontFace: FONT, color: BODY,
        });

        slide.addShape(pptx.ShapeType.rect, {
            x: 0.8, y: y + 0.75, w: 10.5, h: 0.08,
            fill: { color: LIGHT_BG },
        });
        slide.addShape(pptx.ShapeType.rect, {
            x: 0.8, y: y + 0.75, w: 10.5 * mentionShare, h: 0.08,
            fill: { color: ACCENT },
        });
    });
}
