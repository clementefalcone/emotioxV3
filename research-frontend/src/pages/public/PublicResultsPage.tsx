import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { BarChart3, Brain, Eye, Filter, Zap, SmilePlus } from 'lucide-react';
import { SmartVOCResults } from '../../components/results/smart-voc/SmartVOCResults';
import { CognitiveTaskResults } from '../../components/results/cognitive-task/CognitiveTaskResults';
import { ScreenerResults } from '../../components/results/screener/ScreenerResults';
import { ImplicitAssociationResults } from '../../components/results/implicit-association/ImplicitAssociationResults';
import { EyeTrackingResults } from '../../components/results/eye-tracking/EyeTrackingResults';
import { EmotionAnalysisResults } from '../../components/results/emotion-analysis/EmotionAnalysisResults';
import { configService } from '../../services/api/config.service';
import apiClient from '../../services/api/client';

type TabId = 'screener' | 'smart-voc' | 'cognitive-task' | 'implicit-association' | 'eye-tracking' | 'emotion-analysis';

interface TabDef {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    stageDetector: (name: string) => boolean;
}

const TAB_DEFS: TabDef[] = [
    { id: 'screener', label: 'Screener', icon: <Filter className="h-5 w-5" />, stageDetector: (n) => n.toLowerCase() === 'screener' },
    { id: 'smart-voc', label: 'SmartVOC', icon: <BarChart3 className="h-5 w-5" />, stageDetector: (n) => n.toLowerCase().includes('smart voc') },
    { id: 'cognitive-task', label: 'Cognitive Tasks', icon: <Brain className="h-5 w-5" />, stageDetector: (n) => { const l = n.toLowerCase(); return l.includes('cognitive task') || l === 'cognitive tasks'; } },
    { id: 'implicit-association', label: 'Implicit Association', icon: <Zap className="h-5 w-5" />, stageDetector: (n) => n.toLowerCase() === 'implicit association' },
    { id: 'eye-tracking', label: 'Eye Tracking', icon: <Eye className="h-5 w-5" />, stageDetector: (n) => n.toLowerCase() === 'eye tracking' },
    { id: 'emotion-analysis', label: 'Emotion Analysis', icon: <SmilePlus className="h-5 w-5" />, stageDetector: (n) => n.toLowerCase().includes('emotion analysis') },
];

interface ResearchMeta {
    id: string;
    name: string;
    status: string;
    research_type_name: string;
    stages: Array<{ id: string; name: string; stage_type: string; position: number }>;
}

export const PublicResultsPage = () => {
    const { id } = useParams<{ id: string }>();
    const [research, setResearch] = useState<ResearchMeta | null>(null);
    const [activeTab, setActiveTab] = useState<TabId | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        apiClient.setPublicPrefix('/public');
        return () => { apiClient.setPublicPrefix(''); };
    }, []);

    useEffect(() => {
        if (!id) return;
        const load = async () => {
            try {
                const baseUrl = configService.getBaseUrl();
                const res = await fetch(`${baseUrl}/public/research/${id}/results-meta`);
                if (!res.ok) throw new Error(res.status === 404 ? 'These results are not public or no longer exist' : 'Failed to load results');
                const data = await res.json();
                setResearch(data.research);
            } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : 'Error loading results');
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, [id]);

    useEffect(() => {
        if (!research || activeTab) return;
        const stageNames = research.stages.map(s => s.name);
        const first = TAB_DEFS.find(tab => stageNames.some(name => tab.stageDetector(name)));
        if (first) setActiveTab(first.id);
    }, [research, activeTab]);

    const visibleTabs = useMemo(() => {
        if (!research?.stages) return [];
        return TAB_DEFS.filter(tab => research.stages.some(s => tab.stageDetector(s.name)));
    }, [research]);

    if (errorMsg) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <h2 className="text-xl font-semibold text-red-600 mb-2">Error</h2>
                    <p className="text-gray-600">{errorMsg}</p>
                </div>
            </div>
        );
    }

    if (isLoading || !research) {
        return (
            <div className="min-h-screen bg-gray-50">
                <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6 animate-pulse">
                    <div className="h-8 bg-gray-200 rounded w-64" />
                    <div className="h-10 bg-gray-200 rounded w-96" />
                    <div className="h-64 bg-gray-200 rounded-xl" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="container mx-auto px-4 py-8 max-w-6xl">
                <div className="flex items-center gap-3 mb-6">
                    <img src={`${import.meta.env.BASE_URL}EmotioCX-logo.svg`} alt="EmotioCX" className="h-8 w-auto" />
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">{research.name}</h1>
                        <p className="text-xs text-gray-400">Research Results</p>
                    </div>
                </div>

                {visibleTabs.length > 1 && (
                    <nav className="flex gap-1 mb-6 border-b border-gray-200">
                        {visibleTabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
                                    activeTab === tab.id
                                        ? 'border-blue-600 text-blue-600 font-medium'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                {tab.icon}
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                )}

                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    {activeTab === 'screener' && <ScreenerResults researchId={id!} />}
                    {activeTab === 'smart-voc' && <SmartVOCResults researchId={id!} />}
                    {activeTab === 'cognitive-task' && <CognitiveTaskResults researchId={id!} />}
                    {activeTab === 'implicit-association' && <ImplicitAssociationResults researchId={id!} />}
                    {activeTab === 'eye-tracking' && <EyeTrackingResults researchId={id!} />}
                    {activeTab === 'emotion-analysis' && <EmotionAnalysisResults researchId={id!} />}
                </div>

                <div className="mt-8 text-center">
                    <p className="text-xs text-gray-400">Powered by EmotioCX</p>
                </div>
            </div>
        </div>
    );
};
