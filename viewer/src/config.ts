export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

/** Origen usado para WebSocket de señalización (mismo origen si no hay VITE_API_BASE). */
export function wsOrigin(): string {
  if (API_BASE) {
    try {
      return new URL(API_BASE).origin;
    } catch {
      return window.location.origin;
    }
  }
  return window.location.origin;
}
