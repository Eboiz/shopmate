import { notFound } from "next/navigation";
import { LoginForm } from "@/app/login/login-form";
import { LoginScreen } from "@/app/login/page";

export default function LoginPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LoginScreen><LoginForm next="/admin" preview /></LoginScreen>;
}
