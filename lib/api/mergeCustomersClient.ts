"use client";

import type { CustomerInput } from "@/lib/firestore/customers";
import {
  mergeCustomers,
  type MergeCustomersResult,
} from "@/lib/firestore/mergeCustomers";

export type { MergeCustomersResult };

export async function mergeCustomersViaApi(
  keepCustomerId: string,
  mergeCustomerId: string,
  finalProfile: CustomerInput,
): Promise<MergeCustomersResult> {
  return mergeCustomers({
    keepCustomerId,
    mergeCustomerId,
    finalProfile,
  });
}
