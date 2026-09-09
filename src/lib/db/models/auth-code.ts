import mongoose, { Schema, Document, Model } from 'mongoose';
import { ConsentMode } from './consent';

export interface IAuthCode extends Document {
  code_hash: string;
  client_id: string;
  sub: string;
  scopes: string[];
  mode: ConsentMode;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  created_at: Date;
}

export const AuthCodeSchema = new Schema<IAuthCode>(
  {
    code_hash: { type: String, required: true, unique: true, index: true },
    client_id: { type: String, required: true },
    sub: { type: String, required: true },
    scopes: { type: [String], default: [] },
    mode: { type: String, enum: ['identity', 'delegated'], required: true },
    redirect_uri: { type: String, required: true },
    code_challenge: { type: String, required: true },
    code_challenge_method: { type: String, default: 'S256' },
    created_at: { type: Date, default: Date.now, expires: 600 }, // 10 minutes TTL
  },
  { collection: 'authorization_codes' }
);

export const AuthCode: Model<IAuthCode> =
  mongoose.models.AuthCode ||
  mongoose.model<IAuthCode>('AuthCode', AuthCodeSchema, 'authorization_codes');
