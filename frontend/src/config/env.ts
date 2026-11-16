/**
 * Validated environment variables and flags.
 */

// Production always uses the relative /api path: Vercel proxies it to the backend (see vercel.json),
// so the login cookie is first-party. Only local development may point somewhere else.
const apiUrl = import.meta.env.PROD ? '/api' : import.meta.env.VITE_API_URL || '/api';

export const ENV = {
  apiUrl,
  backendUrl: import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000',
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
  mode: import.meta.env.MODE,
} as const;
