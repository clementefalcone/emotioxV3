import { useState, useCallback, useEffect } from 'react';
import { Drawer } from '../ui/Drawer';
import { UserPlus, X, User, Trash2, Loader2 } from 'lucide-react';
import apiClient from '../../services/api/client';
import { CustomSelect } from '../ui/CustomSelect';

const PERMISSION_OPTIONS = [
    { value: 'editor', label: 'Can edit' },
    { value: 'viewer', label: 'View only' },
];

const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(PERMISSION_OPTIONS.map((option) => [option.value, option.label]));

interface Collaborator {
    id: string;
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    permission: string;
    createdAt: string;
}

interface ShareResearchDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    researchId: string;
    isOwner: boolean;
}

export const ShareResearchDrawer = ({ isOpen, onClose, researchId, isOwner }: ShareResearchDrawerProps) => {
    const [email, setEmail] = useState('');
    const [permission, setPermission] = useState('editor');
    const [loading, setLoading] = useState(false);
    const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
    const [collabLoading, setCollabLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [removingId, setRemovingId] = useState<string | null>(null);

    const loadCollaborators = useCallback(async () => {
        setCollabLoading(true);
        try {
            const res = await apiClient.get<{ collaborators: Collaborator[] }>(`/research/${researchId}/collaborators`);
            setCollaborators(res.collaborators || []);
        } catch {
            setCollaborators([]);
        } finally {
            setCollabLoading(false);
        }
    }, [researchId]);

    useEffect(() => {
        if (isOpen) {
            void loadCollaborators();
            setError(null);
            setSuccessMsg(null);
            setEmail('');
        }
    }, [isOpen, loadCollaborators]);

    const handleAdd = useCallback(async () => {
        const trimmed = email.trim().toLowerCase();
        if (!trimmed || !trimmed.includes('@')) return;

        setLoading(true);
        setError(null);
        setSuccessMsg(null);

        try {
            await apiClient.post(`/research/${researchId}/collaborators`, { email: trimmed, permission });
            setSuccessMsg(`${trimmed} added as collaborator`);
            setEmail('');
            void loadCollaborators();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to add collaborator';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [email, permission, researchId, loadCollaborators]);

    const handleRemove = useCallback(async (collaboratorId: string) => {
        setRemovingId(collaboratorId);
        try {
            await apiClient.delete(`/research/${researchId}/collaborators/${collaboratorId}`);
            setCollaborators((prev) => prev.filter((c) => c.id !== collaboratorId));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to remove collaborator';
            setError(msg);
        } finally {
            setRemovingId(null);
        }
    }, [researchId]);

    return (
        <Drawer
            isOpen={isOpen}
            onClose={onClose}
            title="Share Research"
            width="md"
            footer={
                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                    >
                        Close
                    </button>
                </div>
            }
        >
            <div className="space-y-5">
                <p className="text-sm text-gray-500">
                    Add users so they can see this research in their dashboard and access its results.
                </p>

                {isOwner && (
                    <div>
                        <label className="text-sm font-medium text-gray-700 mb-1.5 block">Add collaborator by email</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="email"
                                placeholder="email@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void handleAdd();
                                    }
                                }}
                                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                autoFocus
                            />
                            <CustomSelect
                                options={PERMISSION_OPTIONS}
                                value={permission}
                                onChange={setPermission}
                                className="w-32"
                            />
                            <button
                                type="button"
                                onClick={() => void handleAdd()}
                                disabled={!email.trim() || !email.includes('@') || loading}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                                Add
                            </button>
                        </div>
                        <p className="mt-1.5 text-xs text-gray-400">The user must already have an EmotioX account.</p>
                    </div>
                )}

                {error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                        <div className="flex items-start gap-2">
                            <p className="text-sm text-red-700 flex-1">{error}</p>
                            <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                )}

                {successMsg && (
                    <p className="text-sm text-green-600">{successMsg}</p>
                )}

                {/* Collaborators list */}
                <div className="border-t border-gray-200 pt-4">
                    <h3 className="text-sm font-medium text-gray-900 mb-3">
                        Collaborators
                        {collaborators.length > 0 && <span className="ml-1.5 text-xs text-gray-400">({collaborators.length})</span>}
                    </h3>
                    {collabLoading ? (
                        <div className="space-y-2">
                            {Array.from({ length: 2 }).map((_, i) => (
                                <div key={i} className="animate-pulse h-10 bg-gray-100 rounded-lg" />
                            ))}
                        </div>
                    ) : collaborators.length === 0 ? (
                        <p className="text-sm text-gray-400">Add team members by email to share access to this research.</p>
                    ) : (
                        <div className="space-y-2">
                            {collaborators.map((collab) => (
                                <div key={collab.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <User className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-sm text-gray-700 truncate">{collab.email}</p>
                                            {(collab.firstName || collab.lastName) && (
                                                <p className="text-xs text-gray-400 truncate">
                                                    {[collab.firstName, collab.lastName].filter(Boolean).join(' ')}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 ml-3 shrink-0">
                                        <span className="text-xs text-gray-400">{PERMISSION_LABELS[collab.permission]}</span>
                                        {isOwner && (
                                            <button
                                                type="button"
                                                onClick={() => void handleRemove(collab.id)}
                                                disabled={removingId === collab.id}
                                                className="text-gray-400 hover:text-red-500 disabled:opacity-50"
                                                title="Remove collaborator"
                                            >
                                                {removingId === collab.id ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Drawer>
    );
};
