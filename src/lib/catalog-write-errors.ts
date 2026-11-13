// Turns the result of a catalog write (PB-16) into a message for the owner.
// Row Level Security hides rows instead of raising an error, so an update or
// delete that matched no row means "not found or not allowed" (PB-00).

export const NOT_ALLOWED = "Chỉ chủ shop được sửa dữ liệu này.";
export const NOT_FOUND = "Không tìm thấy dữ liệu, hãy tải lại trang.";
export const SAVE_FAILED = "Lưu không được, hãy thử lại.";
export const PAIRING_EXISTS = "Cặp này đã có rồi.";
export const POLICY_SAVE_FAILED = "Lưu chính sách không được, hãy tải lại trang rồi thử lại.";
export const SIZE_EXISTS = "Có size bị lặp. Mỗi size chỉ một dòng.";
export const SIZE_OVERLAP = "Có 2 size chồng khoảng chiều cao hoặc cân nặng. Hãy sửa rồi lưu lại.";

type DbError = { code?: string } | null;

// Each write says what its own failures mean: a unique violation is "this pair
// already exists" for a pairing, but for a policy it means another save created
// the row first. Without a duplicate message, it falls back to `failed`.
// An exclusion violation is a size chart whose ranges overlap (PB-24).
export type WriteMessages = { duplicate?: string; overlap?: string; failed?: string };

export function writeErrorMessage(
  error: DbError,
  changedRows: number,
  messages: WriteMessages = {},
): string | null {
  const failed = messages.failed ?? SAVE_FAILED;
  if (error) {
    switch (error.code) {
      case "42501": // insufficient_privilege: RLS refused an insert
        return NOT_ALLOWED;
      case "23505": // unique_violation
        return messages.duplicate ?? failed;
      case "23P01": // exclusion_violation
        return messages.overlap ?? failed;
      case "23503": // foreign_key_violation: product of another shop or deleted
      case "P0002": // no_data_found: raised by an RPC for an unknown row
        return NOT_FOUND;
      default:
        return failed;
    }
  }
  return changedRows === 0 ? NOT_FOUND : null;
}
