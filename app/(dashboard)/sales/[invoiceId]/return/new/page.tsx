import { CreateReturnForm } from "@/app/components/invoices/CreateReturnForm";
import { PageHeader } from "@/app/components/layout/PageHeader";

type PageProps = {
  params: Promise<{ invoiceId: string }>;
};

export default async function CreateReturnPage({ params }: PageProps) {
  const { invoiceId } = await params;
  return (
    <div className="space-y-10">
      <PageHeader
        title="Create return"
        description="Return items from a posted invoice. Stock is restored when the return is posted."
      />
      <CreateReturnForm invoiceId={invoiceId} />
    </div>
  );
}
