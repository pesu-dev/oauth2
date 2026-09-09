import mongoose, { Schema, Document, Model } from 'mongoose';

export type PublishingStatus = 'testing' | 'pending_production' | 'production';

export interface IClient extends Document {
  client_id: string;
  client_secret_hash: string;
  name: string;
  owner_sub: string;
  redirect_uris: string[];
  publishing_status: PublishingStatus;
  delegated_allowed: boolean;
  token_endpoint_auth_method: string;
  created_at: Date;
  updated_at: Date;
}

export const ClientSchema = new Schema<IClient>(
  {
    client_id: { type: String, required: true, unique: true, index: true },
    client_secret_hash: { type: String, required: true },
    name: { type: String, required: true },
    owner_sub: { type: String, required: true, index: true },
    redirect_uris: { type: [String], required: true },
    publishing_status: {
      type: String,
      enum: ['testing', 'pending_production', 'production'],
      default: 'testing',
    },
    delegated_allowed: { type: Boolean, default: false },
    token_endpoint_auth_method: { type: String, default: 'client_secret_post' },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'clients' }
);

export const Client: Model<IClient> =
  mongoose.models.Client || mongoose.model<IClient>('Client', ClientSchema, 'clients');
