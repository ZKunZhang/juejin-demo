import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, HttpError, type User } from '../api/api';

type Session = { user: User | null; loading: boolean; error: Error | null; retry: () => void; update: (user: User | null) => void };
const Context = createContext<Session | null>(null);
const key = ['session'];
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key, retry: false,
    queryFn: async ({ signal }) => {
      try { return await api<User>('/api/auth/me', 'GET', undefined, signal); }
      catch (error) { if (error instanceof HttpError && error.status === 401) return null; throw error; }
    },
  });
  function update(user: User | null) {
    void client.cancelQueries();
    client.removeQueries({ predicate: item => item.queryKey[0] !== 'session' });
    client.setQueryData(key, user);
  }
  return <Context.Provider value={{ user: query.data ?? null, loading: query.isPending, error: query.error, retry: () => { void query.refetch(); }, update }}>{children}</Context.Provider>;
}
export function useSession() {
  const context = useContext(Context);
  if (!context) throw new Error('Missing session provider');
  return context;
}
