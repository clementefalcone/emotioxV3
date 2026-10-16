import { describe, it, expect } from 'vitest';
import { attachThemeQuotes } from '../insights.service';

const sample = ['hice clic en un lugar equivocado', 'el texto era pequeño', 'cambió la edad'];
const baseTheme = { name: 'Interacción del Usuario', description: 'd', magnitude: 0.9, sentimentScore: -0.6 };
const analyze = (entries: unknown) => attachThemeQuotes(
    { sentiment: { summary: '', description: '', actionables: [] }, themes: [{ ...baseTheme, entries }], keywords: [] },
    sample,
).themes[0];

describe('attachThemeQuotes', () => {
    it('turns the numbered entries of a theme into their exact texts and counts them', () => {
        const theme = analyze([1, 2]);
        expect(theme.supportingQuotes).toEqual(['hice clic en un lugar equivocado', 'el texto era pequeño']);
        expect(theme.count).toBe(2);
        expect(theme).not.toHaveProperty('entries');
    });

    it('drops numbers outside the sample, non-integers and repeats', () => {
        expect(analyze([0, 3, 3, 4, 1.5, '2']).supportingQuotes).toEqual(['cambió la edad']);
    });

    it('gives an empty list when the model returns no entries', () => {
        expect(analyze(undefined)).toMatchObject({ count: 0, supportingQuotes: [] });
    });
});
