import mongoose, { Schema, Document, Model } from 'mongoose';
import { ConsentMode } from './consent';

export type DeviceCodeStatus = 'pending' | 'approved' | 'denied';

/** RFC 8628 device authorization grant: one pending sign-in started on an input-constrained device. */
export interface IDeviceCode extends Document {
  device_code_hash: string;
  /** SHA-256 of the normalized user code (8 chars, no dash). */
  user_code_hash: string;
  client_id: string;
  scopes: string[];
  status: DeviceCodeStatus;
  sub?: string | null;
  /** Set when the student approves. */
  mode?: ConsentMode;
  interval: number;
  last_polled_at?: Date | null;
  expires_at: Date;
  created_at: Date;
}

export const DeviceCodeSchema = new Schema<IDeviceCode>(
  {
    device_code_hash: { type: String, required: true, unique: true, index: true },
    user_code_hash: { type: String, required: true, unique: true, index: true },
    client_id: { type: String, required: true },
    scopes: { type: [String], default: [] },
    status: { type: String, enum: ['pending', 'approved', 'denied'], default: 'pending' },
    sub: { type: String, default: null },
    mode: { type: String, enum: ['identity', 'delegated'] },
    interval: { type: Number, default: 5 },
    last_polled_at: { type: Date, default: null },
    expires_at: { type: Date, required: true, expires: 0 },
    created_at: { type: Date, default: Date.now },
  },
  { collection: 'device_codes' }
);

export const DeviceCode: Model<IDeviceCode> =
  mongoose.models.DeviceCode ||
  mongoose.model<IDeviceCode>('DeviceCode', DeviceCodeSchema, 'device_codes');
