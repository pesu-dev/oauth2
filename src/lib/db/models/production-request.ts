import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IProductionRequest extends Document {
  request_id: string;
  client_id: string;
  requested_by_sub: string;
  owner_sub?: string;
  status: 'pending' | 'approved' | 'rejected';
  delegated_requested: boolean;
  justification?: string;
  created_at: Date;
  resolved_at?: Date | null;
  resolved_by_sub?: string | null;
  reviewed_at?: Date;
  reviewer_sub?: string;
}

export const ProductionRequestSchema = new Schema<IProductionRequest>(
  {
    request_id: { type: String, required: true, unique: true, index: true },
    client_id: { type: String, required: true, index: true },
    requested_by_sub: { type: String, required: true },
    owner_sub: { type: String },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    delegated_requested: { type: Boolean, default: false },
    justification: { type: String },
    created_at: { type: Date, default: Date.now },
    resolved_at: { type: Date },
    resolved_by_sub: { type: String },
    reviewed_at: { type: Date },
    reviewer_sub: { type: String },
  },
  { collection: 'production_requests' }
);

ProductionRequestSchema.index({ status: 1, created_at: 1 });

export const ProductionRequest: Model<IProductionRequest> =
  mongoose.models.ProductionRequest ||
  mongoose.model<IProductionRequest>('ProductionRequest', ProductionRequestSchema, 'production_requests');
