import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { ProductCompletenessDashboard } from "@/app/components/products/ProductCompletenessDashboard";
export default function ProductCompletenessPage() {
  return (
    <AdminOnly>
      <div className="space-y-10">
        <PageHeader
          title="Product catalog completeness"
          description="Admin-only view of every product in Firestore, split into complete vs incomplete rows so you can finish missing fields (including images). A row is complete when it has name, category, valid cost and sale prices, whole-number stock ≥ 0, a created date, and either an image URL or an uploaded image path. Incomplete rows list the exact gaps; edit details on the Products page."
        />

        <ProductCompletenessDashboard />
      </div>
    </AdminOnly>
  );
}
