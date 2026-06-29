import { redirect } from "next/navigation";

export default async function LowStockPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { threshold } = await searchParams;
  const value = Array.isArray(threshold) ? threshold[0] : threshold;
  const params = new URLSearchParams({ tab: "stock", low: "1" });
  if (value) params.set("threshold", value);
  redirect(`/inventory?${params.toString()}`);
}
