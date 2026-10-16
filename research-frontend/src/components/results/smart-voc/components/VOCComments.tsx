import { useState, useEffect, useCallback, useMemo } from 'react';
import { User, ClipboardList, Hash, Sparkles, Loader2, RefreshCw, X, Quote } from 'lucide-react';
import { Card } from '../../../ui/Card';
import { Badge } from '../../../ui/Badge';
import { cn } from '../../../../lib/utils';
import {
    getTextAnalysis,
    triggerTextAnalysis,
    type TextAnalysis,
} from '../../../../services/analytics.service';
import { participantsService, type Participant } from '../../../../services/participants.service';
import { smartVOCService, type SmartVOCResponse } from '../../../../services/smartVOC.service';
import { findThemeMentions } from '../../../../utils/themeMentions';

interface Comment {
  text: string;
  mood: string;
  selected?: boolean;
}

/** Row for CSV export when used from Cognitive Tasks (Long/Short Text) */
export interface CognitiveCommentRow {
  participantId: string;
  text: string;
  mood?: string;
}

interface VOCCommentsProps {
  comments?: Comment[];
  questionNumber?: string;
  questionText?: string;
  className?: string;
  /** When set, download uses these rows instead of SmartVOC API (Cognitive Tasks Long/Short Text) */
  researchId?: string;
  cognitiveExportRows?: CognitiveCommentRow[];
  /** Module ID for text analysis — pass "voc" for SmartVOC VOC, or the actual module UUID for Cognitive */
  moduleId?: string;
  /** When filters are active, pass participant IDs so "Refresh analysis" re-analyzes the filtered subset */
  filteredParticipantIds?: Set<string> | null;
}

export const VOCComments = ({
  comments = [],
  questionNumber = "2.6",
  questionText = "Voice of Customer (VOC)",
  className,
  researchId: researchIdProp,
  cognitiveExportRows,
  moduleId,
  filteredParticipantIds,
}: VOCCommentsProps) => {
  const [activeTab, setActiveTab] = useState<'sentiment' | 'themes' | 'keywords'>('sentiment');
  const [selectedComments, setSelectedComments] = useState<number[]>([]);
  const [analysis, setAnalysis] = useState<TextAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [selectedThemeIdx, setSelectedThemeIdx] = useState<number | null>(null);

  // Resolve researchId from prop or URL
  const researchId = researchIdProp ?? (() => {
    const urlParts = window.location.pathname.split('/');
    const idx = urlParts.indexOf('research');
    if (idx !== -1 && urlParts[idx + 1]) return urlParts[idx + 1];
    return urlParts.includes('results') ? urlParts[urlParts.indexOf('results') + 1] ?? '' : '';
  })();

  const themeMatches = useMemo(() => {
    if (!analysis?.themes.length || !comments.length) return new Map<number, Comment[]>();
    const map = new Map<number, Comment[]>();
    analysis.themes.forEach((theme, idx) => {
      map.set(idx, findThemeMentions(theme.supportingQuotes, comments));
    });
    return map;
  }, [analysis?.themes, comments]);

  // Load cached analysis on mount
  useEffect(() => {
    if (!researchId || !moduleId) return;
    let cancelled = false;
    (async () => {
      setLoadingAnalysis(true);
      try {
        const cached = await getTextAnalysis(researchId, moduleId);
        if (!cancelled && cached && (cached.themes.length > 0 || cached.keywords.length > 0)) {
          setAnalysis(cached);
        }
      } catch {
        // No cached analysis available
      } finally {
        if (!cancelled) setLoadingAnalysis(false);
      }
    })();
    return () => { cancelled = true; };
  }, [researchId, moduleId]);

  // Trigger analysis — uses selected comments if any, otherwise all (optionally filtered by participant IDs)
  const handleAnalyze = useCallback(async () => {
    if (!researchId || !moduleId || analyzing) return;
    setAnalyzing(true);
    try {
      const hasSelection = selectedComments.length > 0 && selectedComments.length < comments.length;
      const selectedTexts = hasSelection
        ? selectedComments.map(i => comments[i]).filter(Boolean).map(c => ({ text: c.text, mood: c.mood || '' }))
        : undefined;
      const pids = !selectedTexts && filteredParticipantIds ? Array.from(filteredParticipantIds) : undefined;
      await triggerTextAnalysis(researchId, moduleId, pids, selectedTexts);
      // Poll for completion (max 30s)
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const result = await getTextAnalysis(researchId, moduleId);
        if (result && (result.themes.length > 0 || result.keywords.length > 0)) {
          setAnalysis(result);
          break;
        }
      }
    } catch (err) {
      console.error('[VOCComments] Analysis failed:', err);
    } finally {
      setAnalyzing(false);
    }
  }, [researchId, moduleId, analyzing, filteredParticipantIds, selectedComments, comments]);

  const handleSelectAll = () => {
    if (selectedComments.length === comments.length) {
      setSelectedComments([]);
    } else {
      setSelectedComments(comments.map((_, i) => i));
    }
  };

  const handleSelectComment = (index: number) => {
    if (selectedComments.includes(index)) {
      setSelectedComments(selectedComments.filter(i => i !== index));
    } else {
      setSelectedComments([...selectedComments, index]);
    }
  };

  const triggerDownload = (csv: string, filename: string): void => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
  };

  const handleDownloadCSV = (): void => {
    // Cognitive Tasks path: build CSV from pre-computed rows (no network needed)
    if (cognitiveExportRows && cognitiveExportRows.length > 0) {
      const header = ['participant_id', 'comment', 'mood'];
      const rows = cognitiveExportRows.map(row => [
        String(row.participantId ?? ''),
        String(row.text ?? '').replace(/"/g, '""'),
        String(row.mood ?? '').replace(/"/g, '""'),
      ].map(v => `"${v}"`).join(','));
      const csv = [header.join(','), ...rows].join('\n');
      triggerDownload(csv, `comments-${researchId || 'export'}.csv`);
      return;
    }

    // SmartVOC path: fetch data from API then build CSV
    void downloadSmartVOCComments(researchId);
  };

  const downloadSmartVOCComments = async (rid: string): Promise<void> => {
    try {
      let participants: Participant[] = [];
      try {
        participants = await participantsService.list(rid);
      } catch (err) {
        console.error('Error fetching participants:', err);
      }

      let responses: SmartVOCResponse[] = [];
      try {
        responses = await smartVOCService.getResponses(rid);
      } catch (err) {
        console.error('Error fetching SmartVOC responses:', err);
      }

      const participantMap: Record<string, Participant> = {};
      participants.forEach(p => { participantMap[p.participant_id] = p; });

      const responsesMap: Record<string, SmartVOCResponse[]> = {};
      responses.forEach(r => {
        if (!responsesMap[r.participant_id]) responsesMap[r.participant_id] = [];
        responsesMap[r.participant_id].push(r);
      });

      const vocResponses = responses.filter(r => r.question_type === 'VOC' && typeof r.response_value?.text === 'string');
      const participantIdsWithComments = Array.from(new Set(vocResponses.map(r => r.participant_id)));
      if (participantIdsWithComments.length === 0) return;

      const header = ['participant_id', 'email', 'name', 'external_id', 'status', 'comment', 'mood', 'responses'];
      const rows = participantIdsWithComments.map(pid => {
        const p = participantMap[pid] || {};
        const voc = vocResponses.find(r => r.participant_id === pid);
        const comment = voc?.response_value?.text ? String(voc.response_value.text).replace(/"/g, '""') : '';
        const mood = voc?.response_value?.mood ? String(voc.response_value.mood) : '';
        const resp = responsesMap[pid] || [];
        const respStr = resp.map(r => `${r.question_key}: ${JSON.stringify(r.response_value)}`).join(' | ');
        return [
          pid,
          p.email ?? '',
          p.name ?? '',
          p.external_id ?? '',
          p.status ?? '',
          comment,
          mood,
          respStr.replace(/"/g, '""'),
        ].map(v => `"${v}"`).join(',');
      });
      const csv = [header.join(','), ...rows].join('\n');
      triggerDownload(csv, `voc-comments-${rid || 'export'}.csv`);
    } catch (err) {
      console.error('Error downloading SmartVOC comments:', err);
    }
  };

  // Whether AI analysis is available for this component
  const canAnalyze = Boolean(researchId && moduleId && comments.length > 0);
  const hasSelection = selectedComments.length > 0 && selectedComments.length < comments.length;
  const analyzeLabel = hasSelection ? `Analyze ${selectedComments.length} selected` : 'Analyze with AI';
  const refreshLabel = hasSelection ? `Re-analyze ${selectedComments.length} selected` : 'Refresh analysis';

  return (
    <Card className={cn('p-6 pb-24 space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-lg font-semibold">{questionNumber}- {questionText}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="green" shape="square" className="px-2 py-1">
              Short Text question
            </Badge>
            <Badge variant="blue" shape="square" className="px-2 py-1">
              Conditionality disabled
            </Badge>
            <Badge variant="red" shape="square" className="px-2 py-1">
              Required
            </Badge>
          </div>
        </div>
        <button
          className="text-xs px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={handleDownloadCSV}
        >
          Descargar comentarios (.csv)
        </button>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Comments Table */}
        <div className="border rounded-lg overflow-hidden max-h-[500px] overflow-y-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-3 text-left">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={selectedComments.length === comments.length && comments.length > 0}
                      onChange={handleSelectAll}
                    />
                    <span className="font-medium text-gray-600 text-sm">Comment</span>
                  </div>
                </th>
                <th className="p-3 text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-600 text-sm">Mood</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {comments.length > 0 ? (
                comments.map((comment, index) => (
                  <tr key={index} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300"
                          checked={selectedComments.includes(index)}
                          onChange={() => handleSelectComment(index)}
                        />
                        <span className="text-sm text-gray-700">{comment.text}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      {comment.mood && (
                        <span className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full',
                          comment.mood === 'positive' || comment.mood === 'Positive' || comment.mood === 'green'
                            ? 'bg-green-100 text-green-700'
                            : comment.mood === 'negative'
                            ? 'bg-red-100 text-red-700'
                            : comment.mood === 'neutral'
                            ? 'bg-gray-100 text-gray-600'
                            : 'bg-yellow-50 text-yellow-600'
                        )}>
                          {comment.mood === 'Positive' ? 'positive' : comment.mood === 'green' ? 'positive' : comment.mood}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="p-8 text-center text-gray-500 text-sm">
                    Text responses will appear here once participants answer open-ended questions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Right: Analysis Panel */}
        <div className="border rounded-lg overflow-hidden">
          {/* Tabs */}
          <div className="border-b flex">
            <button
              className={cn(
                'px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors',
                activeTab === 'sentiment'
                  ? 'text-blue-600 border-blue-600'
                  : 'text-gray-600 border-transparent hover:text-gray-900'
              )}
              onClick={() => setActiveTab('sentiment')}
            >
              <User className="w-4 h-4" />
              <span>Sentiment</span>
            </button>
            <button
              className={cn(
                'px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors',
                activeTab === 'themes'
                  ? 'text-blue-600 border-blue-600'
                  : 'text-gray-600 border-transparent hover:text-gray-900'
              )}
              onClick={() => setActiveTab('themes')}
            >
              <ClipboardList className="w-4 h-4" />
              <span>Themes</span>
            </button>
            <button
              className={cn(
                'px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors',
                activeTab === 'keywords'
                  ? 'text-blue-600 border-blue-600'
                  : 'text-gray-600 border-transparent hover:text-gray-900'
              )}
              onClick={() => setActiveTab('keywords')}
            >
              <Hash className="w-4 h-4" />
              <span>Keywords</span>
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-6 h-[380px] overflow-y-auto">
            {/* ── Sentiment Tab ── */}
            {activeTab === 'sentiment' && (() => {
              const positiveCount = comments.filter(c => c.mood === 'positive' || c.mood === 'Positive' || c.mood === 'green').length;
              const negativeCount = comments.filter(c => c.mood === 'negative').length;
              const neutralCount = comments.filter(c => c.mood === 'neutral').length;
              const indeterminateCount = comments.filter(c => !c.mood || c.mood === 'indeterminate' || c.mood === '').length;
              const total = comments.length;

              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-base font-semibold">Sentiment analysis</h4>
                    <div className="flex items-center gap-2">
                      {canAnalyze && !analyzing && !loadingAnalysis && !analysis && (
                        <button
                          onClick={handleAnalyze}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {analyzeLabel}
                        </button>
                      )}
                      {canAnalyze && !analyzing && !loadingAnalysis && analysis && (
                        <button
                          onClick={handleAnalyze}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          {refreshLabel}
                        </button>
                      )}
                      {analyzing && (
                        <span className="flex items-center gap-1.5 text-xs text-violet-600">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Analyzing...
                        </span>
                      )}
                    </div>
                  </div>

                  {/* LLM summary (if available) */}
                  {analysis?.sentiment?.summary && (
                    <div className="bg-violet-50 border border-violet-100 rounded-lg p-4 space-y-2">
                      <p className="text-sm text-violet-900 font-medium">{analysis.sentiment.summary}</p>
                      {analysis.sentiment.description && (
                        <p className="text-xs text-violet-700 leading-relaxed">{analysis.sentiment.description}</p>
                      )}
                      {analysis.sentiment.actionables.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {analysis.sentiment.actionables.map((a, i) => (
                            <li key={i} className="text-xs text-violet-700 flex items-start gap-1.5">
                              <span className="text-violet-400 mt-0.5">-</span>
                              {a}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {total > 0 ? (
                    <div className="space-y-5">
                      {[
                        { label: 'Positive', count: positiveCount, color: 'bg-green-500', textColor: 'text-green-700' },
                        { label: 'Negative', count: negativeCount, color: 'bg-red-500', textColor: 'text-red-700' },
                        { label: 'Neutral', count: neutralCount, color: 'bg-gray-400', textColor: 'text-gray-600' },
                        { label: 'Indeterminate', count: indeterminateCount, color: 'bg-yellow-400', textColor: 'text-yellow-700' },
                      ].map(({ label, count, color, textColor }) => (
                        <div key={label}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className={cn('font-medium', textColor)}>{label}</span>
                            <span className="text-gray-500">{count} ({total > 0 ? Math.round((count / total) * 100) : 0}%)</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div className={cn('h-2 rounded-full transition-all', color)} style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }} />
                          </div>
                        </div>
                      ))}
                      <div className="pt-3 border-t text-xs text-gray-400">
                        {total} responses analyzed
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-48">
                      <div className="text-center">
                        <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                          <User className="w-6 h-6 text-gray-400" />
                        </div>
                        <p className="text-sm text-gray-500">No responses to analyze</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Themes Tab ── */}
            {activeTab === 'themes' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-semibold">Themes</h4>
                  <div className="flex items-center gap-2">
                    {canAnalyze && !analyzing && !loadingAnalysis && !analysis && (
                      <button
                        onClick={handleAnalyze}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Analyze with AI
                      </button>
                    )}
                    {canAnalyze && !analyzing && !loadingAnalysis && analysis && (
                      <button
                        onClick={handleAnalyze}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh analysis
                      </button>
                    )}
                    {analyzing && (
                      <span className="flex items-center gap-1.5 text-xs text-violet-600">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Analyzing...
                      </span>
                    )}
                  </div>
                </div>

                {analysis && analysis.themes.length > 0 ? (
                  <div className="space-y-3">
                    {analysis.themes.map((theme, i) => {
                      const matched = themeMatches.get(i) ?? [];
                      const realCount = matched.length;
                      const pct = comments.length > 0 ? Math.round((realCount / comments.length) * 100) : 0;
                      return (
                        <div
                          key={i}
                          onClick={() => setSelectedThemeIdx(i)}
                          className="bg-gray-50 rounded-lg p-4 space-y-2 transition-colors cursor-pointer hover:bg-blue-50 hover:border-blue-200 border border-transparent"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900">{theme.name}</span>
                              {realCount > 0 && <Quote className="h-3.5 w-3.5 text-blue-400" />}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">{realCount} mentions ({pct}%)</span>
                              <span className={cn(
                                'text-xs font-medium px-2 py-0.5 rounded-full',
                                theme.sentimentScore > 0.2 ? 'bg-green-100 text-green-700' :
                                theme.sentimentScore < -0.2 ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-600'
                              )}>
                                {theme.sentimentScore > 0.2 ? 'positive' : theme.sentimentScore < -0.2 ? 'negative' : 'neutral'}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed">{theme.description}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 w-16">Relevance</span>
                            <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full bg-blue-500 transition-all"
                                style={{ width: `${Math.round(theme.magnitude * 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round(theme.magnitude * 100)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48">
                    <div className="text-center">
                      <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                        <ClipboardList className="w-6 h-6 text-gray-400" />
                      </div>
                      <p className="text-sm text-gray-500">
                        {loadingAnalysis ? 'Loading...' : 'No themes data available yet'}
                      </p>
                      {canAnalyze && !analysis && !analyzing && !loadingAnalysis && (
                        <button
                          onClick={handleAnalyze}
                          className="mt-3 flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors mx-auto"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {analyzeLabel}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Keywords Tab ── */}
            {activeTab === 'keywords' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-semibold">Keywords</h4>
                  <div className="flex items-center gap-2">
                    {canAnalyze && !analyzing && !loadingAnalysis && !analysis && (
                      <button
                        onClick={handleAnalyze}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Analyze with AI
                      </button>
                    )}
                    {canAnalyze && !analyzing && !loadingAnalysis && analysis && (
                      <button
                        onClick={handleAnalyze}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh analysis
                      </button>
                    )}
                    {analyzing && (
                      <span className="flex items-center gap-1.5 text-xs text-violet-600">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Analyzing...
                      </span>
                    )}
                  </div>
                </div>

                {analysis && analysis.keywords.length > 0 ? (
                  <div className="space-y-4">
                    {/* Tag cloud */}
                    <div className="flex flex-wrap gap-2">
                      {analysis.keywords.map((kw, i) => (
                        <span
                          key={i}
                          className={cn(
                            'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border',
                            kw.sentiment === 'positive' ? 'bg-green-50 text-green-700 border-green-200' :
                            kw.sentiment === 'negative' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-gray-50 text-gray-700 border-gray-200'
                          )}
                        >
                          {kw.word}
                          <span className="text-[10px] opacity-60">({kw.count}, {comments.length > 0 ? Math.round((kw.count / comments.length) * 100) : 0}%)</span>
                        </span>
                      ))}
                    </div>

                    {/* Frequency table */}
                    <div className="border rounded-lg overflow-hidden">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th className="p-2.5 text-left text-gray-600 font-medium">Keyword</th>
                            <th className="p-2.5 text-center text-gray-600 font-medium w-20">Count</th>
                            <th className="p-2.5 text-left text-gray-600 font-medium w-24">Sentiment</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {analysis.keywords.map((kw, i) => (
                            <tr key={i} className="border-b last:border-b-0">
                              <td className="p-2.5 text-gray-800">{kw.word}</td>
                              <td className="p-2.5 text-center text-gray-600">{kw.count} ({comments.length > 0 ? Math.round((kw.count / comments.length) * 100) : 0}%)</td>
                              <td className="p-2.5">
                                <span className={cn(
                                  'text-xs font-medium px-2 py-0.5 rounded-full',
                                  kw.sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                                  kw.sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                                  'bg-gray-100 text-gray-600'
                                )}>
                                  {kw.sentiment}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48">
                    <div className="text-center">
                      <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                        <Hash className="w-6 h-6 text-gray-400" />
                      </div>
                      <p className="text-sm text-gray-500">
                        {loadingAnalysis ? 'Loading...' : 'No keywords data available yet'}
                      </p>
                      {canAnalyze && !analysis && !analyzing && !loadingAnalysis && (
                        <button
                          onClick={handleAnalyze}
                          className="mt-3 flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors mx-auto"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {analyzeLabel}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Theme Verbatim Drawer */}
      {selectedThemeIdx !== null && analysis?.themes[selectedThemeIdx] && (
        <ThemeVerbatimDrawer
          theme={analysis.themes[selectedThemeIdx]}
          matchedComments={themeMatches.get(selectedThemeIdx) ?? []}
          totalComments={comments.length}
          onClose={() => setSelectedThemeIdx(null)}
        />
      )}
    </Card>
  );
};

// ─── Theme Verbatim Drawer ──────────────────────────────────────────

interface ThemeVerbatimDrawerProps {
  theme: { name: string; description: string; sentimentScore: number };
  matchedComments: Comment[];
  totalComments: number;
  onClose: () => void;
}

const ThemeVerbatimDrawer = ({ theme, matchedComments, totalComments, onClose }: ThemeVerbatimDrawerProps) => {
  const pct = totalComments > 0 ? Math.round((matchedComments.length / totalComments) * 100) : 0;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 w-[420px] max-w-[90vw] bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-800 truncate">{theme.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {matchedComments.length} mentions ({pct}%)
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn(
              'text-xs font-medium px-2 py-0.5 rounded-full',
              theme.sentimentScore > 0.2 ? 'bg-green-100 text-green-700' :
              theme.sentimentScore < -0.2 ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-600'
            )}>
              {theme.sentimentScore > 0.2 ? 'positive' : theme.sentimentScore < -0.2 ? 'negative' : 'neutral'}
            </span>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="h-4 w-4 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-gray-50 shrink-0">
          <p className="text-xs text-gray-600 leading-relaxed">{theme.description}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ maxHeight: '60vh' }}>
          <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Matching verbatims</h4>
          {matchedComments.length > 0 ? (
            matchedComments.map((comment, i) => (
              <div key={i} className="flex gap-3 items-start">
                <Quote className="h-4 w-4 text-blue-300 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 leading-relaxed italic">"{comment.text}"</p>
                  {comment.mood && (
                    <span className={cn(
                      'text-[10px] font-medium px-1.5 py-0.5 rounded mt-1 inline-block',
                      comment.mood === 'positive' ? 'bg-green-50 text-green-600' :
                      comment.mood === 'negative' ? 'bg-red-50 text-red-600' :
                      'bg-gray-50 text-gray-500'
                    )}>
                      {comment.mood}
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">
              No matching comments found for this theme.
            </p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.25s ease-out;
        }
      `}</style>
    </>
  );
};
