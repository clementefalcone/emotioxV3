import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
vi.mock('pdfjs-dist', () => ({ getDocument: vi.fn(), GlobalWorkerOptions: {} }));

import { routesConfig } from '../routes';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { useAuthStore } from '../../stores/auth.store';
import { ToastProvider } from '../../contexts/ToastContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const ADMIN_ONLY_PATHS = [
    '/admin/users',
    '/modules/new',
    '/modules/:id',
    '/research-types/new',
    '/research-types/:id',
    '/research-types/:id/module-template-assignation',
    '/research-techniques/new',
    '/research-techniques/:id',
];

const renderAs = (role: string | null, element: ReactNode) => {
    useAuthStore.setState({ user: role ? { role } : null, isLoading: false } as never);
    render(
        <QueryClientProvider client={new QueryClient()}>
            <ToastProvider>
                <MemoryRouter initialEntries={['/page']}>
                    <Routes>
                        <Route path="/page" element={element} />
                        <Route path="/dashboard" element={<p>dashboard</p>} />
                        <Route path="/login" element={<p>login</p>} />
                    </Routes>
                </MemoryRouter>
            </ToastProvider>
        </QueryClientProvider>,
    );
};

describe('admin-only routes', () => {
    it.each(ADMIN_ONLY_PATHS)('sends a researcher from %s to the dashboard', (path) => {
        renderAs('researcher', routesConfig.find((route) => route.path === path)?.element);

        expect(screen.getByText('dashboard')).toBeInTheDocument();
    });

    it('sends a visitor without session from /admin/users to login', () => {
        renderAs(null, routesConfig.find((route) => route.path === '/admin/users')?.element);

        expect(screen.getByText('login')).toBeInTheDocument();
    });

    it('lets an admin through', () => {
        renderAs('admin', <ProtectedRoute requireAdmin><p>admin page</p></ProtectedRoute>);

        expect(screen.getByText('admin page')).toBeInTheDocument();
    });
});
