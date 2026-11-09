export interface RegisterFormValues {
  name: string;
  phone: string;
  pin: string;
}

export type RegisterFieldErrors = Partial<Record<keyof RegisterFormValues, string>>;

/**
 * Client-side validation mirroring backend Zod rules:
 * - name: min 2 characters, max 100 characters
 * - phone: exactly 10 digits
 * - pin: exactly 6 digits
 */
export function validateRegisterForm(values: RegisterFormValues): RegisterFieldErrors {
  const errors: RegisterFieldErrors = {};

  const name = values.name.trim();
  if (!name || name.length < 2) {
    errors.name = 'Name must be at least 2 characters';
  } else if (name.length > 100) {
    errors.name = 'Name cannot exceed 100 characters';
  }

  const phone = values.phone.replace(/\D/g, '');
  if (!/^\d{10}$/.test(phone)) {
    errors.phone = 'Phone must be a 10-digit Indian mobile number';
  }

  if (!/^\d{6}$/.test(values.pin)) {
    errors.pin = 'PIN must be exactly 6 digits';
  }

  return errors;
}
