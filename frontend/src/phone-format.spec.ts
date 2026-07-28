import { describe, expect, it } from 'vitest';
import { formatPhoneForDisplay, normalizePhoneInput } from './phone-format';

describe('normalizePhoneInput', () => {
  it('keeps only digits', () => {
    expect(normalizePhoneInput('(123) 456-7890')).toBe('1234567890');
  });

  it('caps to 15 digits', () => {
    expect(normalizePhoneInput('12345678901234567890')).toBe('123456789012345');
  });

  it('supports a custom max digit cap', () => {
    expect(normalizePhoneInput('1234567890', 4)).toBe('1234');
  });
});

describe('formatPhoneForDisplay', () => {
  it('formats partial numbers as the user types', () => {
    expect(formatPhoneForDisplay('1')).toBe('(1__)___-____');
    expect(formatPhoneForDisplay('12')).toBe('(12_)___-____');
    expect(formatPhoneForDisplay('1234')).toBe('(123)4__-____');
    expect(formatPhoneForDisplay('1234567')).toBe('(123)456-7___');
  });

  it('formats 10-digit phone values as (xxx)xxx-xxxx', () => {
    expect(formatPhoneForDisplay('1234567890')).toBe('(123)456-7890');
  });

  it('keeps digits beyond 10 visible after a space', () => {
    expect(formatPhoneForDisplay('123456789012345')).toBe('(123)456-7890 12345');
  });

  it('returns empty string when no digits are present', () => {
    expect(formatPhoneForDisplay('() - ext')).toBe('');
  });
});
