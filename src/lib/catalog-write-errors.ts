// Turns the result of a catalog write (PB-16) into a message for the owner.
// Row Level Security hides rows instead of raising an error, so an update or
// delete that matched no row means "not found or not allowed" (PB-00).

export const NOT_ALLOWED = "Chỉ chủ shop được sửa dữ liệu này.";
export const NOT_FOUND = "Không tìm thấy dữ liệu, hãy tải lại trang.";
export const SAVE_FAILED = "Lưu không được, hãy thử lại.";
export const PAIRING_EXISTS = "Cặp này đã có rồi.";

type DbError = { code?: string } | null;

export function writeErrorMessage(error: DbError, changedRows: number): string | null {
  if (error) {
    switch (error.code) {
      case "42501": // insufficient_privilege: RLS refused an insert
        return NOT_ALLOWED;
      case "23505": // unique_violation: pairings_one_row_per_pair
        return PAIRING_EXISTS;
      case "23503": // foreign_key_violation: product of another shop or deleted
        return NOT_FOUND;
      default:
        return SAVE_FAILED;
    }
  }
  return changedRows === 0 ? NOT_FOUND : null;
}
