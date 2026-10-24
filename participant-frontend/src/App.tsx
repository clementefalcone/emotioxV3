import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';

// Lazy load pages for code splitting
const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })));
const ResearchPage = lazy(() => import('./pages/ResearchPage').then(m => ({ default: m.ResearchPage })));
const EyeTrackingHybridPage = lazy(() => import('./pages/EyeTrackingHybridPage').then(m => ({ default: m.EyeTrackingHybridPage })));
const EyeTrackingV2TestPage = lazy(() => import('./pages/EyeTrackingV2TestPage').then(m => ({ default: m.EyeTrackingV2TestPage })));
const GazeComparePage = lazy(() => import('./pages/GazeComparePage').then(m => ({ default: m.GazeComparePage })));
const GazeCapturePage = lazy(() => import('./pages/GazeCapturePage').then(m => ({ default: m.GazeCapturePage })));
const ExpressionCapturePage = lazy(() => import('./pages/ExpressionCapturePage').then(m => ({ default: m.ExpressionCapturePage })));

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
  {
    path: '/eye-tracking-hybrid',
    element: (
      <Suspense fallback={<PageLoader />}>
        <EyeTrackingHybridPage />
      </Suspense>
    ),
  },
  {
    path: '/test/eye-tracking-v2',
    element: (
      <Suspense fallback={<PageLoader />}>
        <EyeTrackingV2TestPage />
      </Suspense>
    ),
  },
  {
    path: '/test/gaze-compare',
    element: (
      <Suspense fallback={<PageLoader />}>
        <GazeComparePage />
      </Suspense>
    ),
  },
  {
    path: '/test/gaze-capture',
    element: (
      <Suspense fallback={<PageLoader />}>
        <GazeCapturePage />
      </Suspense>
    ),
  },
  {
    path: '/test/expression-capture',
    element: (
      <Suspense fallback={<PageLoader />}>
        <ExpressionCapturePage />
      </Suspense>
    ),
  },
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
