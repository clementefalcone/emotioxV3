import { useState, useEffect, useCallback } from 'react';
import { configService } from '../services/api/config.service';

interface Participant {
    id: string;
    name: string;
    email: string;
    status: 'En proceso' | 'Por iniciar' | 'Completado';
    progress: number;
    duration: string;
    lastActivity: string;
    steps: Array<{
        name: string;
        completed: boolean;
        duration: string;
    }>;
}

interface MonitoringDataState {
    participants: Participant[];
    metrics: {
        total: number;
        active: number;
        completed: number;
        avgCompletionTime: string;
        completionRate: number;
    };
    lastUpdate: string;
}

export const useMonitoringReceiver = (researchId: string | null, token: string | null) => {
    const [eventSource, setEventSource] = useState<EventSource | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [monitoringData, setMonitoringData] = useState<MonitoringDataState>({
        participants: [],
        metrics: {
            total: 0,
            active: 0,
            completed: 0,
            avgCompletionTime: '00:00:00',
            completionRate: 0
        },
        lastUpdate: new Date().toISOString()
    });

    /**
     * Obtiene la URL base de la API para construir el endpoint SSE
     * SSE siempre usa el mismo servidor que la API REST (cPanel)
     * @returns URL base de la API
     */
    const getSSEUrl = async (): Promise<string | null> => {
        // Priority 1: Environment variable override
        if (import.meta.env.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }

        // Priority 2: Get API base URL from config service
        // This returns the same base URL used for all API calls (cPanel)
        try {
            await configService.init();
            return configService.getBaseUrl();
        } catch (error) {
            console.warn('Failed to get API base URL, using fallback', error);
        }

        // Priority 3: Production fallback - use same origin as frontend
        const protocol = window.location.protocol;
        const host = window.location.host;
        
        // If on emotio.cx domain, API is at /api path
        if (host.includes('emotio.cx')) {
            return `${protocol}//${host}/api`;
        }

        // Development fallback
        return 'http://localhost:3000';
    };

    // Event handlers
    const handleParticipantLogin = useCallback((data: { participantId: string; timestamp: string }) => {
        setMonitoringData(prev => {
            const participantExists = prev.participants.some(p => p.id === data.participantId);
            if (participantExists) {
                return prev;
            }

            const newParticipant: Participant = {
                id: data.participantId,
                name: `Participant ${prev.participants.length + 1}`,
                email: `participant${prev.participants.length + 1}@example.com`,
                status: 'Por iniciar' as const,
                progress: 0,
                duration: '00:00:00',
                lastActivity: data.timestamp,
                steps: []
            };

            return {
                ...prev,
                participants: [...prev.participants, newParticipant],
                metrics: {
                    ...prev.metrics,
                    total: prev.metrics.total + 1,
                    active: prev.metrics.active + 1
                },
                lastUpdate: new Date().toISOString()
            };
        });
    }, []);

    const handleParticipantStep = useCallback((data: { participantId: string; stepName: string; progress: number; timestamp: string; duration: string }) => {
        setMonitoringData(prev => {
            const updatedParticipants = prev.participants.map(p => {
                if (p.id === data.participantId) {
                    // Check if step already exists
                    const stepExists = p.steps.some(step => step.name === data.stepName);

                    const updatedSteps = stepExists
                        ? p.steps.map(step =>
                            step.name === data.stepName
                                ? { ...step, completed: true, duration: data.duration }
                                : step
                        )
                        : [...p.steps, { name: data.stepName, completed: true, duration: data.duration }];

                    const completedSteps = updatedSteps.filter(step => step.completed).length;
                    const totalSteps = updatedSteps.length;
                    const newProgress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

                    return {
                        ...p,
                        progress: newProgress,
                        status: (newProgress === 100 ? 'Completado' : 'En proceso') as Participant['status'],
                        duration: data.duration,
                        lastActivity: data.timestamp,
                        steps: updatedSteps
                    };
                }
                return p;
            });

            const completedCount = updatedParticipants.filter(p => p.status === 'Completado').length;
            const activeCount = updatedParticipants.filter(p => p.status === 'En proceso' || p.status === 'Por iniciar').length;

            return {
                ...prev,
                participants: updatedParticipants,
                metrics: {
                    ...prev.metrics,
                    active: activeCount,
                    completed: completedCount,
                    completionRate: prev.participants.length > 0 ? Math.round((completedCount / prev.participants.length) * 100) : 0
                },
                lastUpdate: new Date().toISOString()
            };
        });
    }, []);

    const handleParticipantDisqualified = useCallback((data: { participantId: string; reason: string; timestamp: string }) => {
        setMonitoringData(prev => {
            const updatedParticipants = prev.participants.map(p =>
                p.id === data.participantId
                    ? {
                        ...p,
                        status: 'Completado' as const // Disqualified participants are marked as completed
                    }
                    : p
            );

            const completedCount = updatedParticipants.filter(p => p.status === 'Completado').length;

            return {
                ...prev,
                participants: updatedParticipants,
                metrics: {
                    ...prev.metrics,
                    completed: completedCount,
                    completionRate: prev.participants.length > 0 ? Math.round((completedCount / prev.participants.length) * 100) : 0
                },
                lastUpdate: new Date().toISOString()
            };
        });
    }, []);

    const handleParticipantQuotaExceeded = useCallback((data: { participantId: string; quotaType: string; quotaValue: string; timestamp: string }) => {
        // Handle quota exceeded event
        console.log('Quota exceeded:', data);
    }, []);

    const handleParticipantCompleted = useCallback((data: { participantId: string; timestamp: string }) => {
        setMonitoringData(prev => {
            const updatedParticipants = prev.participants.map(p =>
                p.id === data.participantId
                    ? { ...p, status: 'Completado' as const, progress: 100 }
                    : p
            );

            const completedCount = updatedParticipants.filter(p => p.status === 'Completado').length;

            return {
                ...prev,
                participants: updatedParticipants,
                metrics: {
                    ...prev.metrics,
                    active: prev.metrics.active - 1,
                    completed: completedCount,
                    completionRate: prev.participants.length > 0 ? Math.round((completedCount / prev.participants.length) * 100) : 0
                },
                lastUpdate: new Date().toISOString()
            };
        });
    }, []);

    const handleParticipantError = useCallback((data: { participantId: string; timestamp: string }) => {
        // Handle participant error event
        console.log('Participant error:', data);
    }, []);

    // Initialize connection when researchId and token are available
    useEffect(() => {
        if (!researchId || !token) {
            return;
        }

        let source: EventSource | null = null;

        const connectSSE = async (): Promise<void> => {
            try {
                const baseUrl = await getSSEUrl();
                if (!baseUrl) {
                    console.error('SSE URL not available');
                    setError('API URL not configured');
                    return;
                }

                // Build SSE endpoint URL: /api/monitor/events/:researchId
                const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
                const sseUrl = `${cleanBaseUrl}/monitor/events/${encodeURIComponent(researchId)}`;
                
                console.log('Connecting to SSE:', sseUrl);
                source = new EventSource(sseUrl, { withCredentials: true });

                source.onopen = () => {
                    setIsConnected(true);
                    setError(null);
                    console.log('SSE connection established');
                };

                // Handle 'connected' event
                source.addEventListener('connected', (event) => {
                    console.log('SSE connected event:', event.data);
                });

                // Handle 'participant:login' event
                source.addEventListener('participant:login', (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        handleParticipantLogin(data);
                    } catch (parseError) {
                        console.error('Error parsing participant:login event:', parseError);
                    }
                });

                // Handle 'participant:step' event
                source.addEventListener('participant:step', (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        handleParticipantStep(data);
                    } catch (parseError) {
                        console.error('Error parsing participant:step event:', parseError);
                    }
                });

                // Handle 'participant:disqualified' event
                source.addEventListener('participant:disqualified', (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        handleParticipantDisqualified(data);
                    } catch (parseError) {
                        console.error('Error parsing participant:disqualified event:', parseError);
                    }
                });

                // Handle 'participant:quota_exceeded' event
                source.addEventListener('participant:quota_exceeded', (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        handleParticipantQuotaExceeded(data);
                    } catch (parseError) {
                        console.error('Error parsing participant:quota_exceeded event:', parseError);
                    }
                });

                // Handle 'participant:completed' event
                source.addEventListener('participant:completed', (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        handleParticipantCompleted(data);
                    } catch (parseError) {
                        console.error('Error parsing participant:completed event:', parseError);
                    }
                });

                // Handle 'participant:error' event
                source.addEventListener('participant:error', (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        handleParticipantError(data);
                    } catch (parseError) {
                        console.error('Error parsing participant:error event:', parseError);
                    }
                });

                // Handle 'research:update' event (full state update)
                source.addEventListener('research:update', (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        setMonitoringData(prev => ({
                            ...prev,
                            ...data,
                            lastUpdate: new Date().toISOString()
                        }));
                    } catch (parseError) {
                        console.error('Error parsing research:update event:', parseError);
                    }
                });

                source.onerror = (error) => {
                    console.error('SSE connection error:', error);
                    setIsConnected(false);
                    setError('SSE connection error');
                    source?.close();
                };

                setEventSource(source);
            } catch (connectionError) {
                console.error('Failed to create SSE connection:', connectionError);
                setError('Failed to establish SSE connection');
            }
        };

        void connectSSE();

        return () => {
            if (source) {
                source.close();
            }
        };
    }, [researchId, token, handleParticipantLogin, handleParticipantStep, handleParticipantDisqualified, handleParticipantQuotaExceeded, handleParticipantCompleted, handleParticipantError]);

    const connect = useCallback(() => {
        // No-op - connection is managed by useEffect
        console.log('Manual connect requested - handled by effect');
    }, []);

    const disconnect = useCallback(() => {
        if (eventSource) {
            eventSource.close();
        }
    }, [eventSource]);

    return {
        isConnected,
        error,
        monitoringData,
        connect,
        disconnect
    };
};