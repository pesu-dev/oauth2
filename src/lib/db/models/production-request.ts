import mongoose, { Schema, Document, Model } from 'mongoose';

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

export const ProductionRequestSchema = new Schema<IProductionRequest>(
  {
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
  },
  { collection: 'production_requests' }
);

export const ProductionRequest: Model<IProductionRequest> =
  mongoose.models.ProductionRequest ||
  mongoose.model<IProductionRequest>('ProductionRequest', ProductionRequestSchema, 'production_requests');
