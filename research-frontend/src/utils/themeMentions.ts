export const findThemeMentions = <T extends { text: string }>(supportingQuotes: string[] | undefined, items: T[]): T[] => {
    const quotes = new Set(supportingQuotes ?? []);
    return items.filter(item => quotes.has(item.text));
};
