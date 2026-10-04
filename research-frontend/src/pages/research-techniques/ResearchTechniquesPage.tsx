import { useState, useEffect } from 'react';
import { FileText, Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { researchTechniquesService, type ResearchTechnique } from '../../services/researchTechniques.service';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../hooks/useToast';
import { SearchInput } from '../../components/ui/SearchInput';
import { useAuthStore } from '../../stores/auth.store';

export const ResearchTechniquesPage = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
    const [searchQuery, setSearchQuery] = useState('');
    const [techniques, setTechniques] = useState<ResearchTechnique[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [techniqueToDelete, setTechniqueToDelete] = useState<ResearchTechnique | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        loadTechniques();
    }, []);

    const loadTechniques = async () => {
        try {
            setIsLoading(true);
            const response = await researchTechniquesService.list();
            setTechniques(response.researchTechniques);
        } catch (err) {
            setError('Failed to load research techniques');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteClick = (technique: ResearchTechnique) => {
        setTechniqueToDelete(technique);
        setDeleteModalOpen(true);
    };

    const handleConfirmDelete = async () => {
        if (!techniqueToDelete) return;

        try {
            setIsDeleting(true);
            await researchTechniquesService.delete(techniqueToDelete.id);
            await loadTechniques();
            setDeleteModalOpen(false);
            setTechniqueToDelete(null);
        } catch (error) {
            console.error('Failed to delete research technique:', error);
            toast.error('Failed to delete research technique');
        } finally {
            setIsDeleting(false);
        }
    };

    const filteredTechniques = techniques.filter(tech =>
        tech.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tech.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="h-full p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Research Techniques</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Manage research techniques and their configurations
                    </p>
                </div>
                {isAdmin && (
                    <Button onClick={() => navigate('/research-techniques/new')}>
                        <Plus className="h-4 w-4 mr-2" />
                        Create Technique
                    </Button>
                )}
            </div>

            <div className="w-full max-w-md">
                <SearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search research techniques..."
                />
            </div>

            {isLoading ? (
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-500">Loading research techniques...</p>
                </div>
            ) : error ? (
                <div className="text-center py-12 text-red-600">
                    {error}
                </div>
            ) : techniques.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
                        <FileText className="h-6 w-6 text-blue-600" />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-gray-900">No research techniques found</h3>
                    <p className="mt-2 text-gray-500">
                        Get started by creating a new research technique.
                    </p>
                    {isAdmin && (
                        <div className="mt-6">
                            <Button onClick={() => navigate('/research-techniques/new')}>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Technique
                            </Button>
                        </div>
                    )}
                </div>
            ) : filteredTechniques.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                    {searchQuery ? 'No research techniques found matching your search.' : 'No research techniques found. Create one to get started.'}
                </div>
            ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {filteredTechniques.map((technique) => (
                        <div
                            key={technique.id}
                            className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow relative"
                        >
                            {/* Action buttons - top right */}
                            {isAdmin && (
                                <div className="absolute top-4 right-4 flex gap-2">
                                    <button
                                        onClick={() => navigate(`/research-techniques/${technique.id}`)}
                                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                        title="Edit"
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteClick(technique)}
                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                        title="Delete"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            )}

                            {/* Icon */}
                            <div className="mb-4">
                                <div className="inline-flex p-3 bg-blue-50 rounded-lg">
                                    <FileText className="h-6 w-6 text-blue-600" />
                                </div>
                            </div>

                            {/* Content */}
                            <h3 className="text-lg font-semibold text-gray-900 mb-2 pr-16">
                                {technique.name}
                            </h3>
                            <p className="text-sm text-gray-500 line-clamp-3 mb-4">
                                {technique.description || 'No description provided'}
                            </p>
                            <div className="text-xs text-gray-400">
                                Updated {new Date(technique.updated_at || technique.created_at).toLocaleDateString()}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <ConfirmationModal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleConfirmDelete}
                title="Delete Research Technique"
                message={`Are you sure you want to delete "${techniqueToDelete?.name}"? This action cannot be undone.`}
                confirmText="Delete"
                variant="danger"
                isLoading={isDeleting}
            />
        </div>
    );
};
