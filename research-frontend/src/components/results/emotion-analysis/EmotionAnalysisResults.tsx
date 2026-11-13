import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SmilePlus } from 'lucide-react';
import apiClient from '../../../services/api/client';
import { EmotionPanel } from '../eye-tracking/EmotionPanel';
import type { EmotionAggregation, EkmanEmotion } from '../../../services/analytics.service';

interface StimulusResult {
    stimulusIndex: number;
    stimulusUrl: string;
    participantCount: number;
    totalSamples: number;
    dominantEmotion: EkmanEmotion;
    distribution: Record<EkmanEmotion, number>;
    meanIntensity: Record<EkmanEmotion, number>;
    avgConfidence: number;
    avgActionUnits: Record<string, number>;
    microExpressions: {
        total: number;
        briefCount: number;
        microCount: number;
        byEmotion: Record<string, number>;
    };
    timeline: Array<{ timestamp: number; emotion: EkmanEmotion; confidence: number; actionUnits: Record<string, number> }>;
}

interface ModuleResult {
    moduleId: string;
    moduleName: string;
    totalParticipants: number;
    totalSamples: number;
    stimuli: StimulusResult[];
}

export const EmotionAnalysisResults = ({ researchId }: { researchId: string }) => {
    const [selectedStimulus, setSelectedStimulus] = useState(0);

    const { data: modules, isLoading } = useQuery({
        queryKey: ['emotion-analysis-results', researchId],
        queryFn: async () => {
            const res = await apiClient.get<{ results: ModuleResult[] }>(
                `/analytics/research/${researchId}/emotion-analysis`
            );
            return res.results;
        },
    });

    if (isLoading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-48" />
                <div className="h-64 bg-gray-200 rounded-xl" />
            </div>
        );
    }

    if (!modules || modules.length === 0) {
        return (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center">
                <SmilePlus className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No emotion analysis data available yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {modules.map(mod => {
                const stimulus = mod.stimuli[selectedStimulus] || mod.stimuli[0];
                if (!stimulus) return null;

                // Convert to EmotionAggregation format for reuse of EmotionPanel
                const emotionAgg: EmotionAggregation = {
                    enabled: true,
                    totalSamples: stimulus.totalSamples,
                    distribution: stimulus.distribution,
                    meanIntensity: stimulus.meanIntensity,
                    dominantEmotion: stimulus.dominantEmotion,
                    avgConfidence: stimulus.avgConfidence,
                    perParticipant: [],
                    timeline: stimulus.timeline,
                    microExpressions: stimulus.microExpressions.total > 0 ? {
                        ...stimulus.microExpressions,
                        events: [],
                    } : undefined,
                };

                return (
                    <div key={mod.moduleId} className="space-y-4">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">{mod.moduleName}</h3>
                                <p className="text-sm text-gray-500">
                                    {mod.totalParticipants} participants &middot; {mod.totalSamples.toLocaleString()} samples
                                </p>
                            </div>
                        </div>

                        {/* Stimulus selector */}
                        {mod.stimuli.length > 1 && (
                            <div className="flex gap-2 overflow-x-auto pb-2">
                                {mod.stimuli.map((stim, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setSelectedStimulus(i)}
                                        className={`flex-shrink-0 w-20 h-16 rounded-lg border-2 overflow-hidden transition-colors ${
                                            i === selectedStimulus ? 'border-purple-500' : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                    >
                                        <img src={stim.stimulusUrl} alt={`Stimulus ${i + 1}`} className="w-full h-full object-cover" />
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Stimulus image */}
                        {stimulus.stimulusUrl && (
                            <div className="bg-gray-50 rounded-lg p-4 flex justify-center">
                                <img
                                    src={stimulus.stimulusUrl}
                                    alt={`Stimulus ${stimulus.stimulusIndex + 1}`}
                                    className="max-h-64 object-contain rounded"
                                />
                            </div>
                        )}

                        {/* Emotion Panel (reused from ET) */}
                        <EmotionPanel emotions={emotionAgg} />
                    </div>
                );
            })}
        </div>
    );
};
