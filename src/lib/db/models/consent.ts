import mongoose, { Schema, Document, Model } from 'mongoose';

export type ConsentMode = 'identity' | 'delegated';

export interface IConsent extends Document {
  sub: string;
  client_id: string;
  scopes: string[];
  mode: ConsentMode;
  granted_at: Date;
}

export const ConsentSchema = new Schema<IConsent>(
  {
    sub: { type: String, required: true, index: true },
    client_id: { type: String, required: true, index: true },
    scopes: { type: [String], default: [] },
    mode: { type: String, enum: ['identity', 'delegated'], required: true },
    granted_at: { type: Date, default: Date.now },
  },
  { collection: 'consents' }
);
ConsentSchema.index({ sub: 1, client_id: 1 }, { unique: true });

export const Consent: Model<IConsent> =
  mongoose.models.Consent || mongoose.model<IConsent>('Consent', ConsentSchema, 'consents');
