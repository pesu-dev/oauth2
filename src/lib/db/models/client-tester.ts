import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IClientTester extends Document {
  client_id: string;
  sub: string;
  added_at: Date;
}

export const ClientTesterSchema = new Schema<IClientTester>(
  {
    client_id: { type: String, required: true, index: true },
    sub: { type: String, required: true, index: true },
    added_at: { type: Date, default: Date.now },
  },
  { collection: 'client_testers' }
);
ClientTesterSchema.index({ client_id: 1, sub: 1 }, { unique: true });

export const ClientTester: Model<IClientTester> =
  mongoose.models.ClientTester ||
  mongoose.model<IClientTester>('ClientTester', ClientTesterSchema, 'client_testers');
