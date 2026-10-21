type TraversalKey = Pick<KeyboardEvent, "key"> & Partial<Pick<KeyboardEvent, "code">>;

export function createThreadTraversalKeypressGuard() {
  const heldKeys = new Set<string>();

  return {
    accept(event: TraversalKey & Pick<KeyboardEvent, "repeat">): boolean {
      // Some keyboards emit a second non-repeat keydown before keyup.
      // Waiting for release preserves one traversal per physical press.
      const key = event.code || event.key;
      if (event.repeat || heldKeys.has(key)) return false;
      heldKeys.add(key);
      return true;
    },
    release(event: TraversalKey) {
      heldKeys.delete(event.code || event.key);
    },
    reset() {
      heldKeys.clear();
    },
  };
}
