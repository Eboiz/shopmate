import { redirect } from "next/navigation";
import { ADMIN_NAV } from "@/lib/admin-nav";

export default function AdminHome() {
  redirect(ADMIN_NAV[0].href);
}
