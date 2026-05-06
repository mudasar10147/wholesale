import { SalesCatalogByCategory } from "@/app/components/share/SalesCatalogByCategory";

export default function SalesMenSharePage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sales Catalog</h1>
        <p className="text-sm text-muted-foreground">
          Public view for sales team: purchase price, sale price, and quantity left by category.
        </p>
      </header>
      <SalesCatalogByCategory />
    </main>
  );
}
