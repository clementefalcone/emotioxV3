import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, RotateCw, Settings2, ChevronDown, MessageSquareQuote, Download } from 'lucide-react';
import { Drawer } from '../ui/Drawer';
import { type Research, researchService } from '../../services/research.service';
import { researchKeys } from '../../hooks/useResearchQuery';
import { mediaService } from '../../services/media.service';
import { parseDocument, detectCsvColumns, type CsvColumnInfo } from '../../utils/documentParser';
import { CsvColumnSelector } from './CsvColumnSelector';
import { cn } from '../../lib/utils';
import { findThemeMentions } from '../../utils/themeMentions';

interface InsightsAnalysis {
    sentiment: { summary: string; description: string; actionables: string[] };
    themes: Array<{ name: string; count: number; description: string; supportingQuotes?: string[] }>;
    keywords: Array<{ word: string; count: number; sentiment: string }>;
}

interface FileItem {
    mediaId: string;
    name: string;
    entries?: Array<{ text: string; mood: string }>;
    analysis?: InsightsAnalysis;
    analyzedAt?: string;
    totalCount?: number;
    processedAt?: string;
}

interface InsightsFindingViewProps {
    research: Research;
    fileId: string;
}

const MOOD_COLORS: Record<string, string> = {
    positive: 'text-green-600 bg-green-50',
    negative: 'text-red-600 bg-red-50',
    neutral: 'text-gray-600 bg-gray-100',
    indeterminate: 'text-gray-400 bg-gray-50',
};

type TabId = 'sentiment' | 'themes' | 'keywords';

const SentimentScoreBadge = ({ score, entries, scoreColor, scoreBg }: { score: number; entries: Array<{ mood: string }>; scoreColor: string; scoreBg: string }) => {
    const tipRef = useRef<HTMLDivElement>(null);
    const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
    const showTip = () => {
        if (!tipRef.current) return;
        const rect = tipRef.current.getBoundingClientRect();
        setTipPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - 288) });
    };
    const hideTip = () => setTipPos(null);
    const posCount = entries.filter(e => e.mood === 'positive').length;
    const negCount = entries.filter(e => e.mood === 'negative').length;
    const neutCount = entries.length - posCount - negCount;
    return (
        <>
            <div
                ref={tipRef}
                className={cn('flex items-center gap-1 px-2 py-0.5 rounded border cursor-help', scoreBg)}
                onMouseEnter={showTip}
                onMouseLeave={hideTip}
            >
                <span className="text-[9px] font-medium text-gray-500 uppercase tracking-wide">Score</span>
                <span className={cn('text-sm font-bold', scoreColor)}>
                    {score > 0 ? '+' : ''}{score}
                </span>
            </div>
            {tipPos && createPortal(
                <div
                    className="fixed w-72 p-3 bg-gray-900 text-white text-[11px] leading-relaxed rounded-lg shadow-lg z-[9999] pointer-events-none"
                    style={{ top: tipPos.top, left: tipPos.left }}
                >
                    <p className="font-semibold mb-1">Formula</p>
                    <p className="font-mono text-[10px] mb-2">((positive - negative) / (positive + negative)) x 100</p>
                    <p className="mb-1">
                        <span className="text-green-400">Positive: {posCount}</span>
                        {' · '}
                        <span className="text-red-400">Negative: {negCount}</span>
                        {' · '}
                        <span className="text-gray-400">Neutral/Indet: {neutCount}</span>
                    </p>
                    <p className="text-gray-400">Range: -100 (all negative) to +100 (all positive). Neutral and indeterminate excluded.</p>
                </div>,
                document.body
            )}
        </>
    );
};

function computeSentimentScore(entries: Array<{ mood: string }>): number {
    const pos = entries.filter(e => e.mood === 'positive').length;
    const neg = entries.filter(e => e.mood === 'negative').length;
    const polarized = pos + neg;
    if (polarized === 0) return 0;
    return Math.round(((pos - neg) / polarized) * 100);
}

const DEFAULT_INSIGHTS_PROMPT = `Eres Emotio, Neuroeconomista especializado en Consumer Neuroscience y Neuromarketing aplicado a Branding y Packaging para categorías FMCG en Hispanoamérica (especialmente bebidas, alimentos y cuidado personal).

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

function generateInsightsReport(researchName: string, fileName: string, analysis: InsightsAnalysis, entries: Array<{ text: string; mood: string }>) {
    const moodCounts = entries.reduce((acc, e) => {
        acc[e.mood] = (acc[e.mood] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    const total = entries.length;
    const pct = (key: string) => total > 0 ? Math.round(((moodCounts[key] || 0) / total) * 100) : 0;
    const pPos = pct('positive');
    const pNeg = pct('negative');
    const pNeu = pct('neutral');
    const pInd = pct('indeterminate');

    const themes = analysis.themes || [];
    const keywords = analysis.keywords || [];
    const totalMentions = themes.reduce((s, t) => s + t.count, 0);
    const sentScore = computeSentimentScore(entries);
    const sentScoreColor = sentScore > 20 ? '#16a34a' : sentScore < -20 ? '#dc2626' : '#d97706';

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const html = `<!DOCTYPE html>
<html><head>
<title>${esc(researchName)} — Insights Report</title>
<style>
  @media print { @page { margin: 1.5cm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; line-height: 1.6; padding: 2rem; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.25rem; }
  h3 { font-size: 0.95rem; margin: 1rem 0 0.4rem; color: #475569; }
  .subtitle { color: #64748b; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .metrics { display: flex; gap: 1rem; margin: 1rem 0; flex-wrap: wrap; }
  .metric { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem 1rem; text-align: center; min-width: 90px; }
  .metric-value { font-size: 1.4rem; font-weight: 700; color: #0f172a; }
  .metric-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; }
  .overview { font-size: 0.9rem; color: #475569; margin: 0.75rem 0; }
  .sentiment-bar { display: flex; height: 24px; border-radius: 4px; overflow: hidden; margin: 0.5rem 0; }
  .sentiment-bar > div { display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 600; color: white; min-width: 30px; }
  .theme-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem; margin-bottom: 0.75rem; page-break-inside: avoid; }
  .theme-name { font-weight: 600; font-size: 0.9rem; color: #1e293b; }
  .theme-bar { height: 6px; background: #e2e8f0; border-radius: 3px; margin: 0.4rem 0; }
  .theme-bar-fill { height: 100%; background: #3b82f6; border-radius: 3px; }
  .theme-desc { font-size: 0.8rem; color: #64748b; }
  .theme-quote { font-size: 0.78rem; color: #64748b; font-style: italic; border-left: 2px solid #93c5fd; padding-left: 0.5rem; margin: 0.3rem 0; }
  .kw-list { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }
  .kw { display: inline-block; padding: 0.25rem 0.6rem; border-radius: 999px; font-size: 0.75rem; font-weight: 500; }
  .kw-pos { background: #dcfce7; color: #166534; }
  .kw-neg { background: #fee2e2; color: #991b1b; }
  .kw-neu { background: #f1f5f9; color: #475569; }
  .actionable { display: flex; gap: 0.5rem; margin: 0.4rem 0; align-items: flex-start; }
  .actionable-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; flex-shrink: 0; margin-top: 8px; }
  .actionable-text { font-size: 0.85rem; color: #475569; }
  .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 0.7rem; display: flex; justify-content: space-between; }
  .print-btn { position: fixed; top: 1rem; right: 1rem; padding: 0.5rem 1rem; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
  @media print { .print-btn { display: none; } }
</style>
</head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>

<h1>${esc(researchName)}</h1>
<p class="subtitle">Insights Finding Report — ${esc(fileName)} — ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

<div class="metrics">
  <div class="metric"><div class="metric-value">${total}</div><div class="metric-label">Entries</div></div>
  <div class="metric"><div class="metric-value">${themes.length}</div><div class="metric-label">Themes</div></div>
  <div class="metric"><div class="metric-value">${keywords.length}</div><div class="metric-label">Keywords</div></div>
  <div class="metric" style="border-color:${sentScoreColor}"><div class="metric-value" style="color:${sentScoreColor}">${sentScore > 0 ? '+' : ''}${sentScore}</div><div class="metric-label">Sentiment Score</div></div>
</div>

<h2>Sentiment Distribution</h2>
<div class="sentiment-bar">
  ${pPos > 0 ? `<div style="width:${pPos}%; background:#22c55e">${pPos}%</div>` : ''}
  ${pNeu > 0 ? `<div style="width:${pNeu}%; background:#94a3b8">${pNeu}%</div>` : ''}
  ${pInd > 0 ? `<div style="width:${pInd}%; background:#cbd5e1">${pInd}%</div>` : ''}
  ${pNeg > 0 ? `<div style="width:${pNeg}%; background:#ef4444">${pNeg}%</div>` : ''}
</div>
<p style="font-size:0.78rem; color:#64748b">Positive ${pPos}% · Neutral ${pNeu}% · Indeterminate ${pInd}% · Negative ${pNeg}%</p>

${analysis.sentiment ? `
<h2>Executive Synthesis</h2>
<p class="overview">${esc(analysis.sentiment.summary)}</p>
<p class="overview">${esc(analysis.sentiment.description)}</p>

${analysis.sentiment.actionables.length > 0 ? `
<h3>Actionable Recommendations</h3>
${analysis.sentiment.actionables.map(a => `<div class="actionable"><div class="actionable-dot"></div><div class="actionable-text">${esc(a)}</div></div>`).join('')}
` : ''}
` : ''}

${themes.length > 0 ? `
<h2>Themes</h2>
${themes.map(t => {
    const pctTheme = totalMentions > 0 ? Math.round((t.count / totalMentions) * 100) : 0;
    const quotes = (t.supportingQuotes || []).slice(0, 3);
    return `<div class="theme-card">
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <span class="theme-name">${esc(t.name)}</span>
    <span style="font-size:0.75rem; color:#3b82f6; font-weight:600;">${pctTheme}% · ${t.count} mentions</span>
  </div>
  <div class="theme-bar"><div class="theme-bar-fill" style="width:${pctTheme}%"></div></div>
  <p class="theme-desc">${esc(t.description)}</p>
  ${quotes.map(q => `<p class="theme-quote">"${esc(q)}"</p>`).join('')}
</div>`;
}).join('')}
` : ''}

${keywords.length > 0 ? `
<h2>Keywords</h2>
<div class="kw-list">
  ${keywords.map(k => {
    const cls = k.sentiment === 'positive' ? 'kw-pos' : k.sentiment === 'negative' ? 'kw-neg' : 'kw-neu';
    return `<span class="kw ${cls}">${esc(k.word)} (${k.count})</span>`;
  }).join('')}
</div>
` : ''}

<div class="footer">
  <span>EmotioCX — Insights Finding Report</span>
  <span>${new Date().toISOString().split('T')[0]}</span>
</div>
</body></html>`;

    const win = window.open('', '_blank');
    if (win) {
        win.document.write(html);
        win.document.close();
        win.focus();
        // Auto-trigger print after content loads
        win.onload = () => win.print();
    }
}

/**
 * View for Insights Finding — shows text entries with LLM-powered analysis.
 */
export const InsightsFindingView = ({ research, fileId }: InsightsFindingViewProps) => {
    const queryClient = useQueryClient();
    const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [activeTab, setActiveTab] = useState<TabId>('sentiment');
    const [expandedThemes, setExpandedThemes] = useState<Set<number>>(new Set());
    const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const triggeredRef = useRef<string | null>(null); // prevent re-trigger loop

    // Prompt editor state
    const [isPromptOpen, setIsPromptOpen] = useState(false);
    const [promptDraft, setPromptDraft] = useState('');
    const [isSavingPrompt, setIsSavingPrompt] = useState(false);

    const savedPrompt = useMemo(() => {
        const settings = research.settings as Record<string, unknown> | undefined;
        return (typeof settings?.insightsPrompt === 'string' ? settings.insightsPrompt : '') as string;
    }, [research.settings]);

    // Sync draft with saved value
    useEffect(() => {
        setPromptDraft(savedPrompt || DEFAULT_INSIGHTS_PROMPT);
    }, [savedPrompt]);

    const handleSavePrompt = useCallback(async () => {
        setIsSavingPrompt(true);
        try {
            const value = promptDraft.trim() === DEFAULT_INSIGHTS_PROMPT.trim() ? '' : promptDraft.trim();
            await researchService.update(research.id, {
                settings: { ...(research.settings as Record<string, unknown> || {}), insightsPrompt: value },
            });
            queryClient.invalidateQueries({ queryKey: researchKeys.detail(research.id) });
        } finally {
            setIsSavingPrompt(false);
        }
    }, [promptDraft, research.id, research.settings, queryClient]);

    const handleResetPrompt = useCallback(() => {
        setPromptDraft(DEFAULT_INSIGHTS_PROMPT);
    }, []);

    const isPromptModified = promptDraft.trim() !== (savedPrompt || DEFAULT_INSIGHTS_PROMPT).trim();

    const files = useMemo(() => {
        const settings = (research.settings as { stimuli?: FileItem[] }) || {};
        return settings.stimuli || [];
    }, [research.settings]);
    const [activeFileId, setActiveFileId] = useState(fileId);
    // Sync with sidebar selection
    useEffect(() => { setActiveFileId(fileId); }, [fileId]);
    const activeFile = files.find(f => f.mediaId === activeFileId) || files.find(f => f.mediaId === fileId) || files[0];
    const hasEntries = activeFile?.entries && activeFile.entries.length > 0;
    const hasAnalysis = !!activeFile?.analysis;

    // Auto-trigger analysis once when file has entries but no analysis
    useEffect(() => {
        if (activeFile && hasEntries && !hasAnalysis && !isAnalyzing && triggeredRef.current !== activeFile.mediaId) {
            triggeredRef.current = activeFile.mediaId;
            void triggerAnalysis(activeFile.mediaId);
        }
        return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
    }, [activeFile?.mediaId, hasEntries, hasAnalysis]); // eslint-disable-line react-hooks/exhaustive-deps

    const [analyzeElapsed, setAnalyzeElapsed] = useState(0);
    const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const triggerAnalysis = useCallback(async (mediaId: string) => {
        setIsAnalyzing(true);
        setAnalyzeElapsed(0);
        elapsedRef.current = setInterval(() => setAnalyzeElapsed(prev => prev + 1), 1000);
        try {
            await mediaService.analyzeInsights(research.id, mediaId);
            // Poll for completion
            pollingRef.current = setInterval(async () => {
                try {
                    const status = await mediaService.getInsightsStatus(research.id, mediaId);
                    if (status.status === 'complete') {
                        if (pollingRef.current) clearInterval(pollingRef.current);
                        pollingRef.current = null;
                        if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
                        setIsAnalyzing(false);
                        queryClient.invalidateQueries({ queryKey: researchKeys.detail(research.id) });
                    }
                } catch { /* keep polling */ }
            }, 3000);
        } catch (err) {
            console.error('[InsightsFinding] Analysis trigger failed:', err);
            if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
            setIsAnalyzing(false);
        }
    }, [research.id, queryClient]);

    const handleDelete = useCallback(async (mediaId: string) => {
        setIsDeletingId(mediaId);
        try {
            const updated = files.filter(f => f.mediaId !== mediaId);
            await researchService.update(research.id, {
                settings: { ...(research.settings as Record<string, unknown> || {}), stimuli: updated },
            });
            queryClient.invalidateQueries({ queryKey: researchKeys.detail(research.id) });
        } finally {
            setIsDeletingId(null);
        }
    }, [files, research.id, research.settings, queryClient]);

    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingCsvFile, setPendingCsvFile] = useState<{ file: File; columnInfo: CsvColumnInfo } | null>(null);

    const uploadSingleFile = useCallback(async (file: File, columnIndex?: number) => {
        const MAX_ENTRIES = 200;
        const MAX_TEXT_LENGTH = 500;
        const { mediaId } = await mediaService.uploadFile(research.id, file);
        const texts = await parseDocument(file, columnIndex);
        const totalCount = texts.length;
        const capped = texts.slice(0, MAX_ENTRIES);
        const entries = capped.map(text => ({
            text: text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text,
            mood: 'indeterminate',
        }));
        return { mediaId, name: file.name, entries, totalCount, processedAt: new Date().toISOString() } as FileItem;
    }, [research.id]);

    const handleFileUpload = useCallback(async (selectedFiles: FileList | null) => {
        if (!selectedFiles || selectedFiles.length === 0) return;
        setIsUploading(true);
        try {
            const newFiles: FileItem[] = [];
            for (const file of Array.from(selectedFiles)) {
                // Check if CSV/Excel has multiple columns
                const cols = await detectCsvColumns(file);
                if (cols) {
                    setPendingCsvFile({ file, columnInfo: cols });
                    setIsUploading(false);
                    return; // handle one at a time via selector
                }
                newFiles.push(await uploadSingleFile(file));
            }
            const existingIds = new Set(files.map(f => f.mediaId));
            const merged = [...files, ...newFiles.filter(f => !existingIds.has(f.mediaId))];
            await researchService.update(research.id, {
                settings: { ...(research.settings as Record<string, unknown> || {}), stimuli: merged },
            });
            queryClient.invalidateQueries({ queryKey: researchKeys.detail(research.id) });
        } catch (err) {
            console.error('[InsightsFinding] File upload failed:', err);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [files, research.id, research.settings, queryClient, uploadSingleFile]);

    const handleCsvColumnsSelected = useCallback(async (columnIndices: number[]) => {
        if (!pendingCsvFile) return;
        const { file, columnInfo } = pendingCsvFile;
        setIsUploading(true);
        setPendingCsvFile(null);
        try {
            // Upload file once, reuse mediaId as base
            const { mediaId: baseMediaId } = await mediaService.uploadFile(research.id, file);
            const MAX_ENTRIES = 200;
            const MAX_TEXT_LENGTH = 500;

            const newFiles: FileItem[] = [];
            for (const colIdx of columnIndices) {
                const colName = columnInfo.headers[colIdx] || `Column ${colIdx + 1}`;
                const texts = await parseDocument(file, colIdx);
                const totalCount = texts.length;
                const capped = texts.slice(0, MAX_ENTRIES);
                const entries = capped.map(text => ({
                    text: text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text,
                    mood: 'indeterminate',
                }));
                // Unique mediaId per column: base + column index suffix
                const mediaId = columnIndices.length === 1 ? baseMediaId : `${baseMediaId}__col${colIdx}`;
                newFiles.push({
                    mediaId,
                    name: `${file.name} — ${colName}`,
                    entries,
                    totalCount,
                    processedAt: new Date().toISOString(),
                } as FileItem);
            }
            const existingIds = new Set(files.map(f => f.mediaId));
            const merged = [...files, ...newFiles.filter(f => !existingIds.has(f.mediaId))];
            await researchService.update(research.id, {
                settings: { ...(research.settings as Record<string, unknown> || {}), stimuli: merged },
            });
            queryClient.invalidateQueries({ queryKey: researchKeys.detail(research.id) });
        } catch (err) {
            console.error('[InsightsFinding] CSV upload failed:', err);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [pendingCsvFile, files, research.id, research.settings, queryClient]);

    if (!activeFile) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <Upload className="w-10 h-10 mb-3 text-gray-300" />
                <p className="text-sm mb-3">No files uploaded yet.</p>
                <label className="cursor-pointer px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
                    Upload documents
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".csv,.txt,.xlsx,.xls,.docx,.pdf"
                        className="hidden"
                        onChange={e => void handleFileUpload(e.target.files)}
                    />
                </label>
                <p className="text-xs text-gray-400 mt-2">CSV, TXT, XLSX, DOCX, PDF</p>
            </div>
        );
    }

    const entries = activeFile.entries || [];
    const analysis = activeFile.analysis;

    return (
        <div className="space-y-4 p-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <h3 className="text-base font-semibold text-gray-900">Insights finding research</h3>
                <div className="flex items-center gap-2">
                    {hasAnalysis && (
                        <>
                            <button
                                type="button"
                                onClick={() => generateInsightsReport(research.name, activeFile.name, analysis!, entries)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors bg-gray-50 text-gray-600 hover:bg-gray-100"
                                title="Download PDF report"
                            >
                                <Download className="w-3.5 h-3.5" />
                                PDF
                            </button>
                            <button
                                type="button"
                                disabled={isAnalyzing}
                                onClick={() => void triggerAnalysis(activeFile.mediaId)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors bg-gray-50 text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Re-analyze with current prompt"
                            >
                                <RotateCw className={cn('w-3.5 h-3.5', isAnalyzing && 'animate-spin')} />
                                {isAnalyzing ? 'Analyzing...' : 'Re-analyze'}
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={() => setIsPromptOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors bg-gray-50 text-gray-600 hover:bg-gray-100"
                        title="Edit analysis prompt"
                    >
                        <Settings2 className="w-3.5 h-3.5" />
                        Prompt
                        {savedPrompt && (
                            <span className="text-[10px] px-1 py-0.5 bg-blue-50 text-blue-600 rounded font-medium leading-none">Custom</span>
                        )}
                    </button>
                    <label className={cn(
                        'cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                        isUploading ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                    )}>
                        <Upload className="w-3.5 h-3.5" />
                        {isUploading ? 'Uploading...' : 'Add files'}
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            accept=".csv,.txt,.xlsx,.xls,.docx,.pdf"
                            className="hidden"
                            disabled={isUploading}
                            onChange={e => void handleFileUpload(e.target.files)}
                        />
                    </label>
                    <button
                        type="button"
                        onClick={() => void handleDelete(activeFile.mediaId)}
                        disabled={isDeletingId === activeFile.mediaId}
                        className="p-1.5 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                        title="Remove file"
                    >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Analysis Prompt Drawer */}
            <Drawer
                isOpen={isPromptOpen}
                onClose={() => setIsPromptOpen(false)}
                title="Analysis Prompt"
                width="lg"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-500">
                        Customize the system prompt sent to the LLM for analysis. Changes apply to future analyses only.
                    </p>
                    <textarea
                        value={promptDraft}
                        onChange={e => setPromptDraft(e.target.value)}
                        rows={20}
                        className="w-full text-sm text-gray-700 border rounded-md p-3 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                    />
                    <div className="flex items-center justify-between pt-2">
                        <button
                            type="button"
                            onClick={handleResetPrompt}
                            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                        >
                            <RotateCw className="w-3.5 h-3.5" />
                            Reset to default
                        </button>
                        <button
                            type="button"
                            disabled={!isPromptModified || isSavingPrompt}
                            onClick={() => { void handleSavePrompt(); setIsPromptOpen(false); }}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {isSavingPrompt ? 'Saving...' : 'Save prompt'}
                        </button>
                    </div>
                </div>
            </Drawer>

            {pendingCsvFile && (
                <div className="border rounded-lg bg-white p-4">
                    <CsvColumnSelector
                        fileName={pendingCsvFile.file.name}
                        columnInfo={pendingCsvFile.columnInfo}
                        onSelect={(colIndices) => void handleCsvColumnsSelected(colIndices)}
                        onCancel={() => {
                            setPendingCsvFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                    />
                </div>
            )}

            {hasEntries ? (
                <div className="border rounded-lg bg-white overflow-hidden">
                    {/* Section title + column tabs */}
                    <div className="px-4 py-3 border-b flex items-center gap-3">
                        <h4 className="text-sm font-semibold text-gray-900 flex-shrink-0">Sentiment Analysis from text</h4>
                        {files.length > 1 && (
                            <div className="flex items-center gap-1">
                                {files.map((f, i) => {
                                    const isActive = f.mediaId === activeFile.mediaId;
                                    const label = f.name.includes(' — ') ? f.name.split(' — ')[1] : `${i + 1}`;
                                    return (
                                        <button
                                            key={f.mediaId}
                                            type="button"
                                            onClick={() => setActiveFileId(f.mediaId)}
                                            className={cn(
                                                'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                                                isActive
                                                    ? 'bg-blue-100 text-blue-700'
                                                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                                            )}
                                            title={f.name}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="flex divide-x min-h-[400px]">
                        {/* Left: Comments table */}
                        <div className="w-2/5 min-w-0 flex-shrink-0">
                            {/* Table header */}
                            <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 text-xs text-gray-500">
                                <span>Comment</span>
                                <span>Mood</span>
                            </div>
                            {/* Entries */}
                            <div className="max-h-[500px] overflow-y-auto divide-y">
                                {entries.map((entry, i) => (
                                    <div key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors">
                                        <span className="text-sm text-gray-700 truncate flex-1 min-w-0 mr-3">{entry.text}</span>
                                        <span className={cn(
                                            'text-xs font-medium px-2 py-0.5 rounded-full capitalize flex-shrink-0 ml-3',
                                            MOOD_COLORS[entry.mood] || MOOD_COLORS.indeterminate
                                        )}>
                                            {entry.mood}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Right: Analysis panel */}
                        <div className="flex-1 min-w-0">
                            {/* Tabs */}
                            <div className="flex items-center gap-1 px-4 py-2 border-b bg-gray-50">
                                {(['sentiment', 'themes', 'keywords'] as const).map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        className={cn(
                                            'px-3 py-1.5 text-xs font-medium rounded transition-colors capitalize',
                                            activeTab === tab
                                                ? 'bg-white text-blue-600 shadow-sm border'
                                                : 'text-gray-500 hover:text-gray-700'
                                        )}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>

                            <div className="p-4 overflow-y-auto max-h-[500px]">
                                {/* Sentiment tab */}
                                {activeTab === 'sentiment' && (() => {
                                    const score = computeSentimentScore(entries);
                                    const scoreColor = score > 20 ? 'text-green-600' : score < -20 ? 'text-red-600' : 'text-amber-600';
                                    const scoreBg = score > 20 ? 'bg-green-50 border-green-200' : score < -20 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200';
                                    return (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2">
                                            <h5 className="font-semibold text-sm text-gray-900">Sentiment analysis</h5>
                                            {isAnalyzing && (
                                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 rounded">
                                                    <svg className="animate-spin h-3 w-3 text-blue-600" fill="none" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                    </svg>
                                                    <span className="text-[10px] text-blue-700">Analyzing... {analyzeElapsed}s</span>
                                                </div>
                                            )}
                                            <div className="ml-auto">
                                                <SentimentScoreBadge score={score} entries={entries} scoreColor={scoreColor} scoreBg={scoreBg} />
                                            </div>
                                        </div>
                                        {analysis?.sentiment ? (
                                            <>
                                                <p className="text-sm text-gray-700 leading-relaxed">{analysis.sentiment.summary}</p>
                                                <p className="text-sm text-gray-600 leading-relaxed">{analysis.sentiment.description}</p>
                                                {analysis.sentiment.actionables.length > 0 && (
                                                    <div>
                                                        <h6 className="font-semibold text-sm text-gray-900 mb-1">Accionables:</h6>
                                                        <ul className="space-y-1">
                                                            {analysis.sentiment.actionables.map((a, i) => (
                                                                <li key={i} className="text-sm text-gray-600">{a}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </>
                                        ) : !isAnalyzing ? (
                                            <p className="text-sm text-gray-400">No analysis available yet.</p>
                                        ) : null}
                                    </div>
                                    );
                                })()}

                                {/* Themes tab */}
                                {activeTab === 'themes' && (() => {
                                    const themes = analysis?.themes || [];
                                    return (
                                        <div className="space-y-3">
                                            <h5 className="font-semibold text-sm text-gray-900">Themes</h5>
                                            {themes.length > 0 ? (
                                                themes.map((theme, i) => {
                                                    const matchingEntries = findThemeMentions(theme.supportingQuotes, entries);
                                                    const realCount = matchingEntries.length;
                                                    const isExpanded = expandedThemes.has(i);
                                                    return (
                                                        <div key={i} className="bg-gray-50 rounded-lg overflow-hidden">
                                                            <button
                                                                type="button"
                                                                onClick={() => setExpandedThemes(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(i)) next.delete(i); else next.add(i);
                                                                    return next;
                                                                })}
                                                                className="w-full text-left p-3 cursor-pointer hover:bg-gray-100 transition-colors"
                                                            >
                                                                <div className="flex items-center justify-between mb-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-sm font-medium text-gray-900">{theme.name}</span>
                                                                        <ChevronDown className={cn(
                                                                            'w-3.5 h-3.5 text-gray-400 transition-transform',
                                                                            isExpanded && 'rotate-180'
                                                                        )} />
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs font-semibold text-blue-600">{entries.length > 0 ? Math.round((realCount / entries.length) * 100) : 0}%</span>
                                                                        <span className="text-xs text-gray-500">{realCount} mentions</span>
                                                                    </div>
                                                                </div>
                                                                {/* Percentage bar */}
                                                                <div className="w-full h-1.5 bg-gray-200 rounded-full mb-2">
                                                                    <div
                                                                        className="h-full bg-blue-500 rounded-full transition-all"
                                                                        style={{ width: `${entries.length > 0 ? Math.round((realCount / entries.length) * 100) : 0}%` }}
                                                                    />
                                                                </div>
                                                                <p className="text-xs text-gray-600">{theme.description}</p>
                                                            </button>
                                                            {/* Matching entries — smooth accordion via grid-rows */}
                                                            <div
                                                                className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                                                                style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                                                            >
                                                                <div className="overflow-hidden">
                                                                    <div className="px-3 pb-3 border-t border-gray-200 pt-2">
                                                                        <div className="flex items-center justify-between mb-2">
                                                                            <div className="flex items-center gap-1.5">
                                                                                <MessageSquareQuote className="w-3 h-3 text-gray-400" />
                                                                                <span className="text-[11px] font-medium text-gray-500">Matching entries</span>
                                                                            </div>
                                                                            <span className="text-[10px] text-gray-400">{realCount} results</span>
                                                                        </div>
                                                                        <div className="max-h-[240px] overflow-y-auto space-y-1">
                                                                            {matchingEntries.map((entry, qi) => (
                                                                                <div key={qi} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white transition-colors">
                                                                                    <p className="text-xs text-gray-600 italic flex-1 min-w-0 mr-3">"{entry.text}"</p>
                                                                                    <span className={cn(
                                                                                        'text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize flex-shrink-0',
                                                                                        MOOD_COLORS[entry.mood] || MOOD_COLORS.indeterminate
                                                                                    )}>
                                                                                        {entry.mood}
                                                                                    </span>
                                                                                </div>
                                                                            ))}
                                                                            {realCount === 0 && (
                                                                                <p className="text-xs text-gray-400 italic">No matching entries found</p>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            ) : !isAnalyzing ? (
                                                <p className="text-sm text-gray-400">No themes data available yet.</p>
                                            ) : null}
                                        </div>
                                    );
                                })()}

                                {/* Keywords tab */}
                                {activeTab === 'keywords' && (() => {
                                    const kwList = analysis?.keywords || [];
                                    const normalize = (s: string) => {
                                        // Repair common UTF-8→Latin-1 mojibake (Spanish)
                                        const repaired = s
                                            .replace(/Ã¡/g, 'á').replace(/Ã©/g, 'é').replace(/Ã­/g, 'í')
                                            .replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú').replace(/Ã±/g, 'ñ')
                                            .replace(/Ã¼/g, 'ü').replace(/Ã'/g, 'Ñ');
                                        return repaired.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                                    };
                                    const needle = selectedKeyword ? normalize(selectedKeyword) : '';
                                    const matchingEntries = selectedKeyword
                                        ? entries.filter(e => normalize(e.text).includes(needle))
                                        : [];
                                    return (
                                        <div className="space-y-3">
                                            <h5 className="font-semibold text-sm text-gray-900">Keywords</h5>
                                            {kwList.length > 0 ? (
                                                <>
                                                    <div className="flex flex-wrap gap-2">
                                                        {kwList.map((kw, i) => {
                                                            const isActive = selectedKeyword === kw.word;
                                                            const realCount = entries.filter(e => normalize(e.text).includes(normalize(kw.word))).length;
                                                            const pctKw = entries.length > 0 ? Math.round((realCount / entries.length) * 100) : 0;
                                                            return (
                                                                <button
                                                                    key={i}
                                                                    type="button"
                                                                    onClick={() => setSelectedKeyword(isActive ? null : kw.word)}
                                                                    className={cn(
                                                                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                                                                        isActive
                                                                            ? 'ring-2 ring-blue-400 ring-offset-1'
                                                                            : '',
                                                                        kw.sentiment === 'positive' ? 'bg-green-50 text-green-700 hover:bg-green-100' :
                                                                        kw.sentiment === 'negative' ? 'bg-red-50 text-red-700 hover:bg-red-100' :
                                                                        'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                                    )}
                                                                >
                                                                    {kw.word}
                                                                    <span className="text-[10px] opacity-60">({realCount} · {pctKw}%)</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    {/* Matching comments table */}
                                                    <div
                                                        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                                                        style={{ gridTemplateRows: selectedKeyword ? '1fr' : '0fr' }}
                                                    >
                                                        <div className="overflow-hidden">
                                                            {matchingEntries.length > 0 && (
                                                                <div className="border rounded-lg mt-1">
                                                                    <div className="px-3 py-2 bg-gray-50 border-b text-xs text-gray-500 flex items-center justify-between">
                                                                        <span>Comments containing "<span className="font-medium text-gray-700">{selectedKeyword}</span>"</span>
                                                                        <span>{matchingEntries.length} results</span>
                                                                    </div>
                                                                    <div className="max-h-[240px] overflow-y-auto divide-y">
                                                                        {matchingEntries.map((entry, ei) => (
                                                                            <div key={ei} className="flex items-center justify-between px-3 py-2">
                                                                                <span className="text-xs text-gray-700 flex-1 min-w-0 mr-3">{entry.text}</span>
                                                                                <span className={cn(
                                                                                    'text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize flex-shrink-0',
                                                                                    MOOD_COLORS[entry.mood] || MOOD_COLORS.indeterminate
                                                                                )}>
                                                                                    {entry.mood}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </>
                                            ) : !isAnalyzing ? (
                                                <p className="text-sm text-gray-400">No keywords data available yet.</p>
                                            ) : null}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="p-8 text-center text-gray-400 border-2 border-dashed rounded-lg">
                    <p className="text-sm">No text entries found in this file.</p>
                </div>
            )}
        </div>
    );
};
