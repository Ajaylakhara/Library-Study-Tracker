import mongoose, { Document, Schema } from 'mongoose';

export const TOTAL_SEATS = 70;

export interface ISeat extends Document {
  _id: mongoose.Types.ObjectId;
  number: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const seatSchema = new Schema<ISeat>(
  {
    number: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
      max: 70,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Indexes (number uniqueness is defined at field level)
seatSchema.index({ isActive: 1 });

export const Seat = mongoose.model<ISeat>('Seat', seatSchema);

export async function ensureSeats(): Promise<void> {
  const operations = Array.from({ length: TOTAL_SEATS }, (_, index) => {
    const number = index + 1;
    return {
      updateOne: {
        filter: { number },
        update: { $setOnInsert: { number, isActive: true } },
        upsert: true,
      },
    };
  });

  await Seat.bulkWrite(operations, { ordered: true });
}
