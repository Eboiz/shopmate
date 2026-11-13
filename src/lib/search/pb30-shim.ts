// PB-34 Task 8: the photo rules come from PB-30 (spec §3.3). This file only
// re-exports them so the search code keeps one import path.
export { MAX_PHOTO_BYTES, PHOTO_MEDIA_TYPES, type PhotoInput, type PhotoMediaType } from "@/contract";
export { PHOTO_ERRORS, checkPhoto } from "@/lib/chat/photo-rules";
export { photoDecision, preparePhoto } from "@/lib/chat/prepare-photo";
