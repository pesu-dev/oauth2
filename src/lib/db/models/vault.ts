import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IVault extends Document {
  sub: string;
  encrypted_password: string; // Base64
  password_nonce: string; // Base64
  password_wrap_nonce: string; // Base64
  password_wrapped_dek: string; // Base64
  encrypted_session?: string; // Base64
  session_nonce?: string;
  session_wrap_nonce?: string;
  session_wrapped_dek?: string;
  session_expires_at?: Date | null;
  key_version: number;
  updated_at: Date;
}

export const VaultSchema = new Schema<IVault>(
  {
    sub: { type: String, required: true, unique: true, index: true },
    encrypted_password: { type: String, required: true },
    password_nonce: { type: String, required: true },
    password_wrap_nonce: { type: String, required: true },
    password_wrapped_dek: { type: String, required: true },
    encrypted_session: { type: String },
    session_nonce: { type: String },
    session_wrap_nonce: { type: String },
    session_wrapped_dek: { type: String },
    session_expires_at: { type: Date },
    key_version: { type: Number, default: 1 },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'vault' }
);

export const Vault: Model<IVault> =
  mongoose.models.Vault || mongoose.model<IVault>('Vault', VaultSchema, 'vault');
