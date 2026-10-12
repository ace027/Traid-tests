import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from './routes';
import { startEventStream } from './lib/events';
import { ApiError } from './lib/api';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Client errors (bad key, not found, validation) won't fix themselves.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

export interface AppProps {
  queryClient?: QueryClient;
  router?: ReturnType<typeof createAppRouter>;
}

export default function App({ queryClient: qc, router: r }: AppProps = {}) {
  const [queryClient] = useState(() => qc ?? createQueryClient());
  const [router] = useState(() => r ?? createAppRouter());

  // One realtime stream for the app's lifetime; keeps queries fresh.
  useEffect(() => startEventStream(queryClient), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
