import { describe, it, expect } from 'vitest';
import { attachEntryQuotes, buildEntrySample } from '../insights.service';

const sample = ['hice clic en un lugar equivocado', 'el texto era pequeño', 'cambió la edad'];
const baseTheme = { name: 'Interacción del Usuario', description: 'd', magnitude: 0.9, sentimentScore: -0.6 };
const analyze = (themeEntries: unknown, keywordEntries: unknown = []) => attachEntryQuotes(
    {
        sentiment: { summary: '', description: '', actionables: [] },
        themes: [{ ...baseTheme, entries: themeEntries }],
        keywords: [{ word: 'modificación', sentiment: 'neutral', entries: keywordEntries }],
    },
    sample,
);

describe('attachEntryQuotes', () => {
    it('turns the numbered entries of a theme into their exact texts and counts them', () => {
        const theme = analyze([1, 2]).themes[0];
        expect(theme.supportingQuotes).toEqual(['hice clic en un lugar equivocado', 'el texto era pequeño']);
        expect(theme.count).toBe(2);
        expect(theme).not.toHaveProperty('entries');
    });

    it('counts a keyword from the entries the model linked, even when the word appears in another form', () => {
        const keyword = analyze([], [3]).keywords[0];
        expect(keyword.supportingQuotes).toEqual(['cambió la edad']);
        expect(keyword.count).toBe(1);
        expect(keyword).not.toHaveProperty('entries');
    });

    it('also counts every entry that contains the keyword literally, ignoring case and accents', () => {
        const analysis = attachEntryQuotes(
            {
                sentiment: { summary: '', description: '', actionables: [] },
                themes: [],
                keywords: [{ word: 'Cambió', sentiment: 'neutral', entries: [1] }],
            },
            ['hice clic en un lugar equivocado', 'cambio la edad', 'CAMBIÓ el monto', 'nada'],
        );
        expect(analysis.keywords[0].supportingQuotes).toEqual(['hice clic en un lugar equivocado', 'cambio la edad', 'CAMBIÓ el monto']);
        expect(analysis.keywords[0].count).toBe(3);
    });

    it('drops numbers outside the sample, non-integers and repeats', () => {
        expect(analyze([0, 3, 3, 4, 1.5, '2']).themes[0].supportingQuotes).toEqual(['cambió la edad']);
    });

    it('gives an empty list when the model returns no entries', () => {
        const analysis = analyze(undefined, undefined);
        expect(analysis.themes[0]).toMatchObject({ count: 0, supportingQuotes: [] });
        expect(analysis.keywords[0]).toMatchObject({ count: 0, supportingQuotes: [] });
    });
});

describe('buildEntrySample', () => {
    it('sends up to 200 entries to the model, so studies with 101-200 comments are fully analyzed', () => {
        const entries = Array.from({ length: 250 }, (_, i) => ({ text: `comentario ${i + 1}`, mood: '' }));
        const sample = buildEntrySample(entries);
        expect(sample).toHaveLength(200);
        expect(sample[103]).toBe('comentario 104');
        expect(sample[199]).toBe('comentario 200');
    });
});
