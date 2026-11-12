import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { ILibrarySettings } from '../models/LibrarySettings';
import { User } from '../models/User';
import { getLibrarySettings, toPublicLibrarySettings, updateLibrarySettings } from '../services/librarySettings';

const noHtml = (value: string) => !/[<>]/.test(value);
const brandingSchema = z.object({
  libraryName: z.string().trim().min(2).max(60).refine(noHtml, 'HTML is not allowed in names.').optional(),
  shortName: z.string().trim().min(2).max(60).refine(noHtml, 'HTML is not allowed in names.').optional(),
  tagline: z.string().trim().max(120).refine(noHtml, 'HTML is not allowed in the tagline.').optional(),
  logo: z.string().nullable().optional(),
  favicon: z.string().nullable().optional(),
  contactPhone: z.string().trim().max(20).regex(/^(?:\+?[0-9][0-9 -]{6,18})?$/, 'Enter a valid contact phone number.').optional(),
}).strict();

const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Display name must be at least 2 characters.')
    .max(60, 'Display name cannot exceed 60 characters.')
    .refine(noHtml, 'HTML is not allowed in the display name.'),
}).strict();

const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function decodeImageDataUrl(value: string, field: 'logo' | 'favicon'): { dataUrl: string; size: number } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || !MIME_TYPES.has(match[1])) {
    throw createError(`${field === 'logo' ? 'Logo' : 'Favicon'} must be a PNG, JPEG, or WebP data URL. SVG is not supported.`, 400);
  }

  const [, declaredMime, base64] = match;
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.toString('base64') !== base64) {
    throw createError(`${field === 'logo' ? 'Logo' : 'Favicon'} image data is invalid.`, 400);
  }

  const isPng =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP';
  const actualMime = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : null;

  if (!actualMime || actualMime !== declaredMime) {
    throw createError(`${field === 'logo' ? 'Logo' : 'Favicon'} image content does not match its declared type.`, 400);
  }

  const maxBytes = field === 'logo' ? 300 * 1024 : 100 * 1024;
  if (bytes.length > maxBytes) {
    throw createError(`${field === 'logo' ? 'Logo' : 'Favicon'} must be ${field === 'logo' ? '300 KB' : '100 KB'} or smaller.`, 413);
  }

  return { dataUrl: value, size: bytes.length };
}

function validateImageField(value: string | null | undefined, field: 'logo' | 'favicon'): string | null | undefined {
  if (value === undefined || value === null || value === '') return value === undefined ? undefined : null;
  return decodeImageDataUrl(value, field).dataUrl;
}

function adminSettingsResponse(settings: ILibrarySettings) {
  return {
    libraryName: settings.libraryName,
    shortName: settings.shortName,
    tagline: settings.tagline,
    logo: settings.logo,
    favicon: settings.favicon,
    contactPhone: settings.contactPhone,
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedBy?.toString() ?? null,
  };
}

export async function getPublicSettings(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await getLibrarySettings();
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    res.json({ success: true, data: toPublicLibrarySettings(settings) });
  } catch (error) {
    next(error);
  }
}

export async function getAdminSettings(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const settings = await getLibrarySettings();
    res.json({ success: true, data: adminSettingsResponse(settings) });
  } catch (error) {
    next(error);
  }
}

export async function putAdminSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = brandingSchema.parse(req.body);
    if (Object.keys(body).length === 0) throw createError('Provide at least one setting to update.', 400);

    const changes: Partial<Pick<ILibrarySettings, 'libraryName' | 'shortName' | 'tagline' | 'logo' | 'favicon' | 'contactPhone'>> = {
      ...body,
      ...(body.logo !== undefined && { logo: validateImageField(body.logo, 'logo') ?? null }),
      ...(body.favicon !== undefined && { favicon: validateImageField(body.favicon, 'favicon') ?? null }),
    };
    const settings = await updateLibrarySettings(changes, req.user!._id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, message: 'Library branding saved.', data: adminSettingsResponse(settings) });
  } catch (error) {
    next(error);
  }
}

export async function updateAdminDisplayName(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { displayName } = profileSchema.parse(req.body);
    const result = await User.updateOne(
      { _id: req.user!._id, role: 'admin', isDeleted: false },
      { $set: { name: displayName } }
    );
    if (result.matchedCount !== 1) throw createError('Admin profile was not found.', 404);
    res.json({ success: true, message: 'Admin display name updated.', data: { displayName } });
  } catch (error) {
    next(error);
  }
}
