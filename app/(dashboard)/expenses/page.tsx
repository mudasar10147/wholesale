import { AddExpenseButton } from "@/app/components/expenses/AddExpenseButton";
import { ExpenseKpiCards } from "@/app/components/expenses/ExpenseKpiCards";
import { ExpenseList } from "@/app/components/expenses/ExpenseList";
import { PageHeader } from "@/app/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

export default function ExpensesPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Expenses"
        description="Record business spending. Each entry is stored in Firestore with the time it was added."
        action={<AddExpenseButton />}
      />

      <ExpenseKpiCards />

      <Card>
        <CardHeader>
          <CardTitle>All expenses</CardTitle>
          <CardDescription>
            Latest 100 expenses, newest first. Expenses from the last two days can be edited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExpenseList />
        </CardContent>
      </Card>
    </div>
  );
}
