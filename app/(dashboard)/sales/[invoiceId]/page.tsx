import { InvoiceDetailView } from "@/app/components/invoices/InvoiceDetailView";
import { PageHeader } from "@/app/components/layout/PageHeader";

type PageProps = {
  params: Promise<{ invoiceId: string }>;
};

export default async function InvoiceDetailPage({ params }: PageProps) {
  const { invoiceId } = await params;
  return (
    <div className="space-y-10">
      <PageHeader
        title="Invoice"
        description="View lines, copy or download as text, edit drafts, post, void, or delete drafts."
      />
      <InvoiceDetailView invoiceId={invoiceId} />
    </div>
  );
}
