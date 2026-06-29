import { redirect } from "next/navigation";

export default function DiscardStockPage() {
  redirect("/inventory?tab=discard");
}
