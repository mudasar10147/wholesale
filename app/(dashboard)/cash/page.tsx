import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { AddCashEntryButton } from "@/app/components/cash/AddCashEntryButton";
import { CashKpiCards } from "@/app/components/cash/CashKpiCards";
import { CashLedgerTable } from "@/app/components/cash/CashLedgerTable";
import { AddPartyButton } from "@/app/components/parties/AddPartyButton";
import { PartyCrudPanel } from "@/app/components/parties/PartyCrudPanel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function CashLedgerPage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Cash ledger"
          description="Record manual cash put in or taken out by hand — owner capital, drawings, bank transfers, and other movements. These adjust your cash-in-hand total. Loans have their own page."
          action={
            <div className="flex flex-wrap gap-2">
              <AddPartyButton />
              <AddCashEntryButton />
            </div>
          }
        />

        <CashKpiCards />

        <Card>
          <CardHeader>
            <CardTitle>Cash entries</CardTitle>
            <CardDescription>
              Every manual cash movement, newest first. Filter by type or party, edit, or delete.
              Each entry can be tied to a party so you always know where the cash came from or went.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CashLedgerTable />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Parties</CardTitle>
            <CardDescription>
              People and companies tied to cash entries (owner, investors, lenders, banks…). Create,
              edit, or archive them here, or add one on the fly while recording an entry.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PartyCrudPanel />
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}
