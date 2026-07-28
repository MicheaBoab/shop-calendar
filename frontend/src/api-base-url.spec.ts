import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from './api-base-url';

describe('resolveApiBaseUrl', () => {
  it('prefers VITE_API_BASE_URL when provided', () => {
    expect(resolveApiBaseUrl({ envBaseUrl: 'https://api.example.com/' })).toBe('https://api.example.com');
  });

  it('builds URL from page hostname and protocol when env is missing', () => {
    expect(resolveApiBaseUrl({ hostname: '192.168.1.21', protocol: 'http:' })).toBe('http://192.168.1.21:3000');
  });

  it('keeps localhost usable by default fallback', () => {
    expect(resolveApiBaseUrl({ hostname: 'localhost', protocol: 'http:' })).toBe('http://localhost:3000');
  });

  it('falls back to http protocol when page protocol is invalid', () => {
    expect(resolveApiBaseUrl({ hostname: '192.168.1.21', protocol: 'file:' })).toBe('http://192.168.1.21:3000');
  });
});
