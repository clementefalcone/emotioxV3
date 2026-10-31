import { create } from 'zustand';
import type { ResearchConfig, DeviceInfo, SessionMetrics, UserInteraction } from '../types/research-config';

interface SessionState {
    config: ResearchConfig | null;
    deviceInfo: DeviceInfo | null;
    metrics: SessionMetrics;
    interactions: UserInteraction[];
    turnstileToken: string | null;
    turnstileVerified: boolean;
    turnstileTokenUsed: boolean;

    setConfig: (config: ResearchConfig) => void;
    setDeviceInfo: (info: DeviceInfo) => void;
    setTurnstileToken: (token: string) => void;
    clearTurnstileToken: () => void;
    markTurnstileTokenUsed: () => void;
    startSession: () => void;
    endSession: () => void;
    trackInteraction: (interaction: Omit<UserInteraction, 'timestamp'>) => void;
    updateMetrics: (updates: Partial<SessionMetrics>) => void;
    getSessionSummary: () => {
        config: ResearchConfig | null;
        device: DeviceInfo | null;
            metrics: SessionMetrics;
        interactionCount: number;
    };
}

const initialMetrics: SessionMetrics = {
    startTime: 0,
    endTime: null,
    duration: 0,
    stepChanges: 0,
    interactionCount: 0,
    focusTime: 0,
    idleTime: 0,
};

export const useSessionStore = create<SessionState>((set, get) => ({
    config: null,
    deviceInfo: null,
    metrics: initialMetrics,
    interactions: [],
    turnstileToken: null,
    turnstileVerified: false,
    turnstileTokenUsed: false,

    setConfig: (config) => set({ config }),

    setDeviceInfo: (deviceInfo) => set({ deviceInfo }),

    setTurnstileToken: (token) => set({ turnstileToken: token, turnstileVerified: true, turnstileTokenUsed: false }),

    clearTurnstileToken: () => set({ turnstileToken: null, turnstileVerified: false, turnstileTokenUsed: false }),

    markTurnstileTokenUsed: () => set({ turnstileTokenUsed: true }),
    
    startSession: () => {
        const startTime = Date.now();
        set({
            metrics: { ...initialMetrics, startTime },
            interactions: [],
        });
    },
    
    endSession: () => {
        const endTime = Date.now();
        const { metrics } = get();
        const duration = endTime - metrics.startTime;
        set({ 
            metrics: { ...metrics, endTime, duration } 
        });
    },
    
    trackInteraction: (interaction) => {
        const { config, interactions, metrics } = get();
        
        // Solo trackear si está habilitado
        if (!config?.settings.enableInteractionTracking) return;
        
        const newInteraction: UserInteraction = {
            ...interaction,
            timestamp: Date.now(),
        };
        
        // Limitar a las últimas 100 interacciones para no saturar memoria
        const updatedInteractions = [...interactions, newInteraction].slice(-100);
        
        set({ 
            interactions: updatedInteractions,
            metrics: { 
                ...metrics, 
                interactionCount: metrics.interactionCount + 1 
            }
        });
    },
    
    updateMetrics: (updates) => {
        const { metrics } = get();
        set({ metrics: { ...metrics, ...updates } });
    },
    
    getSessionSummary: () => {
        const { config, deviceInfo, metrics, interactions } = get();
        return {
            config,
            device: deviceInfo,
            metrics,
            interactionCount: interactions.length,
        };
    },
}));
