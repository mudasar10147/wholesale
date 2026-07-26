/** Primary app routes — single source of truth for sidebar and mobile nav. */

export type NavItemRole = "admin" | "clerk" | "social" | "salesman";

export type NavItem = {
  href: string;
  label: string;
  /** Who may see this link. Admins always see every item. */
  roles: readonly NavItemRole[];
};

export type UserRoleFlags = {
  isAdmin: boolean;
  isClerk: boolean;
  isSocial: boolean;
  isSalesman: boolean;
};

/** The salesman's whole app: the price-and-stock catalog, and nothing else. */
export const SALES_CATALOG_ROUTE = "/share/sales-men";

export const navItems: readonly NavItem[] = [
  { href: "/", label: "Dashboard", roles: ["admin"] },
  { href: "/products", label: "Products", roles: ["admin"] },
  { href: "/inventory", label: "Inventory", roles: ["admin"] },
  { href: "/inventory/stock-correction", label: "Stock correction", roles: ["admin"] },
  { href: "/sales", label: "Sales", roles: ["admin", "clerk"] },
  { href: "/expenses", label: "Expenses", roles: ["admin", "clerk"] },
  { href: "/cash", label: "Cash ledger", roles: ["admin"] },
  { href: "/loans", label: "Loans", roles: ["admin"] },
  { href: "/customers", label: "Customers", roles: ["admin", "clerk"] },
  { href: "/traders", label: "Traders", roles: ["admin"] },
  { href: "/reports/fifo", label: "FIFO Reports", roles: ["admin"] },
  { href: "/reports/purchases", label: "Purchase report", roles: ["admin"] },
  { href: "/social", label: "Social Media", roles: ["social"] },
  { href: SALES_CATALOG_ROUTE, label: "Sales catalog", roles: ["salesman"] },
  { href: "/settings", label: "Settings", roles: ["admin"] },
];

export function isNavVisibleForUser(item: NavItem, opts: UserRoleFlags): boolean {
  if (opts.isAdmin) return true;
  if (opts.isSocial) return item.roles.includes("social");
  if (opts.isClerk) return item.roles.includes("clerk");
  if (opts.isSalesman) return item.roles.includes("salesman");
  return false;
}

/**
 * Where a signed-in user belongs when no explicit destination was requested.
 * Each role's landing page must be one it can actually read, or it lands on a
 * permission-denied screen.
 */
export function defaultRouteForUser(opts: UserRoleFlags): string {
  if (opts.isAdmin) return "/";
  if (opts.isSocial) return "/social";
  if (opts.isClerk) return "/sales";
  if (opts.isSalesman) return SALES_CATALOG_ROUTE;
  return "/";
}

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
