import type { QueryClient } from '@tanstack/react-query';

export function refreshFollowState(client: QueryClient) {
  return Promise.all(
    ['interaction', 'following', 'profile', 'pulses', 'featured-pulses', 'pulse-detail'].map(name =>
      client.invalidateQueries({ queryKey: [name] })),
  );
}
