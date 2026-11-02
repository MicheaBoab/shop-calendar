import { describe, expect, it } from 'vitest';
import {
  applyPhoneInputEdit,
  formatPhoneForDisplay,
  normalizePhoneInput,
  reconcilePhoneInputValue,
} from './phone-format';

describe('normalizePhoneInput', () => {
  it('keeps only digits', () => {
    expect(normalizePhoneInput('(123) 456-7890')).toBe('1234567890');
  });

  it('caps to 10 digits', () => {
    expect(normalizePhoneInput('12345678901234567890')).toBe('1234567890');
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

  it('truncates digits beyond 10 in display', () => {
    expect(formatPhoneForDisplay('123456789012345')).toBe('(123)456-7890');
  });

  it('returns empty string when no digits are present', () => {
    expect(formatPhoneForDisplay('() - ext')).toBe('');
  });
});

describe('phone input editing', () => {
  const fullDigits = '1234567890';
  const fullDisplay = formatPhoneForDisplay(fullDigits);

  it.each([
    ['backspace at the end', 13, 13, 'deleteContentBackward', '123456789'],
    ['backspace beside formatting', 5, 5, 'deleteContentBackward', '124567890'],
    ['delete forward beside formatting', 4, 4, 'deleteContentForward', '123567890'],
    ['delete a selected digit range', 1, 3, 'deleteContentBackward', '34567890'],
  ])('%s removes only the intended digits', (_label, start, end, inputType, expected) => {
    const result = applyPhoneInputEdit(fullDigits, fullDisplay, start, end, inputType);
    expect(result.digits).toBe(expected);
    expect(result.changed).toBe(true);
    expect(result.selectionStart).toBe(result.selectionEnd);
  });

  it('preserves a selection containing only formatting characters', () => {
    const result = applyPhoneInputEdit(fullDigits, fullDisplay, 4, 5, 'deleteContentBackward');
    expect(result).toEqual({
      digits: fullDigits,
      selectionStart: 4,
      selectionEnd: 5,
      changed: false,
    });
  });

  it('clears all digits when the whole formatted value is selected', () => {
    const result = applyPhoneInputEdit(fullDigits, fullDisplay, 0, fullDisplay.length, 'deleteContentBackward');
    expect(result.digits).toBe('');
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(0);
  });

  it('inserts digits at a middle caret and replaces selected digits with pasted text', () => {
    const inserted = applyPhoneInputEdit(fullDigits, fullDisplay, 5, 5, 'insertText', '9');
    expect(inserted.digits).toBe('1239456789');
    expect(inserted.selectionStart).toBe(6);

    const replaced = applyPhoneInputEdit(fullDigits, fullDisplay, 1, 3, 'insertFromPaste', '(98)');
    expect(replaced.digits).toBe('9834567890');
    expect(replaced.selectionStart).toBe(3);
  });

  it('falls back to the browser-mutated value while retaining a logical caret', () => {
    const result = reconcilePhoneInputValue(fullDigits, '(123)456-789_', 12);
    expect(result.digits).toBe('123456789');
    expect(result.selectionStart).toBe(12);
    expect(result.selectionEnd).toBe(12);
  });
});
