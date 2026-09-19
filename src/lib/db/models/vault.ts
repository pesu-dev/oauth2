import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IVault extends Document {
  sub: string;
  nonce: Buffer;
  ciphertext: Buffer;
  wrap_nonce: Buffer;
  wrapped_dek: Buffer;
  key_version: number;
  session_expires_at?: Date | null;
  updated_at: Date;
}

export const VaultSchema = new Schema<IVault>(
  {
    sub: { type: String, required: true, unique: true, index: true },
    nonce: { type: Buffer, required: true },
    ciphertext: { type: Buffer, required: true },
    wrap_nonce: { type: Buffer, required: true },
    wrapped_dek: { type: Buffer, required: true },
    key_version: { type: Number, default: 1 },
    session_expires_at: { type: Date },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'vault' }
);

export const Vault: Model<IVault> =
  mongoose.models.Vault || mongoose.model<IVault>('Vault', VaultSchema, 'vault');
