import { create } from 'zustand';

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push(type: Toast['type'], message: string): void;
  dismiss(id: number): void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (type, message) => {
    const id = ++counter;
    set({ toasts: [...get().toasts, { id, type, message }] });
    setTimeout(() => get().dismiss(id), 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export function toastError(message: string) {
  useToastStore.getState().push('error', message);
}
export function toastSuccess(message: string) {
  useToastStore.getState().push('success', message);
}
export function toastInfo(message: string) {
  useToastStore.getState().push('info', message);
}
export function toastWarning(message: string) {
  useToastStore.getState().push('warning', message);
}

export class AppError extends Error {
  constructor(messageKey: string) {
    super(messageKey);
  }
}
