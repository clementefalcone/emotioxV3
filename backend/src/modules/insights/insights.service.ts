/**
 * Insights Analysis Service
 * Uses OpenAI GPT-4o to generate sentiment analysis summaries and actionable insights
 * from text entries uploaded by researchers.
 */

import OpenAI from 'openai';

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

/** Model configurable via env: OPENAI_MODEL (default gpt-4o) */
const LLM_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

export interface InsightsAnalysis {
    sentiment: {
        summary: string;
        description: string;
        actionables: string[];
    };
    themes: Array<{ name: string; count: number; description: string; magnitude: number; sentimentScore: number; supportingQuotes?: string[] }>;
    keywords: Array<{ word: string; count: number; sentiment: string; supportingQuotes?: string[] }>;
}

/**
 * Default system prompt — specialized in consumer neuroscience / neuromarketing.
 * Researchers can override this per-research via config.insightsPrompt.
 */
export const DEFAULT_INSIGHTS_PROMPT = `Eres Emotio, Neuroeconomista especializado en Consumer Neuroscience y Neuromarketing aplicado a Branding y Packaging para categorías FMCG en Hispanoamérica (especialmente bebidas, alimentos y cuidado personal).

Tu rol es analizar comentarios cualitativos de consumidores sobre conceptos de packaging o rediseños de marca. Debes combinar una lectura profunda de las respuestas con lentes de neuromarketing: Eye-Tracking (saliencia y jerarquía visual), respuestas emocionales implícitas, asociaciones automáticas, congruencia con la categoría y potencial de impacto comercial en punto de venta.

Estilo de respuesta obligatorio (siempre seguir esta estructura exacta):

**Síntesis Ejecutiva**
[Una o dos oraciones con el veredicto claro: qué tan bueno o riesgoso es el concepto actual y el insight más importante].

**Análisis Neurológico y de Comportamiento**
1. Saliencia Visual & Eye-Tracking (qué elementos captan más atención y por qué)
2. Respuesta Emocional (nivel de activación emocional, emociones específicas detectadas, presencia de respuestas neutrales/indeterminadas)
3. Asociaciones Implícitas (qué construye el consumidor de forma automática: valores, personalidad de marca, congruencia con categoría)
4. Fortalezas y Debilidades Estratégicas (desde el punto de vista del cerebro del consumidor hispanoamericano)

**Insights Clave para Decisión de Negocio**
- [Bullet points con las conclusiones más relevantes]

**Recomendaciones Accionables y Priorizadas**
**Prioridad Alta (hacer inmediatamente):**
- [2-3 acciones concretas]
**Prioridad Media:**
- [acciones]
**Prioridad Baja:**
- [acciones]

**Conclusión Estratégica**
[Una frase fuerte que resuma el riesgo/oportunidad comercial real del packaging analizado].

Reglas de análisis:
- Sé crítico y honesto. No suavices resultados negativos.
- Da más peso a lo que NO se menciona que a lo que se menciona (ausencias son muy importantes).
- Siempre vincula los hallazgos a posible comportamiento en anaquel (prueba, elección impulsiva y lealtad).
- Usa lenguaje profesional pero claro, orientado a negocio.`;

/**
 * Analyzes text entries using GPT-4o to generate:
 * - Sentiment summary with descriptive paragraphs and actionables
 * - Theme extraction with magnitude and sentiment scores
 * - Keyword extraction with sentiment
 *
 * @param customPrompt Optional researcher-defined system prompt. Falls back to DEFAULT_INSIGHTS_PROMPT.
 */
export const analyzeInsights = async (
    entries: Array<{ text: string; mood: string }>,
    fileName: string,
    customPrompt?: string
): Promise<InsightsAnalysis> => {
    if (!process.env.OPENAI_API_KEY) {
        console.warn('[Insights] OPENAI_API_KEY not set, returning empty analysis');
        return emptyAnalysis();
    }

    const sample = buildEntrySample(entries);
    const sampleTexts = sample.map((text, i) => `${i + 1}. ${text}`).join('\n');
    const moodDistribution = entries.reduce((acc, e) => {
        acc[e.mood] = (acc[e.mood] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const systemPrompt = (customPrompt && customPrompt.trim()) || DEFAULT_INSIGHTS_PROMPT;

    const userPrompt = `Analyze the following text data from the research file "${fileName}".

Total entries: ${entries.length}
Mood distribution: ${JSON.stringify(moodDistribution)}

Text entries (numbered):
${sampleTexts}

Respond in the SAME LANGUAGE as the text entries (Spanish if Spanish, English if English).

In addition to the analysis above, return a JSON object with exactly this structure:
{
  "sentiment": {
    "summary": "One paragraph with the executive synthesis and key verdict",
    "description": "Two paragraphs with neurological analysis, behavioral patterns, and strategic strengths/weaknesses",
    "actionables": ["prioritized actionable 1", "prioritized actionable 2", "prioritized actionable 3"]
  },
  "themes": [
    { "name": "theme name", "entries": [1, 4, 7], "description": "Two sentences minimum: first explain the theme and its behavioral/neurological significance, then link it to concrete business impact at the shelf/purchase level", "magnitude": 0.89, "sentimentScore": 0.75 }
  ],
  "keywords": [
    { "word": "keyword", "entries": [2, 5], "sentiment": "positive|negative|neutral" }
  ]
}

Rules:
- 3-5 themes, sorted by relevance. magnitude is 0-1 (importance). sentimentScore is -1 to +1 (negative to positive). description: 2 sentences minimum — explain the theme significance then link to business impact. entries: the numbers of EVERY text entry that expresses this theme (an entry may belong to several themes).
- 8-12 keywords, sorted by frequency. entries: the numbers of EVERY text entry that uses this keyword in any form (plural, gender, tense or synonym spelling, e.g. "completada" counts for "completado").
- 3-5 actionables, specific, prioritized, and linked to business impact
- Be critical and honest. Do not soften negative results.
- Give more weight to what is NOT mentioned than what is mentioned (absences are very important).
- Return ONLY valid JSON, no markdown`;

    try {
        console.log(`[Insights] Calling OpenAI for file "${fileName}" with ${entries.length} entries...`);

        const response = await client.chat.completions.create({
            model: LLM_MODEL,
            max_tokens: 4000,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt + '\n\nAlways respond with valid JSON.' },
                { role: 'user', content: userPrompt },
            ],
        });

        const text = response.choices[0]?.message?.content || '';
        const parsed = attachEntryQuotes(JSON.parse(text) as LlmInsightsAnalysis, sample);

        console.log(`[Insights] Analysis complete: ${parsed.themes?.length || 0} themes, ${parsed.keywords?.length || 0} keywords`);
        return parsed;
    } catch (err) {
        console.error('[Insights] OpenAI API error:', err);
        return emptyAnalysis();
    }
};

const MAX_ANALYZED_ENTRIES = 200;

export const buildEntrySample = (entries: Array<{ text: string }>): string[] =>
    entries.slice(0, MAX_ANALYZED_ENTRIES).map(e => e.text);

type LlmEntryLinks = { entries?: unknown };
type LlmInsightsAnalysis = Omit<InsightsAnalysis, 'themes' | 'keywords'> & {
    themes: Array<Omit<InsightsAnalysis['themes'][number], 'count' | 'supportingQuotes'> & LlmEntryLinks>;
    keywords: Array<Omit<InsightsAnalysis['keywords'][number], 'count' | 'supportingQuotes'> & LlmEntryLinks>;
};

const quoteEntries = (entries: unknown, sample: string[]): string[] => {
    const lineNumbers = Array.isArray(entries) ? entries : [];
    return [...new Set(lineNumbers
        .filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= sample.length)
        .map(n => sample[n - 1]))];
};

const normalizeForMatch = (text: string): string =>
    text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const SPANISH_SUFFIXES = ['iendo', 'ando', 'ado', 'ada', 'ido', 'ida', 'ar', 'er', 'ir', 'es', 'os', 'as', 'o', 'a', 'e'];
const MIN_STEM_LENGTH = 4;

export const stemKeyword = (word: string): string => {
    const normalized = normalizeForMatch(word.trim());
    const suffix = SPANISH_SUFFIXES.find(ending => normalized.endsWith(ending) && normalized.length - ending.length >= MIN_STEM_LENGTH);
    return suffix ? normalized.slice(0, -suffix.length) : normalized;
};

const containsStem = (text: string, stem: string): boolean =>
    new RegExp(`(^|[^a-z0-9])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(normalizeForMatch(text));

type LlmKeyword = LlmInsightsAnalysis['keywords'][number];

const mergeKeywordsByStem = (keywords: LlmKeyword[], sample: string[]): InsightsAnalysis['keywords'] => {
    const groups = new Map<string, { keyword: Omit<LlmKeyword, 'entries'>; linked: Set<string> }>();
    for (const { entries, ...keyword } of keywords) {
        const stem = stemKeyword(keyword.word);
        if (!stem) continue;
        const group = groups.get(stem) ?? { keyword, linked: new Set<string>() };
        quoteEntries(entries, sample).forEach(text => group.linked.add(text));
        groups.set(stem, group);
    }
    return [...groups.entries()]
        .map(([stem, { keyword, linked }]) => {
            const supportingQuotes = [...new Set(sample.filter(text => linked.has(text) || containsStem(text, stem)))];
            return { ...keyword, count: supportingQuotes.length, supportingQuotes };
        })
        .filter(keyword => keyword.count > 0)
        .sort((first, second) => second.count - first.count);
};

export const attachEntryQuotes = (analysis: LlmInsightsAnalysis, sample: string[]): InsightsAnalysis => ({
    ...analysis,
    themes: (analysis.themes ?? []).map(({ entries, ...theme }) => {
        const supportingQuotes = quoteEntries(entries, sample);
        return { ...theme, count: supportingQuotes.length, supportingQuotes };
    }),
    keywords: mergeKeywordsByStem(analysis.keywords ?? [], sample),
});

const emptyAnalysis = (): InsightsAnalysis => ({
    sentiment: { summary: '', description: '', actionables: [] },
    themes: [],
    keywords: [],
});
