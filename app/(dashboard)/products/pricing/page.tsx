import { redirect } from "next/navigation";

export default function PricingMarginPage() {
  redirect("/inventory?tab=pricing");
}
