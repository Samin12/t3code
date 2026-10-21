import { useEffect, useState } from "react";
import { createThreadTraversalKeypressGuard } from "../lib/threadTraversalKeypressGuard";

export function useThreadTraversalKeypressGuard() {
  const [guard] = useState(createThreadTraversalKeypressGuard);

  useEffect(() => {
    window.addEventListener("keyup", guard.release, true);
    window.addEventListener("blur", guard.reset);
    return () => {
      window.removeEventListener("keyup", guard.release, true);
      window.removeEventListener("blur", guard.reset);
      guard.reset();
    };
  }, [guard]);

  return guard.accept;
}
