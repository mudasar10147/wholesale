import type { CustomerInput } from "@/lib/firestore/customers";
import type { CreateInvoiceInput } from "@/lib/firestore/invoices";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s()-]*$/;
const ORDER_ID_RE = /^[A-Z0-9-]{6,40}$/;

export function normalizeCustomerInput(input: CustomerInput): CustomerInput {
  const name = input.name.trim();
  const phone = input.phone?.trim();
  const email = input.email?.trim().toLowerCase();
  const address = input.address?.trim();

  return {
    name,
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(address ? { address } : {}),
  };
}

export function assertValidCustomerInput(input: CustomerInput): void {
  if (!input.name) throw new Error("Customer name is required.");
  if (input.name.length < 2 || input.name.length > 120) {
    throw new Error("Customer name must be between 2 and 120 characters.");
  }
  if (input.phone) {
    if (input.phone.length > 25 || !PHONE_RE.test(input.phone)) {
      throw new Error("Enter a valid phone number.");
    }
  }
  if (input.email) {
    if (input.email.length > 120 || !EMAIL_RE.test(input.email)) {
      throw new Error("Enter a valid email address.");
    }
  }
  if (input.address && input.address.length > 300) {
    throw new Error("Address must be 300 characters or fewer.");
  }
}

export function normalizeOrderId(raw: string): string {
  return raw.trim().toUpperCase();
}

export function assertValidOrderId(orderId: string): void {
  if (!ORDER_ID_RE.test(orderId)) {
    throw new Error(
      "Order ID must be 6-40 chars and contain only uppercase letters, numbers, and hyphen.",
    );
  }
}

export function assertValidCreateInvoiceInput(input: CreateInvoiceInput): void {
  if (!input.customer_id.trim()) throw new Error("Customer is required.");
  if (input.lines.length === 0) throw new Error("Add at least one invoice item.");

  if (!Number.isFinite(input.discount_amount) || input.discount_amount < 0) {
    throw new Error("Invoice discount must be zero or greater.");
  }
  if (!Number.isFinite(input.delivery_charge) || input.delivery_charge < 0) {
    throw new Error("Delivery charge must be zero or greater.");
  }
  if (input.notes && input.notes.trim().length > 500) {
    throw new Error("Notes must be 500 characters or fewer.");
  }

  const seen = new Set<string>();
  for (const line of input.lines) {
    const productId = line.product_id.trim();
    if (!productId) throw new Error("Select product on every line.");
    if (seen.has(productId)) throw new Error("Each invoice line must use a different product.");
    seen.add(productId);

    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Quantity must be a positive whole number.");
    }
    if (!Number.isFinite(line.unit_price) || line.unit_price < 0) {
      throw new Error("Unit sale price must be zero or greater.");
    }
    if (!Number.isFinite(line.line_discount) || line.line_discount < 0) {
      throw new Error("Line discount must be zero or greater.");
    }
    if (line.line_discount > line.quantity * line.unit_price) {
      throw new Error("Line discount cannot exceed line amount.");
    }
  }
}
