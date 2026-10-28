"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { LOGIN_PATH, safeNextPath } from "@/lib/auth-routes";
import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginState = { error: string | null };

export async function signIn(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Email hoặc mật khẩu không hợp lệ." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: "Sai email hoặc mật khẩu." };
  }

  redirect(safeNextPath(formData.get("next")?.toString()));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(LOGIN_PATH);
}
