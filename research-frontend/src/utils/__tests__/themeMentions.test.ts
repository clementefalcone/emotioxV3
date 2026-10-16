import { describe, it, expect } from 'vitest';
import { findThemeMentions } from '../themeMentions';

const comments = [
    { text: 'hice clic en un lugar equivocado', mood: 'negative' },
    { text: 'el texto era pequeño', mood: 'negative' },
    { text: 'el texto era pequeño', mood: 'neutral' },
    { text: 'me gustó', mood: 'positive' },
];

describe('findThemeMentions', () => {
    it('returns the comments the model assigned to the theme even when they do not contain the theme name', () => {
        expect(findThemeMentions(['hice clic en un lugar equivocado'], comments)).toEqual([comments[0]]);
    });

    it('counts every participant who wrote the same quoted text', () => {
        expect(findThemeMentions(['el texto era pequeño'], comments)).toHaveLength(2);
    });

    it('finds nothing for analyses saved without quotes', () => {
        expect(findThemeMentions(undefined, comments)).toEqual([]);
    });
});
