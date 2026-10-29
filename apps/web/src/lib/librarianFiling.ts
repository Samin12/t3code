import type {
  OrchestrationV2DispatchCommandResult,
  OrchestrationV2ThreadLaunchResult,
} from "@t3tools/contracts";
import { msg } from "gt-react";
import { toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";

export function showLibrarianFiling(
  result: OrchestrationV2DispatchCommandResult | OrchestrationV2ThreadLaunchResult,
) {
  if (!("librarian" in result) || !result.librarian) return;
  const filing = result.librarian;
  toastManager.add({
    type: "success",
    title: m(
      msg("Filed in {projectTitle}: {reason}", {
        projectTitle: filing.projectTitle,
        reason: filing.reason,
      }),
    ),
  });
}
