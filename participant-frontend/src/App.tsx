import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';

// Lazy load pages for code splitting
const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })));
const ResearchPage = lazy(() => import('./pages/ResearchPage').then(m => ({ default: m.ResearchPage })));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen bg-gray-50">
    <div className="text-center">
      <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
      <p className="mt-4 text-gray-600">Loading...</p>
    </div>
  </div>
);

// Use different basename for development vs production
const basename = import.meta.env.DEV ? '/' : '/participant';

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<PageLoader />}>
        <HomePage />
      </Suspense>
    ),
  },
  {
    path: '/research/:researchId',
    element: (
      <Suspense fallback={<PageLoader />}>
        <ResearchPage />
      </Suspense>
    ),
  },
  ...(import.meta.env.DEV ? [
    { path: '/eye-tracking-hybrid', Component: lazy(() => import('./pages/EyeTrackingHybridPage').then(m => ({ default: m.EyeTrackingHybridPage }))) },
    { path: '/test/eye-tracking-v2', Component: lazy(() => import('./pages/EyeTrackingV2TestPage').then(m => ({ default: m.EyeTrackingV2TestPage }))) },
    { path: '/test/gaze-compare', Component: lazy(() => import('./pages/GazeComparePage').then(m => ({ default: m.GazeComparePage }))) },
    { path: '/test/gaze-capture', Component: lazy(() => import('./pages/GazeCapturePage').then(m => ({ default: m.GazeCapturePage }))) },
    { path: '/test/expression-capture', Component: lazy(() => import('./pages/ExpressionCapturePage').then(m => ({ default: m.ExpressionCapturePage }))) },
    { path: '/test/expression-eval', Component: lazy(() => import('./pages/ExpressionEvalPage').then(m => ({ default: m.ExpressionEvalPage }))) },
  ].map(({ path, Component }) => ({
    path,
    element: (
      <Suspense fallback={<PageLoader />}>
        <Component />
      </Suspense>
    ),
  })) : []),
], {
  basename,
});

function App() {
  return (
    <QueryProvider>
      <RouterProvider router={router} />
    </QueryProvider>
  );
}

export default App;
