import { AddPartnerLoanEntryForm } from "@/app/components/finance/AddPartnerLoanEntryForm";
import { PartnerLoanLedgerTable } from "@/app/components/finance/PartnerLoanLedgerTable";
import { PageHeader } from "@/app/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function LoansPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Partner Loans"
        description="Track money partners lend to the company and repayments made back to them."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add loan entry</CardTitle>
          <CardDescription>
            Choose loan in or repayment. These entries affect pending loan balance, not profit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddPartnerLoanEntryForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Loan ledger</CardTitle>
          <CardDescription>
            Chronological ledger with running pending balance per partner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PartnerLoanLedgerTable />
        </CardContent>
      </Card>
    </div>
  );
}
