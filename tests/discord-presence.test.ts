import { describe, expect, it } from 'vitest';
import { encodeFrame } from '../src/main/discord-presence';

describe('Discord RPC framing', () => {
  it('encodes the little-endian header and JSON body in one frame', () => {
    const payload = { v: 1, client_id: '123456789012345678' };
    const frame = encodeFrame(0, payload);
    expect(frame.readUInt32LE(0)).toBe(0);
    expect(frame.readUInt32LE(4)).toBe(frame.length - 8);
    expect(JSON.parse(frame.subarray(8).toString('utf8'))).toEqual(payload);
  });
});
