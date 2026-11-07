// `values` holds what the owner typed when the save failed. React resets a form
// after its action returns, so the fields read their default from here and the
// typed text isn't lost (review #8).
export type FormState = { error: string | null; values?: Record<string, string> };

export type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

export const INITIAL_FORM_STATE: FormState = { error: null };
