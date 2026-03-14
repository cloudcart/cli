import { describe, it, expect } from 'vitest';
import { formatJson, formatStoreUrl, truncate } from './format.js';

describe('format', () => {
  describe('formatJson', () => {
    it('pretty-prints JSON', () => {
      const result = formatJson({ foo: 'bar' });
      expect(result).toBe('{\n  "foo": "bar"\n}');
    });
  });

  describe('formatStoreUrl', () => {
    it('strips protocol', () => {
      expect(formatStoreUrl('https://shop.cloudcart.com')).toBe('shop.cloudcart.com');
    });

    it('strips trailing slash', () => {
      expect(formatStoreUrl('https://shop.cloudcart.com/')).toBe('shop.cloudcart.com');
    });

    it('handles plain domain', () => {
      expect(formatStoreUrl('shop.cloudcart.com')).toBe('shop.cloudcart.com');
    });
  });

  describe('truncate', () => {
    it('returns string unchanged if within limit', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('truncates with ellipsis', () => {
      expect(truncate('hello world', 6)).toBe('hello…');
    });

    it('handles exact length', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });
  });
});
