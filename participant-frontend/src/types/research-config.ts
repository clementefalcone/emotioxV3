export interface ResearchConfig {
    id: string;
    settings: {
        enableDeviceCapture: boolean;
        enableSessionRecording: boolean;
        enableInteractionTracking?: boolean;
    };
    // Link configuration from research-frontend
    linkConfig?: {
        allowMobile?: boolean;
        allowMultiple?: boolean;
        allowLanguageSwitch?: boolean;
    };
    // Participant limit configuration
    participantLimit?: {
        enabled: boolean;
        value: number;
    };
    // Backlink URLs for redirects (complete, disqualified, overquota)
    backlinks?: Record<string, string>;
}

export interface DeviceInfo {
    userAgent: string;
    platform: string;
    language: string;
    screenResolution: string;
    viewportSize: string;
    deviceType: 'mobile' | 'tablet' | 'desktop' | 'unknown';
    browserName?: string;
    osName?: string;
}

export interface SessionMetrics {
    startTime: number;
    endTime: number | null;
    duration: number;
    stepChanges: number;
    interactionCount: number;
    focusTime: number;
    idleTime: number;
}

export interface UserInteraction {
    type: 'click' | 'input' | 'focus' | 'blur' | 'step_change';
    target: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
}