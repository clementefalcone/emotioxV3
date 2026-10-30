import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CustomSelect } from '../ui/CustomSelect';
import { researchService } from '../../services/research.service';
import { researchKeys, useResearch } from '../../hooks/useResearchQuery';
import { useToast } from '../../hooks/useToast';

const DEFAULT_RETENTION_MONTHS = 12;
const RETENTION_OPTIONS = [3, 6, 12, 24].map(months => ({ value: String(months), label: `${months} meses` }));

export const BiometricRetentionSection = ({ researchId }: { researchId: string }) => {
    const queryClient = useQueryClient();
    const toast = useToast();
    const { data: research } = useResearch(researchId);
    const retentionMonths = Number(research?.settings?.biometricDataRetentionMonths) || DEFAULT_RETENTION_MONTHS;

    const setRetention = useMutation({
        mutationFn: (months: number) =>
            researchService.update(researchId, { settings: { ...(research?.settings ?? {}), biometricDataRetentionMonths: months } }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: researchKeys.detail(researchId) }),
        onError: (err: unknown) => toast.error(`No se pudo guardar el plazo de retención: ${err instanceof Error ? err.message : String(err)}`),
    });

    return (
        <div className="space-y-2 p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-900">Retención de datos biométricos</h3>
            <p className="text-xs text-gray-500">
                Las respuestas de Eye Tracking y Emotion Analysis se borran automáticamente al cumplir este plazo.
            </p>
            <CustomSelect
                options={RETENTION_OPTIONS}
                value={String(retentionMonths)}
                onChange={(value) => setRetention.mutate(Number(value))}
            />
        </div>
    );
};
