const MAX_PHONE_DIGITS = 10;

export const normalizePhoneInput = (value: string, maxDigits: number = MAX_PHONE_DIGITS) => {
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.slice(0, Math.max(0, maxDigits));
};

export const formatPhoneForDisplay = (digits: string) => {
  const normalized = normalizePhoneInput(digits);
  if (!normalized) {
    return '';
  }

  const coreDigits = normalized.slice(0, 10);
  const extraDigits = normalized.slice(10);

  const baseMask = '(xxx)xxx-xxxx';
  let digitIndex = 0;
  const formatted = baseMask.replace(/x/g, () => {
    const nextDigit = coreDigits[digitIndex];
    digitIndex += 1;
    return nextDigit ?? '_';
  });

  return extraDigits ? `${formatted} ${extraDigits}` : formatted;
};

export interface PhoneInputEdit {
  digits: string;
  selectionStart: number;
  selectionEnd: number;
  changed: boolean;
}

const countDigitsBefore = (value: string, offset: number) => {
  return (value.slice(0, Math.max(0, offset)).match(/\d/g) ?? []).length;
};

const getCaretOffset = (digits: string, digitIndex: number) => {
  if (!digits) {
    return 0;
  }

  const display = formatPhoneForDisplay(digits);
  const targetIndex = Math.min(digits.length, Math.max(0, digitIndex));
  if (targetIndex === 0) {
    return display.search(/\d/);
  }

  let seen = 0;
  for (let offset = 0; offset < display.length; offset += 1) {
    if (/\d/.test(display[offset])) {
      seen += 1;
      if (seen === targetIndex) {
        return offset + 1;
      }
    }
  }

  return display.length;
};

export const applyPhoneInputEdit = (
  currentDigits: string,
  displayValue: string,
  selectionStart: number,
  selectionEnd: number,
  inputType: string,
  inputData: string | null = null,
): PhoneInputEdit => {
  const digits = normalizePhoneInput(currentDigits);
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const digitStart = countDigitsBefore(displayValue, start);
  const digitEnd = countDigitsBefore(displayValue, end);

  if (inputType.startsWith('delete')) {
    let removeStart = digitStart;
    let removeEnd = digitEnd;

    if (start === end) {
      if (inputType.toLowerCase().includes('backward')) {
        removeStart = Math.max(0, digitStart - 1);
        removeEnd = digitStart;
      } else {
        removeStart = digitStart;
        removeEnd = Math.min(digits.length, digitStart + 1);
      }
    }

    if (removeStart === removeEnd) {
      return { digits, selectionStart, selectionEnd, changed: false };
    }

    const nextDigits = `${digits.slice(0, removeStart)}${digits.slice(removeEnd)}`;
    const caret = getCaretOffset(nextDigits, removeStart);
    return {
      digits: nextDigits,
      selectionStart: caret,
      selectionEnd: caret,
      changed: nextDigits !== digits,
    };
  }

  if (!inputType.startsWith('insert')) {
    return { digits, selectionStart, selectionEnd, changed: false };
  }

  const inserted = normalizePhoneInput(inputData ?? '');
  const availableDigits = Math.max(0, MAX_PHONE_DIGITS - digitStart);
  const accepted = inserted.slice(0, availableDigits);
  const nextDigits = normalizePhoneInput(`${digits.slice(0, digitStart)}${accepted}${digits.slice(digitEnd)}`);
  const caret = getCaretOffset(nextDigits, digitStart + accepted.length);

  if (nextDigits === digits) {
    return { digits, selectionStart, selectionEnd, changed: false };
  }

  return {
    digits: nextDigits,
    selectionStart: caret,
    selectionEnd: caret,
    changed: true,
  };
};

export const reconcilePhoneInputValue = (
  currentDigits: string,
  inputValue: string,
  selectionStart: number,
): PhoneInputEdit => {
  const digits = normalizePhoneInput(currentDigits);
  const nextDigits = normalizePhoneInput(inputValue);
  const caretIndex = countDigitsBefore(inputValue, selectionStart);
  const caret = getCaretOffset(nextDigits, caretIndex);

  return {
    digits: nextDigits,
    selectionStart: caret,
    selectionEnd: caret,
    changed: nextDigits !== digits,
  };
};

export { MAX_PHONE_DIGITS };
