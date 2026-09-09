import mongoose, { Schema, Document, Model } from 'mongoose';

// -------------------------------------------------------------
// 1. User
// -------------------------------------------------------------
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

const UserSchema = new Schema<IUser>({
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
});

// -------------------------------------------------------------
// 2. Client
// -------------------------------------------------------------
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

const ClientSchema = new Schema<IClient>({
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
});

// -------------------------------------------------------------
// 3. Client Tester
// -------------------------------------------------------------
export interface IClientTester extends Document {
  client_id: string;
  sub: string;
  added_at: Date;
}

const ClientTesterSchema = new Schema<IClientTester>({
  client_id: { type: String, required: true, index: true },
  sub: { type: String, required: true, index: true },
  added_at: { type: Date, default: Date.now },
});
ClientTesterSchema.index({ client_id: 1, sub: 1 }, { unique: true });

// -------------------------------------------------------------
// 4. Consent
// -------------------------------------------------------------
export type ConsentMode = 'identity' | 'delegated';

export interface IConsent extends Document {
  sub: string;
  client_id: string;
  scopes: string[];
  mode: ConsentMode;
  granted_at: Date;
}

const ConsentSchema = new Schema<IConsent>({
  sub: { type: String, required: true, index: true },
  client_id: { type: String, required: true, index: true },
  scopes: { type: [String], default: [] },
  mode: { type: String, enum: ['identity', 'delegated'], required: true },
  granted_at: { type: Date, default: Date.now },
});
ConsentSchema.index({ sub: 1, client_id: 1 }, { unique: true });

// -------------------------------------------------------------
// 5. Vault
// -------------------------------------------------------------
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
  session_expires_at?: Date;
  key_version: number;
  updated_at: Date;
}

const VaultSchema = new Schema<IVault>({
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
});

// -------------------------------------------------------------
// 6. AuthCode
// -------------------------------------------------------------
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

const AuthCodeSchema = new Schema<IAuthCode>({
  code_hash: { type: String, required: true, unique: true, index: true },
  client_id: { type: String, required: true },
  sub: { type: String, required: true },
  scopes: { type: [String], default: [] },
  mode: { type: String, enum: ['identity', 'delegated'], required: true },
  redirect_uri: { type: String, required: true },
  code_challenge: { type: String, required: true },
  code_challenge_method: { type: String, default: 'S256' },
  created_at: { type: Date, default: Date.now, expires: 600 }, // 10 minutes TTL
});

// -------------------------------------------------------------
// 7. RefreshToken
// -------------------------------------------------------------
export interface IRefreshToken extends Document {
  token_hash: string;
  family_id: string;
  client_id: string;
  sub: string;
  scopes: string[];
  revoked_at?: Date | null;
  created_at: Date;
}

const RefreshTokenSchema = new Schema<IRefreshToken>({
  token_hash: { type: String, required: true, unique: true, index: true },
  family_id: { type: String, required: true, index: true },
  client_id: { type: String, required: true },
  sub: { type: String, required: true, index: true },
  scopes: { type: [String], default: [] },
  revoked_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },
});

// -------------------------------------------------------------
// 8. ProductionRequest
// -------------------------------------------------------------
export interface IProductionRequest extends Document {
  request_id: string;
  client_id: string;
  owner_sub: string;
  status: 'pending' | 'approved' | 'rejected';
  justification: string;
  created_at: Date;
  reviewed_at?: Date;
  reviewer_sub?: string;
}

const ProductionRequestSchema = new Schema<IProductionRequest>({
  request_id: { type: String, required: true, unique: true, index: true },
  client_id: { type: String, required: true, index: true },
  owner_sub: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  justification: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  reviewed_at: { type: Date },
  reviewer_sub: { type: String },
});

// -------------------------------------------------------------
// 9. Admin
// -------------------------------------------------------------
export interface IAdmin extends Document {
  sub: string;
  added_at: Date;
}

const AdminSchema = new Schema<IAdmin>({
  sub: { type: String, required: true, unique: true, index: true },
  added_at: { type: Date, default: Date.now },
});

// Export or initialize models safely across HMR
export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export const Client: Model<IClient> =
  mongoose.models.Client || mongoose.model<IClient>('Client', ClientSchema);

export const ClientTester: Model<IClientTester> =
  mongoose.models.ClientTester ||
  mongoose.model<IClientTester>('ClientTester', ClientTesterSchema);

export const Consent: Model<IConsent> =
  mongoose.models.Consent || mongoose.model<IConsent>('Consent', ConsentSchema);

export const Vault: Model<IVault> =
  mongoose.models.Vault || mongoose.model<IVault>('Vault', VaultSchema);

export const AuthCode: Model<IAuthCode> =
  mongoose.models.AuthCode || mongoose.model<IAuthCode>('AuthCode', AuthCodeSchema);

export const RefreshToken: Model<IRefreshToken> =
  mongoose.models.RefreshToken ||
  mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);

export const ProductionRequest: Model<IProductionRequest> =
  mongoose.models.ProductionRequest ||
  mongoose.model<IProductionRequest>('ProductionRequest', ProductionRequestSchema);

export const Admin: Model<IAdmin> =
  mongoose.models.Admin || mongoose.model<IAdmin>('Admin', AdminSchema);
