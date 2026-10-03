/**
 * Analytics Service
 * Fetches aggregated response data for research results visualization
 */

import apiClient from './api/client';

// ==========================================
// SHARED TYPES
// ==========================================

export interface BaseResponse {
    participantId: string;
    createdAt: string;
    [key: string]: unknown;
}

export interface ResponseMetadata {
    duration?: number;
    deviceType?: string;
    browserInfo?: string;
    [key: string]: unknown;
}

// ==========================================
// COGNITIVE TASK RESULTS
// ==========================================

export interface CognitiveTaskResponse extends BaseResponse {
    moduleId: string;
    responseData: Record<string, unknown>;
}

export interface CognitiveTaskResults {
    modules: Array<{
        moduleId: string;
        moduleName: string;
        description: string;
        totalResponses: number;
        responses: CognitiveTaskResponse[];
    }>;
}

export const getCognitiveTaskResults = async (researchId: string): Promise<CognitiveTaskResults> => {
    const response = await apiClient.get<{ results: CognitiveTaskResults }>(
        `/analytics/research/${researchId}/cognitive-tasks`
    );
    return response.results;
};

export interface DemographicParticipant {
    participantId: string;
    demographics: Record<string, string>;
}

export interface DemographicResponsesResult {
    participants: DemographicParticipant[];
    demographicTypes: string[];
}

export const getDemographicResponses = async (researchId: string): Promise<DemographicResponsesResult> => {
    const response = await apiClient.get<{ results: DemographicResponsesResult }>(
        `/analytics/research/${researchId}/demographics`
    );
    return response.results;
};

// ==========================================
// NAVIGATION FLOW RESULTS
// ==========================================

export interface NavigationFlowResponse extends BaseResponse {
    moduleId: string;
    completedFlow: boolean;
    clicks: number;
    correctClicks: number;
    accuracy: number;
    duration: number;
    heatmapData: Array<{
        x: number;
        y: number;
        timestamp: number;
        isCorrect: boolean;
        imageId?: string;
    }>;
    metadata?: ResponseMetadata;
}

export interface NavigationFlowResults {
    totalResponses: number;
    completedFlows: number;
    completionRate: number;
    totalClicks: number;
    correctClicks: number;
    accuracy: number;
    averageDuration: number;
    heatmapData: Array<{
        x: number;
        y: number;
        timestamp: number;
        isCorrect: boolean;
        imageId?: string;
    }>;
    responses: NavigationFlowResponse[];
}

export const getNavigationFlowResults = async (
    researchId: string,
    moduleId: string
): Promise<NavigationFlowResults> => {
    const response = await apiClient.get<{ results: NavigationFlowResults }>(
        `/analytics/research/${researchId}/navigation-flow/${moduleId}`
    );
    return response.results;
};

// ==========================================
// PREFERENCE TEST RESULTS
// ==========================================

export interface PreferenceTestResponse extends BaseResponse {
    moduleId: string;
    selectedImageId: number;
    viewTime: number;
    metadata?: ResponseMetadata;
}

export interface PreferenceTestResults {
    totalResponses: number;
    selections: Array<{
        imageId: number;
        count: number;
        percentage: number;
    }>;
    averageViewTime: number;
    responses: PreferenceTestResponse[];
}

export const getPreferenceTestResults = async (
    researchId: string,
    moduleId: string
): Promise<PreferenceTestResults> => {
    const response = await apiClient.get<{ results: PreferenceTestResults }>(
        `/analytics/research/${researchId}/preference-test/${moduleId}`
    );
    return response.results;
};

// ==========================================
// TEXT RESPONSES
// ==========================================

export interface TextResponse extends BaseResponse {
    moduleId: string;
    text: string;
    metadata?: ResponseMetadata;
}

export interface TextResponses {
    totalResponses: number;
    responses: TextResponse[];
}

export const getTextResponses = async (
    researchId: string,
    moduleId: string
): Promise<TextResponses> => {
    const response = await apiClient.get<{ results: TextResponses }>(
        `/analytics/research/${researchId}/text-responses/${moduleId}`
    );
    return response.results;
};

// ==========================================
// CHOICE RESPONSES
// ==========================================

export interface ChoiceResponse extends BaseResponse {
    moduleId: string;
    choice: string;
    metadata?: ResponseMetadata;
}

export interface ChoiceResponses {
    totalResponses: number;
    questionText?: string;
    choiceCounts: Array<{
        choice: string;
        rawKey?: string;
        count: number;
        percentage: number;
    }>;
    responses: ChoiceResponse[];
}

export const getChoiceResponses = async (
    researchId: string,
    moduleId: string
): Promise<ChoiceResponses> => {
    const response = await apiClient.get<{ results: ChoiceResponses }>(
        `/analytics/research/${researchId}/choice-responses/${moduleId}`
    );
    return response.results;
};

// ==========================================
// SCALE RESPONSES
// ==========================================

export interface ScaleResponse extends BaseResponse {
    moduleId: string;
    value: number;
    metadata?: ResponseMetadata;
}

export interface ScaleResponses {
    totalResponses: number;
    average: number;
    questionText?: string;
    distribution: Array<{
        value: number;
        count: number;
        percentage: number;
    }>;
    responses: ScaleResponse[];
}

export const getScaleResponses = async (
    researchId: string,
    moduleId: string
): Promise<ScaleResponses> => {
    const response = await apiClient.get<{ results: ScaleResponses }>(
        `/analytics/research/${researchId}/scale-responses/${moduleId}`
    );
    return response.results;
};

// ==========================================
// RANKING RESPONSES
// ==========================================

export interface RankingResponse extends BaseResponse {
    moduleId: string;
    rankings: Array<{
        item: string;
        position: number;
    }>;
    metadata?: ResponseMetadata;
}

export interface RankingResponses {
    totalResponses: number;
    questionText?: string;
    rankings: Array<{
        item: string;
        label?: string;
        meanPosition: number;
        count: number;
    }>;
    responses: RankingResponse[];
}

export const getRankingResponses = async (
    researchId: string,
    moduleId: string
): Promise<RankingResponses> => {
    const response = await apiClient.get<{ results: RankingResponses }>(
        `/analytics/research/${researchId}/ranking-responses/${moduleId}`
    );
    return response.results;
};

// ==========================================
// SCREENER RESULTS
// ==========================================

export interface ScreenerChoiceDistribution {
    choiceId: string;
    label: string;
    eligibility: 'Qualify' | 'Disqualify';
    count: number;
    percentage: number;
}

export interface ScreenerDayInfo {
    date: string;
    dayName: string;
    hour: string;
    count: number;
    percentage: number;
}

export interface ScreenerResults {
    totalResponses: number;
    qualified: number;
    disqualified: number;
    overquota: number;
    questionText: string;
    choiceDistribution: ScreenerChoiceDistribution[];
    dailyDistribution: Array<{
        date: string;
        count: number;
        byChoice: Record<string, number>;
    }>;
    bestDay: ScreenerDayInfo | null;
    slowestDay: ScreenerDayInfo | null;
    weeklyTimeSeries: Array<{
        date: string;
        dayName: string;
        count: number;
    }>;
}

export const getScreenerResults = async (researchId: string): Promise<ScreenerResults> => {
    const response = await apiClient.get<{ results: ScreenerResults }>(
        `/analytics/research/${researchId}/screener`
    );
    return response.results;
};

// ==========================================
// IMPLICIT ASSOCIATION RESULTS
// ==========================================

export interface IATTarget {
    id: string;
    name: string;
    imageUrl?: string;
}

export interface IATAttribute {
    id: string;
    label: string;
    /** Target assigned to this criterion (Attribute Testing only) */
    targetId?: string;
}

export type DScoreEffect = 'none' | 'slight' | 'moderate' | 'strong';

export interface DScoreResult {
    value: number;
    effect: DScoreEffect;
    validParticipants: number;
    ciLower: number;
    ciUpper: number;
    reliability: number | null;
}

export interface IATParticipantData {
    participantId: string;
    rtByCombination: Record<string, number>;
    totalTrials: number;
    fastTrials: number;
    accuracy: number;
    quality: 'good' | 'fast_responses' | 'low_accuracy' | 'insufficient_data';
    segmentation: Record<string, string>;
    dScore?: number;
    dScoreEffect?: DScoreEffect;
}

export interface RTDistributionStats {
    label: string;
    conditionId: string;
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    mean: number;
    stdDev: number;
    count: number;
}

export interface IATModuleResult {
    moduleId: string;
    moduleName: string;
    testTitle?: string;
    testType: 'attribute_testing' | 'comparing_attribute' | 'objects_comparing';
    primingTime: number;
    targets: IATTarget[];
    attributes: IATAttribute[];
    totalResponses: number;
    scores: Array<{
        attributeId: string;
        attributeLabel: string;
        targetScores: Record<string, number>;
    }>;
    criteriaScores?: Array<{
        criterionId: string;
        criterionLabel: string;
        objectScores: Record<string, {
            netScore: number;
            dim1Pct: number;
            dim2Pct: number;
            meanRT: number;
            trials: number;
        }>;
    }>;
    participantData?: IATParticipantData[];
    dScore?: DScoreResult;
    errorAnalysis?: {
        byPhase: Array<{ phase: string; total: number; errors: number; errorRate: number }>;
        byCombination: Array<{ targetId: string; targetName: string; attributeId: string; attributeLabel: string; total: number; errors: number; errorRate: number }>;
        overallErrorRate: number;
        overallFastRate: number;
    };
    rtDistribution?: RTDistributionStats[];
}

export interface ImplicitAssociationResults {
    modules: IATModuleResult[];
}

export const getImplicitAssociationResults = async (researchId: string, stageId?: string): Promise<ImplicitAssociationResults> => {
    const qs = stageId ? `?stageId=${stageId}` : '';
    const response = await apiClient.get<{ results: ImplicitAssociationResults }>(
        `/analytics/research/${researchId}/implicit-association${qs}`
    );
    return response.results;
};

// ==========================================
// EYE TRACKING RESULTS
// ==========================================

export interface EyeTrackingAOI {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    dwellTimePercent: number;
    fixationCount: number;
    avgDuration: number;
    participantCount: number;
    /** Average Time To First Fixation in ms */
    avgTTFF?: number;
    /** % of participants who noticed this AOI */
    noticeRate?: number;
    /** Dominant emotion while looking at this AOI */
    dominantEmotion?: EkmanEmotion;
    /** Emotion distribution while looking at this AOI */
    emotionDistribution?: Record<EkmanEmotion, number>;
    /** Attention-memory gap: high attention + low recall = missed opportunity (Chu 2022) */
    attentionMemoryGap?: number;
}

export interface EyeTrackingParticipant {
    participantId: string;
    calibrationQuality: string;
    calibrationRmsePx: number | null;
    integrityScore: number;
    totalFixations: number;
    totalDwellTime: number;
    qualityGrade: 'good' | 'fair' | 'low';
}

export type EkmanEmotion = 'joy' | 'sadness' | 'surprise' | 'anger' | 'disgust' | 'fear' | 'neutral';

export interface EmotionSample {
    timestamp: number;
    emotion: EkmanEmotion;
    confidence: number;
    actionUnits: Record<string, number>;
}

export interface EmotionAggregation {
    enabled: boolean;
    totalSamples: number;
    distribution: Record<EkmanEmotion, number>;
    dominantEmotion: EkmanEmotion;
    avgConfidence: number;
    perParticipant: Array<{
        participantId: string;
        dominantEmotion: EkmanEmotion;
        sampleCount: number;
        distribution: Record<EkmanEmotion, number>;
    }>;
    timeline: EmotionSample[];
    microExpressions?: {
        total: number;
        briefCount: number;
        microCount: number;
        byEmotion: Record<string, number>;
        events: Array<{
            participantId: string;
            emotion: string;
            durationMs: number;
            startTimestamp: number;
            category: 'brief' | 'micro';
            peakConfidence: number;
        }>;
    };
}

export interface EyeTrackingStimulus {
    moduleId: string;
    moduleName: string;
    stimulusUrl: string;
    modality: 'stand_alone' | 'shelf';
    shelfCount?: number;
    shelfItems?: number;
    shelfUrls?: string[];
    taskDescription: string;
    totalResponses: number;
    uniqueParticipants: number;
    avgDwellTime: number;
    avgFixationCount: number;
    heatmapData: Array<{ x: number; y: number; duration: number }>;
    zoneMass?: Record<string, number>;
    fixations: Array<{ x: number; y: number; duration: number; participantId: string; timestamp: number }>;
    aois: EyeTrackingAOI[];
    participants: EyeTrackingParticipant[];
    qualitySummary?: { total: number; good: number; fair: number; low: number };
    emotions: EmotionAggregation;
    predictionHeatmap?: Array<{ x: number; y: number; value: number }>;
    predictionProcessedAt?: string;
    /** Gaze points with video timestamps (only for video stimuli) */
    gazeTimeline?: Array<{ x: number; y: number; t: number; videoTime?: number; participantId: string }>;
    stimulusType?: 'image' | 'video';
    /** Video-specific quality metrics (only for video stimuli) */
    videoQuality?: {
        completionRate: number;
        completed: number;
        total: number;
        gazeCoverage: number;
        videoDurationS: number;
    };
    /** AOI sequence analysis: visit order per participant + transition probabilities */
    sequenceAnalysis?: {
        participantSequences: Array<{ participantId: string; sequence: string[] }>;
        transitionMatrix: Record<string, Record<string, number>>;
        aoiLabels: string[];
    };
    /** V3 probabilistic heatmap (aggregated across participants). */
    v3Heatmap?: V3AggregatedHeatmap;
}

export interface V3AggregatedHeatmap {
    cols: number;
    rows: number;
    cellW: number;
    cellH: number;
    densityBase64: string;
    normalizedBase64: string;
    totalMassS: number;
    participantCount: number;
    avgConfidence: number;
    avgSpatialCoverage: number;
    aoiMetrics: Array<{
        aoiId: string;
        label: string;
        totalDwellS: number;
        avgAttentionShare: number;
        earliestFirstAttentionMs: number | null;
        participantCount: number;
    }>;
    /** Per-cell earliest first-attention across participants (video only, base64 Float64Array). */
    firstAttentionBase64?: string;
    /** Per-cell peak attention time across participants (video only, base64 Float64Array). */
    peakTimeBase64?: string;
    /** Whether temporal data is available (video stimuli only). */
    hasTemporalData?: boolean;
    perParticipant: Array<{
        participantId: string;
        totalDurationS: number;
        totalMassS: number;
        confidence: number;
        spatialCoverage: number;
    }>;
}

export interface EyeTrackingResults {
    stimuli: EyeTrackingStimulus[];
}

export const getEyeTrackingResults = async (researchId: string, stageId?: string): Promise<EyeTrackingResults> => {
    const qs = stageId ? `?stageId=${stageId}` : '';
    const response = await apiClient.get<{ results: EyeTrackingResults }>(
        `/analytics/research/${researchId}/eye-tracking${qs}`
    );
    return response.results;
};

// ==========================================
// CLIENT'S BENCHMARK RESULTS
// ==========================================

export interface BenchmarkAOI {
    id: string;
    label: string;
    dwellTimePercent: number;
    fixationCount: number;
    avgDuration: number;
    participantCount: number;
}

export interface BenchmarkModule {
    moduleId: string;
    moduleName: string;
    stimulusUrl: string;
    uniqueParticipants: number;
    totalResponses: number;
    aois: BenchmarkAOI[];
}

export interface BenchmarkResearchResult {
    researchId: string;
    researchName: string;
    modules: BenchmarkModule[];
}

export interface BenchmarkResults {
    researches: BenchmarkResearchResult[];
}

export const getBenchmarkResults = async (researchId: string): Promise<BenchmarkResults> => {
    const response = await apiClient.get<{ results: BenchmarkResults }>(
        `/analytics/benchmark/${researchId}`
    );
    return response.results;
};

// ==========================================
// SMARTVOC RESULTS
// ==========================================

export interface SmartVOCResults {
    totalResponses: number;
    uniqueParticipants: number;
    metrics: {
        cpvValue: number;
        satisfaction: number;
        retention: number;
        npsScore: number;
        promoters: number;
        neutrals: number;
        detractors: number;
        csatScores: Array<{ value: number; date: string; participantId?: string }>;
        cesScores: Array<{ value: number; date: string; participantId?: string }>;
        cvScores: Array<{ value: number; date: string; participantId?: string }>;
        npsScores: Array<{ value: number; date: string; participantId?: string }>;
        impact: string;
        trend: string;
    };
    timeSeriesData: Array<{
        date: string;
        nps: number;
        nev: number;
        csat: number;
        ces: number;
        cv: number;
        cpv: number;
        count: number;
    }>;
    intradayTimeSeriesData: Array<{
        date: string;
        label: string;
        nps: number;
        nev: number;
        csat: number;
        ces: number;
        cv: number;
        cpv: number;
        count: number;
    }>;
    vocResponses: Array<{
        text: string;
        sentiment?: string;
        participantId: string;
        createdAt: string;
    }>;
    monthlyNPSData: Array<{
        month: string;
        promoters: number;
        neutrals: number;
        detractors: number;
        npsRatio: number;
        date?: string;
    }>;
    monthlyMetricsData: Array<{
        month: string;
        date: string;
        csatSatisfied: number;
        csatDissatisfied: number;
        cesPositive: number;
        cesNegative: number;
        cvPositive: number;
        cvNegative: number;
        cpv: number;
    }>;
    emotionalStates: Record<string, number>;
    nevResponsesData: Array<{ emotions: string[]; date: string; participantId?: string }>;
    questionTexts?: Record<string, string>;
}

export const getSmartVOCResults = async (researchId: string): Promise<SmartVOCResults> => {
    const response = await apiClient.get<{ results: SmartVOCResults }>(
        `/analytics/research/${researchId}/smartvoc`
    );
    return response.results;
};

export type EnterpriseSmartVOCResult = SmartVOCResults & {
    researchId: string;
    researchName: string;
    enterpriseName: string | null;
    scaleConfigs?: Record<string, { min: number; max: number }>;
};

export const getEnterpriseSmartVOC = async (enterpriseId: string): Promise<EnterpriseSmartVOCResult[]> => {
    const response = await apiClient.get<{ results: EnterpriseSmartVOCResult[] }>(
        `/analytics/enterprise/${enterpriseId}/smartvoc`
    );
    return response.results;
};

export const getConsolidatedSmartVOC = async (): Promise<EnterpriseSmartVOCResult[]> => {
    const response = await apiClient.get<{ results: EnterpriseSmartVOCResult[] }>('/analytics/smartvoc/consolidated');
    return response.results;
};

// ==========================================
// TEXT ANALYSIS (LLM themes/keywords)
// ==========================================

export interface TextAnalysis {
    sentiment: {
        summary: string;
        description: string;
        actionables: string[];
    };
    themes: Array<{ name: string; count: number; description: string; magnitude: number; sentimentScore: number; supportingQuotes?: string[] }>;
    keywords: Array<{ word: string; count: number; sentiment: string }>;
}

/** Fetch cached LLM analysis for a module (or "voc" for all VOC responses). */
export const getTextAnalysis = async (
    researchId: string,
    moduleId: string,
): Promise<TextAnalysis | null> => {
    const response = await apiClient.get<{ analysis: TextAnalysis | null }>(
        `/analytics/research/${researchId}/text-analysis/${moduleId}`
    );
    return response.analysis;
};

/** Trigger LLM analysis (fire-and-forget, returns 202). Optionally filter by participant IDs or selected texts. */
export const triggerTextAnalysis = async (
    researchId: string,
    moduleId: string,
    participantIds?: string[],
    selectedTexts?: Array<{ text: string; mood: string }>,
): Promise<void> => {
    const body: Record<string, unknown> = {};
    if (selectedTexts && selectedTexts.length > 0) {
        body.selectedTexts = selectedTexts;
    } else if (participantIds && participantIds.length > 0) {
        body.participantIds = participantIds;
    }
    await apiClient.post(
        `/analytics/research/${researchId}/text-analysis/${moduleId}`,
        body
    );
};
