import mongoose from 'mongoose';
import {
  DEFAULT_LIBRARY_NAME,
  DEFAULT_LIBRARY_SHORT_NAME,
  DEFAULT_LIBRARY_TAGLINE,
  ILibrarySettings,
  LibrarySettings,
} from '../models/LibrarySettings';

export interface PublicLibrarySettings {
  libraryName: string;
  shortName: string;
  tagline: string;
  logo: string | null;
  favicon: string | null;
  updatedAt: string;
}

const DEFAULT_SETTINGS = {
  key: 'primary',
  libraryName: DEFAULT_LIBRARY_NAME,
  shortName: DEFAULT_LIBRARY_SHORT_NAME,
  tagline: DEFAULT_LIBRARY_TAGLINE,
  logo: null,
  favicon: null,
  contactPhone: '',
  updatedBy: null,
};

export async function getLibrarySettings(): Promise<ILibrarySettings> {
  let settings;
  try {
    settings = await LibrarySettings.findOneAndUpdate(
      { key: 'primary' },
      { $setOnInsert: DEFAULT_SETTINGS },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    settings = await LibrarySettings.findOne({ key: 'primary' });
  }
  if (!settings) throw new Error('Library settings could not be loaded.');
  return settings;
}

export function toPublicLibrarySettings(settings: ILibrarySettings): PublicLibrarySettings {
  return {
    libraryName: settings.libraryName,
    shortName: settings.shortName,
    tagline: settings.tagline,
    logo: settings.logo,
    favicon: settings.favicon,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export async function getLibraryNameOrDefault(): Promise<string> {
  try {
    return (await getLibrarySettings()).libraryName || DEFAULT_LIBRARY_NAME;
  } catch {
    console.warn('Library settings unavailable; using the default library name.');
    return DEFAULT_LIBRARY_NAME;
  }
}

export async function updateLibrarySettings(
  changes: Partial<Pick<ILibrarySettings, 'libraryName' | 'shortName' | 'tagline' | 'logo' | 'favicon' | 'contactPhone'>>,
  updatedBy: mongoose.Types.ObjectId
): Promise<ILibrarySettings> {
  const settings = await LibrarySettings.findOneAndUpdate(
    { key: 'primary' },
    { $set: { ...changes, updatedBy } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  if (!settings) throw new Error('Library settings could not be saved.');
  return settings;
}
