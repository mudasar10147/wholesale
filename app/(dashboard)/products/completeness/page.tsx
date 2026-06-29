import { redirect } from "next/navigation";

export default function ProductCompletenessPage() {
  redirect("/products?tab=completeness");
}
