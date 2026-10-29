import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProjectId,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  buildPrompt,
  librarianModel,
  parseAnswer,
  pathProject,
  type Candidate,
} from "./routing.ts";

const candidates: Candidate[] = [
  {
    id: ProjectId.make("general"),
    title: "General",
    workspaceRoot: "/home/user",
    repository: null,
    recentThreads: [],
  },
  {
    id: ProjectId.make("app"),
    title: "App",
    workspaceRoot: "/home/user/Developer/app",
    repository: "acme/app",
    recentThreads: ["Fix uploading", "Ship the editor"],
  },
  {
    id: ProjectId.make("nested"),
    title: "Nested",
    workspaceRoot: "/home/user/Developer/app/plugin",
    repository: null,
    recentThreads: [],
  },
];

describe("librarian routing", () => {
  it("uses the longest matching root with path boundaries and home expansion", () => {
    expect(
      pathProject("Fix ~/Developer/app/plugin/src/index.ts", candidates, "/home/user")?.id,
    ).toBe("nested");
    expect(pathProject("Fix `/home/user/Developer/app/src/index.ts`", candidates)?.id).toBe("app");
    expect(pathProject("Look in /home/user/Developer/application", candidates)?.id).toBe("general");
    expect(pathProject("What is a plugin?", candidates)).toBeUndefined();
    expect(pathProject("See /home/user/Developer/app/../../other", candidates)?.id).toBe("general");
    expect(
      pathProject('Edit "/other/My Repo/file.ts"', [
        { ...candidates[1]!, workspaceRoot: "/other/My Repo" },
      ])?.id,
    ).toBe("app");
  });

  it("includes recent titles, repo identity, offered folders and the catch-all rule", () => {
    const prompt = buildPrompt({
      text: "Fix the editor",
      attachmentCount: 2,
      fallbackProjectId: ProjectId.make("general"),
      candidates,
      repos: ["/repos/new"],
    });
    for (const evidence of [
      "Fix uploading",
      "acme/app",
      "/repos/new",
      '"attachmentCount":2',
      "one-off questions",
      "Never invent",
    ])
      expect(prompt).toContain(evidence);
  });

  it("accepts JSON inside fences or prose and rejects invented or ambiguous destinations", () => {
    expect(
      parseAnswer(
        '```json\n{"project":"app","newFolder":null,"why":"Fixes the editor"}\n```',
        candidates,
        [],
      ),
    ).toEqual({ project: "app", newFolder: null, why: "Fixes the editor" });
    expect(
      parseAnswer(
        'Answer: {"project":null,"newFolder":"/repos/new","why":"Builds the new app"} done',
        candidates,
        ["/repos/new"],
      )?.newFolder,
    ).toBe("/repos/new");
    for (const answer of [
      '{"project":"invented","newFolder":null,"why":"Work"}',
      '{"project":null,"newFolder":"/repos/invented","why":"Work"}',
      '{"project":"app","newFolder":"/repos/new","why":"Work"}',
      '{"project":"app","newFolder":null,"why":""}',
      "not json",
    ])
      expect(parseAnswer(answer, candidates, ["/repos/new"])).toBeNull();
    expect(
      parseAnswer('{"project":null,"newFolder":null,"why":"An errand"}', candidates, [])?.project,
    ).toBeNull();
  });

  it("selects an enabled Claude instance when the configured Codex is disabled", () => {
    const providers = [
      { instanceId: ProviderInstanceId.make("codex"), driver: "codex", enabled: false },
      {
        instanceId: ProviderInstanceId.make("claude_personal"),
        driver: "claudeAgent",
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
        capabilities: { textGeneration: true },
      },
    ] as unknown as ServerProvider[];
    expect(
      librarianModel(
        {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [ProviderInstanceId.make("claude_personal")]: {
              driver: ProviderDriverKind.make("claudeAgent"),
              enabled: true,
            },
          },
        },
        providers,
      ),
    ).toEqual({ instanceId: "claude_personal", model: "claude-haiku-5-5" });
  });
});
