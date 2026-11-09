import mongoose, { Document, Schema } from 'mongoose';

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
