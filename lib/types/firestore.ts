import type { Timestamp } from "firebase/firestore";

/**
 * Document shape for `products/{productId}`.
 * Field names use snake_case to match docs/PROJECT_SPEC.md.
 */
export type ProductDoc = {
  name: string;
  category?: string;
  cost_price: number;
  sale_price: number;
  stock_quantity: number;
  created_at: Timestamp;
};

/**
 * Document shape for `sales/{saleId}`.
 * `product_id` references `products/{product_id}`.
 */
export type SaleDoc = {
  product_id: string;
  quantity: number;
  sale_price: number;
  total_amount: number;
  date: Timestamp;
};

/**
 * Document shape for `expenses/{expenseId}`.
 */
export type ExpenseDoc = {
  title: string;
  amount: number;
  date: Timestamp;
};
