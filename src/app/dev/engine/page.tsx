import { notFound } from "next/navigation";
import { EngineBench } from "./bench";

// DEV ONLY: manual test bench for the AI engine (see src/app/api/dev/engine).
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <EngineBench />;
}
