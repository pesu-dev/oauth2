import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IRefreshToken extends Document {
  token_hash: string;
  family_id: string;
  client_id: string;
  sub: string;
  scopes: string[];
  revoked_at?: Date | null;
  created_at: Date;
}

export const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    token_hash: { type: String, required: true, unique: true, index: true },
    family_id: { type: String, required: true, index: true },
    client_id: { type: String, required: true },
    sub: { type: String, required: true, index: true },
    scopes: { type: [String], default: [] },
    revoked_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
  },
  { collection: 'refresh_tokens' }
);

export const RefreshToken: Model<IRefreshToken> =
  mongoose.models.RefreshToken ||
  mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema, 'refresh_tokens');
