import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { CashLedgerTable } from "@/app/components/cash/CashLedgerTable";
import { AddLoanEntryButton } from "@/app/components/loans/AddLoanEntryButton";
import { LoanBalancesTable } from "@/app/components/loans/LoanBalancesTable";
import { LoanKpiCards } from "@/app/components/loans/LoanKpiCards";
import { AddPartyButton } from "@/app/components/parties/AddPartyButton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function LoansPage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Loans"
          description="Track money you borrowed and money you lent. Record what you borrow, repay, lend, or collect, and see the outstanding balance per party."
          action={
            <div className="flex flex-wrap gap-2">
              <AddPartyButton />
              <AddLoanEntryButton />
            </div>
          }
        />

        <LoanKpiCards />

        <Card>
          <CardHeader>
            <CardTitle>Outstanding by party</CardTitle>
            <CardDescription>
              Net position per party. Positive means they owe you; negative means you owe them. Use
              the quick actions to record a repayment or a collection.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoanBalancesTable />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Loan entries</CardTitle>
            <CardDescription>
              Every borrow, repayment, loan-out, and collection, newest first. Filter by action or
              party, edit, or delete.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CashLedgerTable scope="loan" />
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}
