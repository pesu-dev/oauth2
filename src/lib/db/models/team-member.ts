import mongoose, { Schema, Document, Model } from 'mongoose';

export type TeamRole = 'owner' | 'admin' | 'developer';

export interface ITeamMember extends Document {
  team_id: string;
  sub: string;
  role: TeamRole;
  added_by_sub?: string | null;
  added_at: Date;
}

export const TeamMemberSchema = new Schema<ITeamMember>(
  {
    team_id: { type: String, required: true, index: true },
    sub: { type: String, required: true, index: true },
    role: { type: String, enum: ['owner', 'admin', 'developer'], required: true },
    added_by_sub: { type: String, default: null },
    added_at: { type: Date, default: Date.now },
  },
  { collection: 'team_members' }
);
TeamMemberSchema.index({ team_id: 1, sub: 1 }, { unique: true });

export const TeamMember: Model<ITeamMember> =
  mongoose.models.TeamMember || mongoose.model<ITeamMember>('TeamMember', TeamMemberSchema, 'team_members');
