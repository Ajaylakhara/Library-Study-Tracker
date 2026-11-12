import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { loadBranding } from './brandingThunks';

export interface BrandingSettings {
  libraryName: string;
  shortName: string;
  tagline: string;
  logo: string | null;
  favicon: string | null;
  contactPhone?: string;
  updatedAt?: string;
  updatedBy?: string | null;
}

export const DEFAULT_BRANDING: BrandingSettings = {
  libraryName: 'Library Study Tracker',
  shortName: 'LST',
  tagline: 'Learn · Focus · Grow',
  logo: null,
  favicon: null,
  contactPhone: '',
};

interface BrandingState {
  settings: BrandingSettings;
  loaded: boolean;
}

const initialState: BrandingState = { settings: DEFAULT_BRANDING, loaded: false };

const brandingSlice = createSlice({
  name: 'branding',
  initialState,
  reducers: {
    brandingUpdated(state, action: PayloadAction<BrandingSettings>) {
      state.settings = action.payload;
      state.loaded = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadBranding.fulfilled, (state, action) => {
        state.settings = { ...DEFAULT_BRANDING, ...action.payload };
        state.loaded = true;
      })
      .addCase(loadBranding.rejected, (state) => {
        state.settings = DEFAULT_BRANDING;
        state.loaded = true;
      });
  },
});

export const { brandingUpdated } = brandingSlice.actions;
export default brandingSlice.reducer;
