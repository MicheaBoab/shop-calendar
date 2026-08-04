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

export { MAX_PHONE_DIGITS };
