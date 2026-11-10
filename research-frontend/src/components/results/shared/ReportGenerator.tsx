import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Download } from 'lucide-react';
import apiClient from '../../../services/api/client';
import { useResearch } from '../../../hooks/useResearchQuery';

interface ExecutiveSummary {
    generatedAt: string;
    overview: string;
    keyFindings: string[];
    recommendations: string[];
    metrics: {
        participantCount: number;
        responseCount: number;
        nps?: number;
        csat?: number;
        ces?: number;
    };
    sentiment?: {
        positive: number;
        negative: number;
        neutral: number;
    };
}

function openPrintableReport(research: { name: string; status: string }, summary: ExecutiveSummary) {
    const sentTotal = (summary.sentiment?.positive || 0) + (summary.sentiment?.negative || 0) + (summary.sentiment?.neutral || 0);
    const pctPos = sentTotal > 0 ? Math.round(((summary.sentiment?.positive || 0) / sentTotal) * 100) : 0;
    const pctNeg = sentTotal > 0 ? Math.round(((summary.sentiment?.negative || 0) / sentTotal) * 100) : 0;
    const pctNeu = sentTotal > 0 ? Math.round(((summary.sentiment?.neutral || 0) / sentTotal) * 100) : 0;

    const html = `<!DOCTYPE html>
<html><head>
<title>${research.name} — Research Report</title>
<style>
  @media print { @page { margin: 1.5cm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; line-height: 1.6; padding: 2rem; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.25rem; }
  .subtitle { color: #64748b; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .metrics { display: flex; gap: 1rem; margin: 1rem 0; flex-wrap: wrap; }
  .metric { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem 1rem; text-align: center; min-width: 100px; }
  .metric-value { font-size: 1.5rem; font-weight: 700; color: #0f172a; }
  .metric-label { font-size: 0.75rem; color: #64748b; }
  .overview { font-size: 0.95rem; color: #475569; margin: 1rem 0; }
  .finding { display: flex; gap: 0.75rem; margin: 0.5rem 0; align-items: flex-start; }
  .finding-num { width: 24px; height: 24px; border-radius: 50%; background: #dbeafe; color: #2563eb; font-size: 0.75rem; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .finding-text { font-size: 0.9rem; color: #475569; }
  .rec { display: flex; gap: 0.5rem; margin: 0.5rem 0; align-items: flex-start; }
  .rec-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; flex-shrink: 0; margin-top: 8px; }
  .rec-text { font-size: 0.9rem; color: #475569; }
  .sentiment-bar { display: flex; height: 24px; border-radius: 4px; overflow: hidden; margin: 0.5rem 0; }
  .sentiment-bar > div { display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 600; color: white; }
  .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 0.75rem; display: flex; justify-content: space-between; }
  .print-btn { position: fixed; top: 1rem; right: 1rem; padding: 0.5rem 1rem; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
  @media print { .print-btn { display: none; } }
</style>
</head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>

<h1>${research.name}</h1>
<p class="subtitle">Research Report — Generated ${new Date(summary.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

<div class="metrics">
  <div class="metric"><div class="metric-value">${summary.metrics.participantCount}</div><div class="metric-label">Participants</div></div>
  <div class="metric"><div class="metric-value">${summary.metrics.responseCount}</div><div class="metric-label">Responses</div></div>
  ${summary.metrics.nps !== undefined ? `<div class="metric"><div class="metric-value">${summary.metrics.nps}</div><div class="metric-label">NPS</div></div>` : ''}
  ${summary.metrics.csat !== undefined ? `<div class="metric"><div class="metric-value">${summary.metrics.csat}</div><div class="metric-label">CSAT</div></div>` : ''}
  ${summary.metrics.ces !== undefined ? `<div class="metric"><div class="metric-value">${summary.metrics.ces}</div><div class="metric-label">CES</div></div>` : ''}
</div>

<h2>Overview</h2>
<p class="overview">${summary.overview}</p>

${summary.keyFindings.length > 0 ? `
<h2>Key Findings</h2>
${summary.keyFindings.map((f, i) => `<div class="finding"><div class="finding-num">${i + 1}</div><div class="finding-text">${f}</div></div>`).join('')}
` : ''}

${summary.recommendations.length > 0 ? `
<h2>Recommendations</h2>
${summary.recommendations.map(r => `<div class="rec"><div class="rec-dot"></div><div class="rec-text">${r}</div></div>`).join('')}
` : ''}

${sentTotal > 0 ? `
<h2>Sentiment Distribution</h2>
<div class="sentiment-bar">
  <div style="width:${pctPos}%; background:#22c55e">${pctPos}%</div>
  <div style="width:${pctNeu}%; background:#94a3b8">${pctNeu}%</div>
  <div style="width:${pctNeg}%; background:#ef4444">${pctNeg}%</div>
</div>
<p style="font-size:0.8rem; color:#64748b">Positive ${pctPos}% · Neutral ${pctNeu}% · Negative ${pctNeg}%</p>
` : ''}

<div class="footer">
  <span>EmotioCX Research Report</span>
  <span>${new Date().toISOString().split('T')[0]}</span>
</div>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
}

export const ReportGeneratorButton = ({ researchId, filteredParticipantIds }: { researchId: string; filteredParticipantIds?: string[] }) => {
    const { data: research } = useResearch(researchId);
    const [generating, setGenerating] = useState(false);

    const { data: summary } = useQuery({
        queryKey: ['executive-summary', researchId],
        queryFn: async () => {
            const res = await apiClient.get<{ summary: ExecutiveSummary | null }>(
                `/analytics/research/${researchId}/executive-summary`
            );
            return res.summary;
        },
        staleTime: 60_000,
    });

    const handleGenerate = useCallback(async () => {
        setGenerating(true);
        try {
            let reportData = summary;

            if (!reportData) {
                const body: Record<string, unknown> = {};
                if (filteredParticipantIds && filteredParticipantIds.length > 0) {
                    body.participantIds = filteredParticipantIds;
                }
                const res = await apiClient.post<{ summary: ExecutiveSummary }>(
                    `/analytics/research/${researchId}/executive-summary`,
                    body
                );
                reportData = res.summary;
            }

            if (reportData && research) {
                openPrintableReport(
                    { name: research.name, status: research.status },
                    reportData
                );
            }
        } catch (error) {
            console.error('Report generation failed:', error);
        } finally {
            setGenerating(false);
        }
    }, [summary, research, researchId, filteredParticipantIds]);

    return (
        <button
            onClick={handleGenerate}
            disabled={generating}
            title="PDF"
            aria-label="PDF"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
            {generating ? (
                <>
                    <FileText className="h-3.5 w-3.5 animate-pulse" />
                    <span className="hidden 2xl:inline">...</span>
                </>
            ) : (
                <>
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden 2xl:inline">PDF</span>
                </>
            )}
        </button>
    );
};
