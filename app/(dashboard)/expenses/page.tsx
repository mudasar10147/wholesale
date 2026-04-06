import { AddExpenseForm } from "@/app/components/expenses/AddExpenseForm";
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
      />

      <Card>
        <CardHeader>
          <CardTitle>Add expense</CardTitle>
          <CardDescription>Enter a title and amount. The date is set automatically when you save.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddExpenseForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All expenses</CardTitle>
          <CardDescription>Latest 100 expenses, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <ExpenseList />
        </CardContent>
      </Card>
    </div>
  );
}
