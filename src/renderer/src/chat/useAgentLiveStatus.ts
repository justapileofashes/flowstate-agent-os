import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import type { ActiveStreamsBroadcast } from '@shared/ipc-channels';

export type AgentLiveStatus = 'idle' | 'streaming';

export function useAgentLiveStatus(): Map<string, AgentLiveStatus> {
  const [active, setActive] = useState<ActiveStreamsBroadcast['active']>([]);

  useEffect(() => {
    const unsub = ipc.chat.subscribeToActiveStreams((payload) => {
      setActive(payload.active);
    });
    return unsub;
  }, []);

  const map = new Map<string, AgentLiveStatus>();
  for (const entry of active) {
    map.set(entry.agentId, 'streaming');
  }
  return map;
}
