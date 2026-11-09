/**
 * Validated environment variables and flags.
 */

const apiUrl = import.meta.env.VITE_API_URL;
if (!apiUrl) {
  throw new Error('VITE_API_URL environment variable is required.');
}

export const ENV = {
  apiUrl,
  backendUrl: import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000',
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
  mode: import.meta.env.MODE,
} as const;
