import { safeRequestUrl } from './safe-request-url';

describe('credential-safe request URLs', () => {
  it.each([
    ['/appointments/stream?accessToken=secret', '/appointments/stream'],
    [
      '/appointments/stream?accessToken=one&accessToken=two&shop=a',
      '/appointments/stream?shop=a',
    ],
    ['/appointments?%61ccessToken=encoded', '/appointments'],
    ['/appointments?phone=123', '/appointments?phone=123'],
    ['/appointments', '/appointments'],
  ])('sanitizes %s', (url, expected) => {
    expect(safeRequestUrl(url)).toBe(expected);
  });
});
