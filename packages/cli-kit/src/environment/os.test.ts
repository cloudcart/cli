import { describe, it, expect } from 'vitest';
import { getOS, getArch, getOSInfo, checkNodeVersion } from './os.js';

describe('os', () => {
  it('returns a platform string', () => {
    expect(typeof getOS()).toBe('string');
    expect(getOS().length).toBeGreaterThan(0);
  });

  it('returns an arch string', () => {
    expect(typeof getArch()).toBe('string');
  });

  it('returns OS info object', () => {
    const info = getOSInfo();
    expect(info).toHaveProperty('platform');
    expect(info).toHaveProperty('arch');
    expect(info).toHaveProperty('release');
  });

  it('checkNodeVersion passes for current runtime', () => {
    expect(checkNodeVersion('20.0.0')).toBe(true);
  });

  it('checkNodeVersion fails for future version', () => {
    expect(checkNodeVersion('999.0.0')).toBe(false);
  });
});
