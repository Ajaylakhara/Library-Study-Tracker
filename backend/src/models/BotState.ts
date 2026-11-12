import { Document, Schema, model } from 'mongoose';

export interface IBotState extends Document {
  chatId: string;
  action: 'fee_search';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const botStateSchema = new Schema<IBotState>(
  {
    chatId: { type: String, required: true },
    action: { type: String, enum: ['fee_search'], required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

botStateSchema.index({ chatId: 1 }, { unique: true });
botStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const BotState = model<IBotState>('BotState', botStateSchema);
