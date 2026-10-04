import { describe, it, expect } from 'vitest';
import {
  localStreamIds,
  markApprovalResolved,
  shouldShowBackgroundApproval,
} from '../../src/renderer/src/lib/local-streams';

// Ids are unique per test so the module-level sets need no reset hook.
describe('background approval pickup', () => {
  it('shows an approval for a stream no chat view is watching', () => {
    expect(shouldShowBackgroundApproval('s-unwatched', 'c1')).toBe(true);
  });

  it('leaves an approval to the chat view that owns the stream', () => {
    localStreamIds.add('s-local');
    expect(shouldShowBackgroundApproval('s-local', 'c1')).toBe(false);
  });

  it('drops an approval answered during the pickup delay', () => {
    markApprovalResolved('s-quick', 'c1');
    expect(shouldShowBackgroundApproval('s-quick', 'c1')).toBe(false);
  });

  it('still shows a different approval on the same stream', () => {
    markApprovalResolved('s-two', 'c1');
    expect(shouldShowBackgroundApproval('s-two', 'c2')).toBe(true);
  });
});
