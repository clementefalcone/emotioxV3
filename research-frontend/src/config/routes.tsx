import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { LoginPage } from '../pages/auth/LoginPage';
import { AuthCallbackPage } from '../pages/auth/AuthCallbackPage';
import { ProfilePage } from '../pages/profile/ProfilePage';
import { ErrorPage } from '../pages/ErrorPage';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { ResearchPage } from '../pages/research/ResearchPage';
import { ResearchHistoryPage } from '../pages/research/ResearchHistoryPage';
import { ResearchTrackingPage } from '../pages/research/ResearchTrackingPage';
import { ClientsPage } from '../pages/clients/ClientsPage';
import { ResearchProgressPage } from '../pages/research/ResearchProgressPage';
import { ModulesPage } from '../pages/modules/ModulesPage';
import { ModuleBuilderPage } from '../pages/modules/ModuleBuilderPage';
import { ResearchTypesPage } from '../pages/research-types/ResearchTypesPage';
import { ResearchTypeBuilderPage } from '../pages/research-types/ResearchTypeBuilderPage';
import { ModuleTemplateAssignationPage } from '../pages/research-types/ModuleTemplateAssignationPage';
import { ResearchTechniquesPage } from '../pages/research-techniques/ResearchTechniquesPage';
import { ResearchTechniqueBuilderPage } from '../pages/research-techniques/ResearchTechniqueBuilderPage';
import { UserManagementPage } from '../pages/admin/UserManagementPage';
import { PublicProgressPage } from '../pages/public/PublicProgressPage';
import { PublicResultsPage } from '../pages/public/PublicResultsPage';

const withPageSuspense = (element: ReactNode): ReactNode => (
    <Suspense
        fallback={(
            <div className="flex min-h-[50vh] items-center justify-center">
                <div
                    className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600"
                    aria-hidden
                />
            </div>
        )}
    >
        {element}
    </Suspense>
);

const EyeTrackingLabPage = lazy(() =>
    import('../pages/labs/EyeTrackingLabPage').then(m => ({ default: m.EyeTrackingLabPage })),
);

const ResearchBuilderPage = lazy(() =>
    import('../pages/research/ResearchBuilderPage').then(m => ({ default: m.ResearchBuilderPage })),
);

const ResearchResultsPage = lazy(() =>
    import('../pages/research/ResearchResultsPage').then(m => ({ default: m.ResearchResultsPage })),
);

export interface RouteConfig {
    path: string;
    element: ReactNode;
    layout?: 'auth' | 'dashboard' | 'none';
    isProtected?: boolean;
    errorBoundary?: {
        context?: 'auth' | 'dashboard' | 'general';
        pageName?: string;
    };
}

/**
 * Centralized configuration of all routes
 * Facilitates maintenance and scalability
 */
export const routesConfig: RouteConfig[] = [
    // Public routes - Authentication
    {
        path: '/login',
        element: <LoginPage />,
        layout: 'auth',
        errorBoundary: { context: 'auth', pageName: 'Login' },
    },
{
        path: '/auth/callback',
        element: <AuthCallbackPage />,
        layout: 'none',
        errorBoundary: { context: 'auth', pageName: 'Auth Callback' },
    },

    {
        path: '/admin/users',
        element: <ProtectedRoute requireAdmin><UserManagementPage /></ProtectedRoute>,
        layout: 'none',
        errorBoundary: { context: 'general', pageName: 'User Management' },
    },

    {
        path: '/labs/eye-tracking',
        element: (
            <ProtectedRoute>
                <Suspense
                    fallback={
                        <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
                            <div
                                className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-blue-500"
                                aria-hidden
                            />
                        </div>
                    }
                >
                    <EyeTrackingLabPage />
                </Suspense>
            </ProtectedRoute>
        ),
        layout: 'none',
        errorBoundary: { context: 'general', pageName: 'Eye Tracking Lab' },
    },

    // Protected routes - Dashboard
    {
        path: '/dashboard',
        element: <DashboardPage />,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Dashboard' },
    },
    {
        path: '/profile',
        element: <ProfilePage />,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Profile' },
    },
    {
        path: '/research',
        element: <ResearchPage />,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research' },
    },
    {
        path: '/research/:id/builder',
        element: withPageSuspense(<ResearchBuilderPage />),
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research Builder' },
    },
    {
        path: '/research/:id/builder/settings',
        element: withPageSuspense(<ResearchBuilderPage />),
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research Settings' },
    },
    {
        path: '/research/:id/builder/module/:moduleId',
        element: withPageSuspense(<ResearchBuilderPage />),
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research Module Builder' },
    },
    {
        path: '/research/:id/builder/stage/:stageId',
        element: withPageSuspense(<ResearchBuilderPage />),
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research Stage Builder' },
    },
    {
        path: '/research/:id/builder/stimulus/:stimulusId',
        element: withPageSuspense(<ResearchBuilderPage />),
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research Stimulus Analysis' },
    },
    {
        path: '/research/:id/builder/progress',
        element: <ResearchProgressPage />,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research Progress' },
    },
    {
        path: '/research/:id/builder/results',
        element: withPageSuspense(<ResearchResultsPage />),
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research Results' },
    },
    {
        path: '/research-tracking',
        element: <ResearchTrackingPage />,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research Tracking' },
    },
    {
        path: '/research-history',
        element: <ResearchHistoryPage />,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research History' },
    },
    {
        path: '/clients',
        element: <ClientsPage />,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Clients' },
    },
    {
        path: '/modules',
        element: <ModulesPage />,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Modules' },
    },
    {
        path: '/modules/new',
        element: <ProtectedRoute requireAdmin><ModuleBuilderPage /></ProtectedRoute>,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Create Module' },
    },
    {
        path: '/modules/:id',
        element: <ProtectedRoute requireAdmin><ModuleBuilderPage /></ProtectedRoute>,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Edit Module' },
    },
    {
        path: '/research-types',
        element: <ResearchTypesPage />,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research Types' },
    },
    {
        path: '/research-types/new',
        element: <ProtectedRoute requireAdmin><ResearchTypeBuilderPage /></ProtectedRoute>,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Create Research Type' },
    },
    {
        path: '/research-types/:id',
        element: <ProtectedRoute requireAdmin><ResearchTypeBuilderPage /></ProtectedRoute>,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Edit Research Type' },
    },
    {
        path: '/research-types/:id/module-template-assignation',
        element: <ProtectedRoute requireAdmin><ModuleTemplateAssignationPage /></ProtectedRoute>,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Assign Module Templates' },
    },
    {
        path: '/research-techniques',
        element: <ResearchTechniquesPage />,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Research Techniques' },
    },
    {
        path: '/research-techniques/new',
        element: <ProtectedRoute requireAdmin><ResearchTechniqueBuilderPage /></ProtectedRoute>,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Create Research Technique' },
    },
    {
        path: '/research-techniques/:id',
        element: <ProtectedRoute requireAdmin><ResearchTechniqueBuilderPage /></ProtectedRoute>,
        layout: 'dashboard',
        isProtected: true,
        errorBoundary: { context: 'dashboard', pageName: 'Edit Research Technique' },
    },

    // Public pages (no auth)
    {
        path: '/progress/:id',
        element: <PublicProgressPage />,
        layout: 'none',
        errorBoundary: { context: 'general', pageName: 'Public Progress' },
    },
    {
        path: '/results/:id',
        element: <PublicResultsPage />,
        layout: 'none',
        errorBoundary: { context: 'general', pageName: 'Public Results' },
    },

    // Default redirect (must be before catch-all)
    {
        path: '/',
        element: <Navigate to="/dashboard" replace />,
        layout: 'none',
    },

    // 404 error route (must be last)
    {
        path: '*',
        element: <ErrorPage />,
        layout: 'none',
    },
];
