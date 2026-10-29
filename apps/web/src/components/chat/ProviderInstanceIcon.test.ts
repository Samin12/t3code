import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  customProviderInstanceIconKey,
  resolveProviderInstanceAcpRegistryIconUrl,
} from "./ProviderInstanceIcon";

describe("resolveProviderInstanceAcpRegistryIconUrl", () => {
  it("uses allowlisted catalog metadata and rejects untrusted overrides", () => {
    expect(
      resolveProviderInstanceAcpRegistryIconUrl({
        driverKind: ProviderDriverKind.make("acpRegistry"),
        agentId: "kilo",
        iconUrl: "https://cdn.agentclientprotocol.com/registry/icons/kilo.svg",
      }),
    ).toBe("https://cdn.agentclientprotocol.com/registry/icons/kilo.svg");
    expect(
      resolveProviderInstanceAcpRegistryIconUrl({
        driverKind: ProviderDriverKind.make("acpRegistry"),
        agentId: "generic-agent",
        iconUrl: "https://example.com/not-official.svg",
      }),
    ).toBe("https://cdn.agentclientprotocol.com/registry/v1/latest/generic-agent.svg");
  });
});

describe("customProviderInstanceIconKey", () => {
  it("gives every Claude instance named Voyager… the Voyager icon", () => {
    for (const name of ["Voyager · Claude 100", "Voyager · Claude 200", "  voyager  ", "VOYAGER"]) {
      expect(customProviderInstanceIconKey(ProviderDriverKind.make("claudeAgent"), name)).toBe(
        "voyager",
      );
    }
    expect(
      customProviderInstanceIconKey(ProviderDriverKind.make("claudeAgent"), "Claude · Voyager"),
    ).toBeNull();
    expect(
      customProviderInstanceIconKey(ProviderDriverKind.make("codex"), "Voyager · Codex"),
    ).toBeNull();
  });

  it("keeps the Hermes icon for the Grok instance named Hermes", () => {
    expect(customProviderInstanceIconKey(ProviderDriverKind.make("grok"), " Hermes ")).toBe(
      "hermes",
    );
    expect(customProviderInstanceIconKey(ProviderDriverKind.make("grok"), "Hermes 2")).toBeNull();
    expect(
      customProviderInstanceIconKey(ProviderDriverKind.make("claudeAgent"), "Hermes"),
    ).toBeNull();
  });
});
