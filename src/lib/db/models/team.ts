import mongoose, { Schema, Document, Model } from 'mongoose';

/** A club or project group that can own OAuth clients together. */
export interface ITeam extends Document {
  team_id: string;
  name: string;
  slug: string;
  avatar_id?: string | null;
  created_by_sub: string;
  created_at: Date;
  updated_at: Date;
}

export const TeamSchema = new Schema<ITeam>(
  {
    team_id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    avatar_id: { type: String, default: null },
    created_by_sub: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'teams' }
);

export const Team: Model<ITeam> = mongoose.models.Team || mongoose.model<ITeam>('Team', TeamSchema, 'teams');
