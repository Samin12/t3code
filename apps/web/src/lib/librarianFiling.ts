import type {
  OrchestrationV2DispatchCommandResult,
  OrchestrationV2ThreadLaunchResult,
} from "@t3tools/contracts";
import { toastManager } from "../components/ui/toast";

export function showLibrarianFiling(
  result: OrchestrationV2DispatchCommandResult | OrchestrationV2ThreadLaunchResult,
) {
  if (!("librarian" in result) || !result.librarian) return;
  const filing = result.librarian;
  toastManager.add({
    type: "success",
    title: `Filed in ${filing.projectTitle}: ${filing.reason}`,
  });
}
