import { describe, it, expect } from 'vitest';
import { findQuotedEntries } from '../quotedEntries';

const comments = [
    { text: 'hice clic en un lugar equivocado', mood: 'negative' },
    { text: 'el texto era pequeño', mood: 'negative' },
    { text: 'el texto era pequeño', mood: 'neutral' },
    { text: 'me gustó', mood: 'positive' },
];

describe('findQuotedEntries', () => {
    it('returns the comments the model assigned to the theme even when they do not contain the theme name', () => {
        expect(findQuotedEntries(['hice clic en un lugar equivocado'], comments)).toEqual([comments[0]]);
    });

    it('counts every participant who wrote the same quoted text', () => {
        expect(findQuotedEntries(['el texto era pequeño'], comments)).toHaveLength(2);
    });

    it('finds nothing for analyses saved without quotes', () => {
        expect(findQuotedEntries(undefined, comments)).toEqual([]);
    });
});
