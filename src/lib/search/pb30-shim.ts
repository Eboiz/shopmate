// Stand-in for PB-30 (spec §3.3). Task 8 replaces every body with re-exports; do not add names here.

// Media types a search photo may use, exactly as PB-30 defines them.
export const PHOTO_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];
