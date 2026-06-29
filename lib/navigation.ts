/** Primary app routes — single source of truth for sidebar and mobile nav. */

export type NavItemRole = "admin" | "clerk";

export type NavItem = {
  href: string;
  label: string;
  /** Who may see this link. Admins always see every item. */
  roles: readonly NavItemRole[];
};

export const navItems: readonly NavItem[] = [
  { href: "/", label: "Dashboard", roles: ["admin"] },
  { href: "/products", label: "Products", roles: ["admin"] },
  { href: "/inventory", label: "Inventory", roles: ["admin"] },
  { href: "/sales", label: "Sales", roles: ["admin", "clerk"] },
  { href: "/expenses", label: "Expenses", roles: ["admin", "clerk"] },
  { href: "/cash", label: "Cash ledger", roles: ["admin"] },
  { href: "/loans", label: "Loans", roles: ["admin"] },
  { href: "/customers", label: "Customers", roles: ["admin", "clerk"] },
  { href: "/traders", label: "Traders", roles: ["admin"] },
  { href: "/reports/fifo", label: "FIFO Reports", roles: ["admin"] },
  { href: "/reports/purchases", label: "Purchase report", roles: ["admin"] },
];

export function isNavVisibleForUser(
  item: NavItem,
  opts: { isAdmin: boolean; isClerk: boolean },
): boolean {
  if (opts.isAdmin) return true;
  if (opts.isClerk) return item.roles.includes("clerk");
  return false;
}

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
