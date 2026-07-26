import { RequireSalesman } from "@/app/components/auth/RequireSalesman";
import { SalesCatalogByCategory } from "@/app/components/share/SalesCatalogByCategory";
import { SalesCatalogHeader } from "@/app/components/share/SalesCatalogHeader";

export default function SalesMenSharePage() {
  return (
    <RequireSalesman>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <SalesCatalogHeader />
        <SalesCatalogByCategory />
      </main>
    </RequireSalesman>
  );
}
