/** Primary app routes — single source of truth for sidebar and mobile nav. */

export const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/products", label: "Products" },
  { href: "/sales", label: "Sales" },
  { href: "/expenses", label: "Expenses" },
  { href: "/loans", label: "Partner Loans" },
  { href: "/customers", label: "Customers" },
  { href: "/reports/fifo", label: "FIFO Reports" },
] as const;

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
