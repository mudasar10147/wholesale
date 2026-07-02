"use client";

import { TraderFormModal } from "@/app/components/traders/TraderFormModal";

type AddTraderModalProps = {
  onDismiss: () => void;
  /** Called with the new trader id and name after a successful create. */
  onCreated?: (traderId: string, name: string) => void;
};

export function AddTraderModal({ onDismiss, onCreated }: AddTraderModalProps) {
  return <TraderFormModal onDismiss={onDismiss} onSaved={onCreated} />;
}
