import mongoose, { Schema, Document, Model } from 'mongoose';

export type PublishingStatus = 'testing' | 'pending_production' | 'production' | 'suspended';

export interface IClient extends Document {
  client_id: string;
  client_secret_hash?: string | null;
  name: string;
  /** The developer who created the client (kept for audit and notifications). */
  owner_sub: string;
  /** Who manages the client: the creator alone, or a team. */
  owner_type: 'user' | 'team';
  /** team_id when owner_type is 'team'; unused for user-owned clients. */
  owner_team_id?: string | null;
  redirect_uris: string[];
  publishing_status: PublishingStatus;
  delegated_allowed: boolean;
  /** Resource scopes an admin approved (identity scopes are always allowed). */
  allowed_scopes: string[];
  /** Allows the RFC 8628 device authorization grant (TVs, CLIs, kiosks). */
  device_flow_enabled: boolean;
  /** Uploaded logo; shown on consent only once an admin approves it (anti-impersonation). */
  logo_image_id?: string | null;
  logo_status?: 'pending' | 'approved' | 'rejected' | null;
  token_endpoint_auth_method: string;
  suspension_reason?: string | null;
  suspended_at?: Date | null;
  suspended_by_sub?: string | null;
  created_at: Date;
  updated_at: Date;
}

export const ClientSchema = new Schema<IClient>(
  {
    client_id: { type: String, required: true, unique: true, index: true },
    client_secret_hash: { type: String, required: false, default: null },
    name: { type: String, required: true },
    owner_sub: { type: String, required: true, index: true },
    owner_type: { type: String, enum: ['user', 'team'], default: 'user' },
    owner_team_id: { type: String, default: null, index: true },
    redirect_uris: { type: [String], default: [] },
    publishing_status: {
      type: String,
      enum: ['testing', 'pending_production', 'production', 'suspended'],
      default: 'testing',
    },
    delegated_allowed: { type: Boolean, default: false },
    allowed_scopes: { type: [String], default: [] },
    device_flow_enabled: { type: Boolean, default: false },
    logo_image_id: { type: String, default: null },
    logo_status: { type: String, enum: ['pending', 'approved', 'rejected', null], default: null },
    token_endpoint_auth_method: { type: String, default: 'client_secret_post' },
    suspension_reason: { type: String, default: null },
    suspended_at: { type: Date, default: null },
    suspended_by_sub: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'clients' }
);

export const Client: Model<IClient> =
  mongoose.models.Client || mongoose.model<IClient>('Client', ClientSchema, 'clients');
