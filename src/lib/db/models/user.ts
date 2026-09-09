import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  sub: string;
  name: string;
  prn: string;
  srn: string;
  program: string;
  branch: string;
  semester: string;
  section: string;
  campus: string;
  email?: string;
  phone?: string;
  created_at: Date;
  last_login_at: Date;
  deleted_at?: Date | null;
}

export const UserSchema = new Schema<IUser>(
  {
    sub: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    prn: { type: String, required: true },
    srn: { type: String, required: true },
    program: { type: String, default: '' },
    branch: { type: String, default: '' },
    semester: { type: String, default: '' },
    section: { type: String, default: '' },
    campus: { type: String, default: '' },
    email: { type: String },
    phone: { type: String },
    created_at: { type: Date, default: Date.now },
    last_login_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  { collection: 'users' }
);

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>('User', UserSchema, 'users');
