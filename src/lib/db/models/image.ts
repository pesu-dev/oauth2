import mongoose, { Schema, Document, Model } from 'mongoose';

export type ImageKind = 'client_logo' | 'team_avatar';

/** Small uploaded images (logos, avatars) stored in Mongo so no extra storage service is needed. */
export interface IImage extends Document {
  image_id: string;
  kind: ImageKind;
  /** client_id or team_id the image belongs to. */
  owner_ref: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  data: Buffer;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  created_by_sub: string;
  created_at: Date;
}

export const ImageSchema = new Schema<IImage>(
  {
    image_id: { type: String, required: true, unique: true, index: true },
    kind: { type: String, enum: ['client_logo', 'team_avatar'], required: true },
    owner_ref: { type: String, required: true, index: true },
    mime: { type: String, enum: ['image/png', 'image/jpeg', 'image/webp'], required: true },
    data: { type: Buffer, required: true },
    bytes: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    sha256: { type: String, required: true },
    created_by_sub: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
  },
  { collection: 'images' }
);

export const Image: Model<IImage> =
  mongoose.models.Image || mongoose.model<IImage>('Image', ImageSchema, 'images');
