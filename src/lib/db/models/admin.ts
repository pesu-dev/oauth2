import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAdmin extends Document {
  sub: string;
  added_at: Date;
}

export const AdminSchema = new Schema<IAdmin>(
  {
    sub: { type: String, required: true, unique: true, index: true },
    added_at: { type: Date, default: Date.now },
  },
  { collection: 'admins' }
);

export const Admin: Model<IAdmin> =
  mongoose.models.Admin || mongoose.model<IAdmin>('Admin', AdminSchema, 'admins');
