import { useGT } from "gt-react";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { useSearchableSetting } from "./settingsSearch";
import { SettingsRow } from "./settingsLayout";

export function LibrarianSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const enabled = useClientSettings((settings) => settings.newThreadsUseLibrarian);
  return (
    <SettingsRow
      {...searchableSetting("librarian")}
      description={gt("Pick the project from your first message when you send.")}
    >
      <Switch
        checked={enabled}
        onCheckedChange={(newThreadsUseLibrarian) =>
          updateClientSettings({ newThreadsUseLibrarian })
        }
        aria-label={gt("New threads use the librarian")}
      />
    </SettingsRow>
  );
}
