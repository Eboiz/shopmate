export type FormState = { error: string | null };

export type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

export const INITIAL_FORM_STATE: FormState = { error: null };
