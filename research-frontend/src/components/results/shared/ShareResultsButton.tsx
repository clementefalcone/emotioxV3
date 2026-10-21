import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Share2, Check, Lock } from 'lucide-react';
import { type Research, researchService } from '../../../services/research.service';
import { researchKeys } from '../../../hooks/useResearchQuery';
import { useToast } from '../../../hooks/useToast';

const COPIED_FEEDBACK_MS = 2000;

export const ShareResultsButton = ({ research }: { research: Research }) => {
    const queryClient = useQueryClient();
    const toast = useToast();
    const [copied, setCopied] = useState(false);
    const isPublic = research.settings?.publicResults === true;

    const setPublicResults = useMutation({
        mutationFn: (publicResults: boolean) =>
            researchService.update(research.id, { settings: { ...(research.settings ?? {}), publicResults } }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: researchKeys.detail(research.id) }),
    });

    const handleShare = async () => {
        try {
            if (!isPublic) await setPublicResults.mutateAsync(true);
            await navigator.clipboard.writeText(`${window.location.origin}/research/results/${research.id}`);
            setCopied(true);
            setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
        } catch (err) {
            console.error(JSON.stringify({ event: 'share_results_failed', researchId: research.id, error: err instanceof Error ? err.message : String(err) }));
            toast.error('No se pudo compartir el link de resultados');
        }
    };

    const handleMakePrivate = async () => {
        try {
            await setPublicResults.mutateAsync(false);
            toast.success('El link de resultados ya no es público');
        } catch (err) {
            console.error(JSON.stringify({ event: 'unshare_results_failed', researchId: research.id, error: err instanceof Error ? err.message : String(err) }));
            toast.error('No se pudo desactivar el link público');
        }
    };

    return (
        <div className="flex items-center">
            <button
                onClick={handleShare}
                disabled={setPublicResults.isPending}
                title="Anyone with the link can view the results without signing in"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors disabled:opacity-50 ${isPublic ? 'rounded-l-lg' : 'rounded-lg'}`}
            >
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Share2 className="h-3.5 w-3.5" />}
                {copied ? 'Copied!' : isPublic ? 'Copy public link' : 'Share'}
            </button>
            {isPublic && (
                <button
                    onClick={handleMakePrivate}
                    disabled={setPublicResults.isPending}
                    title="Make results private"
                    aria-label="Make results private"
                    className="flex items-center px-2 py-1.5 text-gray-500 bg-gray-50 border border-l-0 border-gray-200 rounded-r-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                    <Lock className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
};
