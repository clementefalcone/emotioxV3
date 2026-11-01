import type { EyeTrackingAOI, EyeTrackingParticipant } from '../../../services/analytics.service';
import { summarizeGazePrecision } from './gazePrecisionSummary';

export const GazePrecisionNotice = ({ participants, excludedParticipants, aois }: {
    participants: ReadonlyArray<EyeTrackingParticipant>;
    excludedParticipants: ReadonlySet<string>;
    aois: ReadonlyArray<Pick<EyeTrackingAOI, 'label' | 'width'>>;
}) => {
    const { devices, narrowAoiLabels } = summarizeGazePrecision(participants, excludedParticipants, aois);
    if (devices.length === 0) return null;
    return (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-800 space-y-1">
            <p>
                Margen de error típico de la mirada:{' '}
                {devices.map(device => `${device.label} ±${device.errorPercent} %`).join(' · ')} del ancho de pantalla.
            </p>
            {narrowAoiLabels.length > 0 && (
                <p>
                    {narrowAoiLabels.map(label => `«${label}»`).join(', ')}{' '}
                    {narrowAoiLabels.length === 1 ? 'es más estrecha' : 'son más estrechas'} que ese margen: sus porcentajes son aproximados.
                </p>
            )}
        </div>
    );
};
