import mongoose, { Document, Model, Schema } from 'mongoose';

export const DEFAULT_LIBRARY_NAME = 'Library Study Tracker';
export const DEFAULT_LIBRARY_SHORT_NAME = 'LST';
export const DEFAULT_LIBRARY_TAGLINE = 'Learn · Focus · Grow';

export interface ILibrarySettings extends Document {
  key: string;
  libraryName: string;
  shortName: string;
  tagline: string;
  logo: string | null;
  favicon: string | null;
  contactPhone: string;
  updatedAt: Date;
  updatedBy: mongoose.Types.ObjectId | null;
}

const librarySettingsSchema = new Schema<ILibrarySettings>(
  {
    key: { type: String, required: true, unique: true, default: 'primary' },
    libraryName: { type: String, required: true, default: DEFAULT_LIBRARY_NAME, trim: true },
    shortName: { type: String, required: true, default: DEFAULT_LIBRARY_SHORT_NAME, trim: true },
    tagline: { type: String, required: true, default: DEFAULT_LIBRARY_TAGLINE, trim: true },
    logo: { type: String, default: null },
    favicon: { type: String, default: null },
    contactPhone: { type: String, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export interface ILibrarySettingsModel extends Model<ILibrarySettings> {}

export const LibrarySettings = mongoose.model<ILibrarySettings, ILibrarySettingsModel>(
  'LibrarySettings',
  librarySettingsSchema
);
