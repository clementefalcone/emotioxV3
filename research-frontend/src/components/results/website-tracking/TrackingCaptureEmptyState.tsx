import type { LucideIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import * as trackingService from '../../../services/tracking.service';
import type { TrackingConfig } from '../../../services/tracking.service';

interface TrackingCaptureEmptyStateProps {
    researchId: string;
    icon: LucideIcon;
    title: string;
    captureSetting: 'emotionsMode' | 'gazeMode';
    toggleLabel: string;
}

const describeCaptureHint = (config: TrackingConfig | undefined, props: TrackingCaptureEmptyStateProps): string | null => {
    if (!config) return null;
    if (config[props.captureSetting] === 'off') return `Set "${props.toggleLabel}" to Optional or Required in tracking config`;
    return 'Capture is on — no visitor has accepted the camera and finished calibration yet';
};

export const TrackingCaptureEmptyState = (props: TrackingCaptureEmptyStateProps) => {
    const { data: config } = useQuery({
        queryKey: ['tracking', props.researchId, 'tracking-config'],
        queryFn: () => trackingService.getTrackingConfig(props.researchId),
        staleTime: 30_000,
    });
    const hint = describeCaptureHint(config, props);
    const Icon = props.icon;

    return (
        <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center py-20">
            <div className="text-center">
                <Icon className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">{props.title}</p>
                {hint && <p className="text-xs text-gray-300 mt-1">{hint}</p>}
            </div>
        </div>
    );
};
