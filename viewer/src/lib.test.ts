import { describe, expect, it } from 'vitest';
import { clamp, formatDuration, urlBase64ToUint8Array } from './lib';

describe('lib', () => {
  it('clamp acota valores', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('formatea duraciones', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(9)).toBe('0:09');
  });

  it('convierte base64url a Uint8Array', () => {
    const bytes = urlBase64ToUint8Array('AQID');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});
