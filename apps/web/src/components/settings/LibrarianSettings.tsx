import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow } from "./settingsLayout";

export function LibrarianSettings() {
  const enabled = useClientSettings((settings) => settings.newThreadsUseLibrarian);
  return (
    <SettingsRow
      {...searchableSetting("librarian")}
      description="Pick the project from your first message when you send."
    >
      <Switch
        checked={enabled}
        onCheckedChange={(newThreadsUseLibrarian) =>
          updateClientSettings({ newThreadsUseLibrarian })
        }
        aria-label="New threads use the librarian"
      />
    </SettingsRow>
  );
}
