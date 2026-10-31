import { useState, useEffect, useCallback, useRef } from 'react';
import * as analyticsService from '../services/analytics.service';
import type { SmartVOCAnalytics } from '../services/smartVOC.service';
import { useAuthStore } from '../stores/auth.store';
import { configService } from '../services/api/config.service';

interface UseSmartVOCAnalyticsResult {
    data: SmartVOCAnalytics | null;
    isLoading: boolean;
    error: Error | null;
    isLive: boolean;
    refetch: () => Promise<void>;
}

/**
 * Maps backend SmartVOCResults to frontend SmartVOCAnalytics format
 */
const mapToAnalytics = (results: analyticsService.SmartVOCResults): SmartVOCAnalytics => ({
    responses: [],
    metrics: results.metrics,
    timeSeriesData: results.timeSeriesData,
    intradayTimeSeriesData: results.intradayTimeSeriesData,
    vocResponses: results.vocResponses.map(v => ({ text: v.text, sentiment: v.sentiment, createdAt: v.createdAt, participantId: v.participantId })),
    nevResponsesData: results.nevResponsesData,
    monthlyNPSData: results.monthlyNPSData,
    monthlyMetricsData: results.monthlyMetricsData,
    emotionalStates: results.emotionalStates,
    questionTexts: results.questionTexts
});

/**
 * Resolves the SSE base URL (same as API base URL)
 */
const getSSEBaseUrl = async (): Promise<string> => {
    if (import.meta.env.VITE_API_URL) {
        return import.meta.env.VITE_API_URL;
    }
    try {
        await configService.init();
        return configService.getBaseUrl();
    } catch {
        // Production fallback
        const { protocol, host } = window.location;
        if (host.includes('emotio.cx')) {
            return `${protocol}//${host}/api`;
        }
        return 'http://localhost:3000';
    }
};

/**
 * Hook for fetching SmartVOC analytics with real-time SSE updates.
 * On mount: fetches initial data via REST.
 * Then: connects to SSE and receives live SmartVOC analytics pushed by the backend
 * whenever a participant submits a SmartVOC response — no polling.
 */
export const useSmartVOCAnalytics = (researchId: string | null): UseSmartVOCAnalyticsResult => {
    const [data, setData] = useState<SmartVOCAnalytics | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [isLive, setIsLive] = useState(false);
    const token = useAuthStore(state => state.token);
    const eventSourceRef = useRef<EventSource | null>(null);

    const fetchData = useCallback(async () => {
        if (!researchId) {
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);
            const results = await analyticsService.getSmartVOCResults(researchId);
            setData(mapToAnalytics(results));
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to fetch SmartVOC analytics'));
            console.error('Error fetching SmartVOC analytics:', err);
            setData(null);
        } finally {
            setIsLoading(false);
        }
    }, [researchId]);

    // Initial fetch
    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    // SSE connection for real-time updates
    useEffect(() => {
        if (!researchId || !token) return;

        let source: EventSource | null = null;

        const connectSSE = async () => {
            try {
                const baseUrl = await getSSEBaseUrl();
                const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
                const sseUrl = `${cleanBaseUrl}/monitor/events/${encodeURIComponent(researchId)}`;

                source = new EventSource(sseUrl, { withCredentials: true });
                eventSourceRef.current = source;

                source.addEventListener('connected', () => {
                    setIsLive(true);
                });

                source.addEventListener('smartvoc-update', (event) => {
                    try {
                        const results = JSON.parse(event.data) as analyticsService.SmartVOCResults;
                        setData(mapToAnalytics(results));
                    } catch (parseErr) {
                        console.error('Error parsing smartvoc-update SSE event:', parseErr);
                    }
                });

                source.onerror = () => {
                    setIsLive(false);
                    source?.close();
                };

                source.onopen = () => {
                    setIsLive(true);
                };
            } catch (connErr) {
                console.error('Failed to create SSE connection:', connErr);
            }
        };

        void connectSSE();

        return () => {
            if (source) {
                source.close();
            }
            eventSourceRef.current = null;
            setIsLive(false);
        };
    }, [researchId, token]);

    return {
        data,
        isLoading,
        error,
        isLive,
        refetch: fetchData
    };
};
