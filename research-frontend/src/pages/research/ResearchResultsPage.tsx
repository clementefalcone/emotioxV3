import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { BarChart3, Brain, Eye, Filter, Zap, Download, SmilePlus, Activity, Heart, Presentation, Sparkles } from 'lucide-react';
import { SmartVOCResults } from '../../components/results/smart-voc/SmartVOCResults';
import { CognitiveTaskResults } from '../../components/results/cognitive-task/CognitiveTaskResults';
import { ScreenerResults } from '../../components/results/screener/ScreenerResults';
import { ImplicitAssociationResults } from '../../components/results/implicit-association/ImplicitAssociationResults';
import { EyeTrackingResults } from '../../components/results/eye-tracking/EyeTrackingResults';
import { WebsiteTrackingResults } from '../../components/results/website-tracking/WebsiteTrackingResults';
import { EmotionAnalysisResults } from '../../components/results/emotion-analysis/EmotionAnalysisResults';
import { useResearch } from '../../hooks/useResearchQuery';
import {
    getCognitiveTaskResults,
    getImplicitAssociationResults,
} from '../../services/analytics.service';
import { downloadResearchExport } from '../../services/export.service';
import { generateResultsPptx } from '../../services/pptx-export.service';
import { smartVOCService } from '../../services/smartVOC.service';
import { ExecutiveSummaryPanel } from '../../components/results/shared/ExecutiveSummaryPanel';
import { AlertsBar } from '../../components/results/shared/AlertsBar';
import { ReportGeneratorButton } from '../../components/results/shared/ReportGenerator';
import { BlockchainCertification } from '../../components/results/shared/BlockchainCertification';
import { ShareResultsButton } from '../../components/results/shared/ShareResultsButton';
import { useResultsFilter } from '../../hooks/useResultsFilter';
import { useToast } from '../../hooks/useToast';
import apiClient from '../../services/api/client';

type StageType = 'screener' | 'smart-voc' | 'cognitive-task' | 'implicit-association' | 'eye-tracking' | 'emotion-analysis' | 'eeg' | 'wearable';

interface DynamicTab {
    key: string;
    stageType: StageType;
    label: string;
    icon: React.ReactNode;
    stageId: string;
}

const STAGE_TYPE_MAP: Array<{ type: StageType; label: string; icon: React.ReactNode; detector: (name: string) => boolean }> = [
    { type: 'screener', label: 'Screener', icon: <Filter className="h-5 w-5" />, detector: (n) => n.toLowerCase() === 'screener' },
    { type: 'smart-voc', label: 'SmartVOC', icon: <BarChart3 className="h-5 w-5" />, detector: (n) => { const l = n.toLowerCase(); return l.includes('smart voc') || l === 'smart voc'; } },
    { type: 'cognitive-task', label: 'Cognitive Tasks', icon: <Brain className="h-5 w-5" />, detector: (n) => { const l = n.toLowerCase(); return l.includes('cognitive task') || l === 'cognitive tasks'; } },
    { type: 'implicit-association', label: 'IAT', icon: <Zap className="h-5 w-5" />, detector: (n) => n.toLowerCase() === 'implicit association' },
    { type: 'eye-tracking', label: 'Eye Tracking', icon: <Eye className="h-5 w-5" />, detector: (n) => n.toLowerCase() === 'eye tracking' },
    { type: 'emotion-analysis', label: 'Emotion Analysis', icon: <SmilePlus className="h-5 w-5" />, detector: (n) => n.toLowerCase().includes('emotion analysis') },
    { type: 'eeg', label: 'EEG', icon: <Activity className="h-5 w-5" />, detector: (n) => n.toLowerCase().includes('eeg') },
    { type: 'wearable', label: 'Wearable', icon: <Heart className="h-5 w-5" />, detector: (n) => n.toLowerCase().includes('biometric wearable') },
];

const SKIP_STAGES = new Set(['welcome screen', 'thank you screen', 'research configuration']);

function buildDynamicTabs(stages: Array<{ id: string; name: string }>): DynamicTab[] {
    const tabs: DynamicTab[] = [];
    const countByType: Record<string, number> = {};

    for (const stage of stages) {
        if (SKIP_STAGES.has(stage.name.toLowerCase())) continue;
        const match = STAGE_TYPE_MAP.find(s => s.detector(stage.name));
        if (!match) continue;
        countByType[match.type] = (countByType[match.type] ?? 0) + 1;
        const idx = countByType[match.type];
        tabs.push({
            key: `${match.type}-${stage.id}`,
            stageType: match.type,
            label: idx > 1 ? `${match.label} ${idx}` : match.label,
            icon: match.icon,
            stageId: stage.id,
        });
    }
    return tabs;
}

/**
 * Research Results Page
 * Hub for all results - Screener, SmartVOC, and Cognitive Tasks
 */
export const ResearchResultsPage = () => {
    const { id } = useParams<{ id: string }>();
    const { data: research } = useResearch(id || null);
    const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
    const [tabInitialized, setTabInitialized] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportingPptx, setExportingPptx] = useState(false);
    const [summaryOpen, setSummaryOpen] = useState(false);
    const toast = useToast();

    // Read completionMin + filtered participant IDs from shared filter hook
    const { filteredParticipantIds } = useResultsFilter(id || '');
    const filteredPidsArray = useMemo(
        () => filteredParticipantIds ? Array.from(filteredParticipantIds) : undefined,
        [filteredParticipantIds]
    );

    const handleExport = useCallback(async () => {
        if (!id || exporting) return;
        setExporting(true);
        try {
            await downloadResearchExport(id, research?.name || 'research', filteredPidsArray);
        } catch (error) {
            console.error('Export failed:', error);
        } finally {
            setExporting(false);
        }
    }, [id, exporting, research?.name, filteredPidsArray]);

    const handleExportPptx = useCallback(async () => {
        if (!id || exportingPptx) return;
        setExportingPptx(true);
        try {
            const [smartvoc, cognitive, summaryRes, iat] = await Promise.all([
                smartVOCService.getAnalytics(id).catch(() => null),
                getCognitiveTaskResults(id).catch(() => null),
                apiClient.get<{ summary: { overview: string; keyFindings: string[]; recommendations: string[] } | null }>(
                    `/analytics/research/${id}/executive-summary`
                ).catch(() => null),
                getImplicitAssociationResults(id).catch(() => null),
            ]);

            const hasSmartVOC = !!smartvoc;
            const hasCognitive = cognitive && cognitive.modules.length > 0;
            const hasIAT = iat && iat.modules.length > 0;
            if (!hasSmartVOC && !hasCognitive && !hasIAT) {
                toast.warning('No hay datos de resultados para exportar');
                return;
            }

            await generateResultsPptx({
                researchName: research?.name || 'Research',
                researchId: id,
                smartvoc,
                cognitive,
                executiveSummary: summaryRes?.summary ?? null,
                iat: hasIAT ? iat : null,
            });
        } catch {
            toast.error('Error al exportar presentación');
        } finally {
            setExportingPptx(false);
        }
    }, [id, exportingPptx, research?.name, toast]);

    const dynamicTabs = useMemo(() => {
        if (!research?.stages) return [];
        return buildDynamicTabs(research.stages as Array<{ id: string; name: string }>);
    }, [research?.stages]);

    useEffect(() => {
        if (tabInitialized || dynamicTabs.length === 0) return;
        setActiveTabKey(dynamicTabs[0].key);
        setTabInitialized(true);
    }, [dynamicTabs, tabInitialized]);

    const activeTab = dynamicTabs.find(t => t.key === activeTabKey) ?? null;

    const isWebsiteTracking = research?.research_type_name === 'Website Tracking';

    if (!id) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="text-center">
                    <p className="text-lg font-medium text-gray-900 mb-2">Research ID not found</p>
                    <p className="text-sm text-gray-500">Unable to load results without a research ID.</p>
                </div>
            </div>
        );
    }

    // Website Tracking has its own results layout (no stage-based tabs)
    if (isWebsiteTracking) {
        return (
            <div className="p-6 space-y-6 h-full overflow-y-auto">
                <WebsiteTrackingResults researchId={id} />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Top bar: Tabs + Export — fixed height */}
            <div className="shrink-0 px-6 pt-4 pb-0 border-b border-gray-200 flex items-center justify-between">
                <nav className="flex gap-1 overflow-x-auto">
                    {dynamicTabs.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTabKey(tab.key)}
                            className={`
                                flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors whitespace-nowrap
                                ${
                                    activeTabKey === tab.key
                                        ? 'border-blue-600 text-blue-600 font-medium'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }
                            `}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </nav>
                <div className="flex items-center gap-2 pb-1">
                    <button
                        onClick={handleExport}
                        disabled={exporting}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                        <Download className="h-3.5 w-3.5" />
                        {exporting ? '...' : 'Export CSV'}
                    </button>
                    <button
                        onClick={handleExportPptx}
                        disabled={exportingPptx}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                        <Presentation className="h-3.5 w-3.5" />
                        {exportingPptx ? '...' : 'Slides'}
                    </button>
                    <ReportGeneratorButton researchId={id} filteredParticipantIds={filteredPidsArray} />
                    <div className="w-px h-5 bg-gray-200" />
                    <button
                        onClick={() => setSummaryOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                        <Sparkles className="h-3.5 w-3.5" />
                        Summary
                    </button>
                    {research && <ShareResultsButton research={research} />}
                    <AlertsBar researchId={id} />
                    <BlockchainCertification researchId={id} />
                </div>
            </div>

            {/* Studio body — fills remaining height, internal scroll */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
                    {!activeTab ? (
                        <div className="space-y-6 animate-pulse">
                            <div className="h-8 bg-gray-200 rounded w-48" />
                            <div className="h-64 bg-gray-200 rounded-xl" />
                            <div className="h-48 bg-gray-200 rounded-xl" />
                        </div>
                    ) : (
                        <>
                            {activeTab.stageType === 'screener' && <ScreenerResults researchId={id} />}
                            {activeTab.stageType === 'smart-voc' && <SmartVOCResults researchId={id} />}
                            {activeTab.stageType === 'cognitive-task' && <CognitiveTaskResults researchId={id} stageId={activeTab.stageId} />}
                            {activeTab.stageType === 'implicit-association' && <ImplicitAssociationResults researchId={id} stageId={activeTab.stageId} />}
                            {activeTab.stageType === 'eye-tracking' && <EyeTrackingResults researchId={id} stageId={activeTab.stageId} />}
                            {activeTab.stageType === 'emotion-analysis' && <EmotionAnalysisResults researchId={id} />}
                            {activeTab.stageType === 'eeg' && (
                                <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center">
                                    <Activity className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                                    <p className="text-gray-500">EEG recording results will appear here when participants complete sessions with connected EEG devices.</p>
                                </div>
                            )}
                            {activeTab.stageType === 'wearable' && (
                                <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center">
                                    <Heart className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                                    <p className="text-gray-500">Heart rate and HRV results will appear here when participants complete sessions with connected wearables.</p>
                                </div>
                            )}
                        </>
                    )}
            </div>

            {/* Executive Summary Drawer */}
            {summaryOpen && (
                <ExecutiveSummaryDrawer
                    researchId={id}
                    filteredParticipantIds={filteredPidsArray}
                    onClose={() => setSummaryOpen(false)}
                />
            )}
        </div>
    );
};

const ExecutiveSummaryDrawer = ({ researchId, filteredParticipantIds, onClose }: {
    researchId: string;
    filteredParticipantIds?: string[];
    onClose: () => void;
}) => (
    <>
        <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
        <div className="fixed inset-y-0 right-0 w-[520px] max-w-[90vw] bg-white shadow-2xl z-50 flex flex-col"
            style={{ animation: 'slideInRight 0.25s ease-out' }}>
            <div className="shrink-0 px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-blue-500" />
                    <h2 className="text-sm font-semibold text-gray-900">Executive Summary</h2>
                </div>
                <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div className="flex-1 overflow-y-auto">
                <ExecutiveSummaryPanel researchId={researchId} filteredParticipantIds={filteredParticipantIds} />
            </div>
        </div>
        <style>{`
            @keyframes slideInRight {
                from { transform: translateX(100%); }
                to { transform: translateX(0); }
            }
        `}</style>
    </>
);
