import { describe, expect, it } from 'vitest';
import { ACTIVITY_TTL_MS, encodeFrame, findActivePlayback } from '../src/main/discord-presence';
import type { WatchEvent } from '../src/shared/types';

describe('Discord RPC framing', () => {
  it('encodes the little-endian header and JSON body in one frame', () => {
    const payload = { v: 1, client_id: '123456789012345678' };
    const frame = encodeFrame(0, payload);
    expect(frame.readUInt32LE(0)).toBe(0);
    expect(frame.readUInt32LE(4)).toBe(frame.length - 8);
    expect(JSON.parse(frame.subarray(8).toString('utf8'))).toEqual(payload);
  });

  it('clears playback after two minutes without a progress update', () => {
    const now = Date.parse('2026-08-19T10:00:00.000Z');
    const event = {
      observedAt: new Date(now - ACTIVITY_TTL_MS - 1).toISOString(),
      status: 'watching',
    } as WatchEvent;
    expect(findActivePlayback([event], now)).toBeUndefined();

    event.observedAt = new Date(now - ACTIVITY_TTL_MS + 1).toISOString();
    expect(findActivePlayback([event], now)).toBe(event);
  });
});
