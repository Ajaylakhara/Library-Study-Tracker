import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';

export interface AppError extends Error {
  statusCode?: number;
  code?: number; // MongoDB error code
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Never leak stack traces in production
  const isDev = process.env.NODE_ENV !== 'production';

  // Mongoose duplicate key error (code 11000)
  if (err.code === 11000) {
    const message = buildDuplicateKeyMessage(err);
    res.status(409).json({ success: false, message });
    return;
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    res.status(400).json({ success: false, message: 'Validation failed', errors });
    return;
  }

  // Mongoose CastError (invalid ObjectId etc.)
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ success: false, message: `Invalid ${err.path}: ${err.value}` });
    return;
  }

  // Mongoose ValidationError
  if (err instanceof mongoose.Error.ValidationError) {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    res.status(400).json({ success: false, message: 'Validation failed', errors });
    return;
  }

  const statusCode = err.statusCode ?? (err as AppError & { status?: number }).status ?? 500;
  const message =
    statusCode >= 500 && !isDev ? 'Something went wrong. Please try again.' : err.message;

  res.status(statusCode).json({
    success: false,
    message,
    ...(isDev && statusCode >= 500 ? { stack: err.stack } : {}),
  });
}

function buildDuplicateKeyMessage(err: AppError): string {
  const msg = err.message ?? '';
  if (msg.includes('unique_active_seat') || msg.includes('seat')) {
    return 'Seat is occupied or you are already checked in. Please wait or contact admin.';
  }
  if (msg.includes('unique_active_student') || msg.includes('student')) {
    return 'Seat is occupied or you are already checked in. Please wait or contact admin.';
  }
  if (msg.includes('phone')) {
    return 'This phone number is already registered.';
  }
  if (msg.includes('Fee') || msg.includes('month')) {
    return 'Fee for this month already exists for this student.';
  }
  if (msg.includes('unique_session_notification')) {
    return 'Notification already exists for this session and type.';
  }
  return 'A duplicate entry was detected. Please try again.';
}

/** Create a typed error with a status code */
export function createError(message: string, statusCode = 400): AppError {
  const err: AppError = new Error(message);
  err.statusCode = statusCode;
  return err;
}
