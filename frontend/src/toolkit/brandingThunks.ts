import { createAppThunk } from './createAppThunk';
import { get } from '../store/api';
import { ENDPOINTS } from '../config/endpoints';
import type { BrandingSettings } from './brandingSlice';

export const loadBranding = createAppThunk('branding/load', async () => {
  const response = await get<BrandingSettings>(ENDPOINTS.settings.public);
  return response.data;
});
