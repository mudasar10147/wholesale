import { ReturnDetailView } from "@/app/components/invoices/ReturnDetailView";
import { PageHeader } from "@/app/components/layout/PageHeader";

type PageProps = {
  params: Promise<{ returnId: string }>;
};

export default async function ReturnDetailPage({ params }: PageProps) {
  const { returnId } = await params;
  return (
    <div className="space-y-10">
      <PageHeader
        title="Return"
        description="View return lines, settlement, and link back to the original invoice."
      />
      <ReturnDetailView returnId={returnId} />
    </div>
  );
}
