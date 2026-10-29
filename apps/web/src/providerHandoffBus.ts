import type { ProviderInstanceId, ScopedThreadRef } from "@t3tools/contracts";

export interface ProviderHandoffRequest {
  readonly threadRef: ScopedThreadRef;
  /** Set when the model picker already chose the destination. */
  readonly instanceId?: ProviderInstanceId;
  readonly model?: string;
}

type Listener = (request: ProviderHandoffRequest) => void;

let listener: Listener | null = null;

export function requestProviderHandoff(request: ProviderHandoffRequest): void {
  listener?.(request);
}

export function subscribeProviderHandoff(next: Listener): () => void {
  listener = next;
  return () => {
    if (listener === next) {
      listener = null;
    }
  };
}
