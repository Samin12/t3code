import { describe, expect, it } from "vite-plus/test";

import {
  findProjectForSlug,
  projectCommandSlug,
  projectSlugFromNewThreadCommand,
} from "./projectNewThreadCommand";

describe("projectNewThreadCommand", () => {
  it("slugs project titles", () => {
    expect(projectCommandSlug("SaminOS")).toBe("saminos");
    expect(projectCommandSlug("Borumi Projects")).toBe("borumi-projects");
    expect(projectCommandSlug("  Creator Compiler! ")).toBe("creator-compiler");
  });

  it("reads the slug from a command", () => {
    expect(projectSlugFromNewThreadCommand("project.saminos.newThread")).toBe("saminos");
    expect(projectSlugFromNewThreadCommand("project.borumi-projects.newThread")).toBe(
      "borumi-projects",
    );
    expect(projectSlugFromNewThreadCommand("chat.newLocal")).toBeNull();
    expect(projectSlugFromNewThreadCommand("project.SaminOS.newThread")).toBeNull();
  });

  it("finds the first unarchived match", () => {
    const projects = [
      { id: "a", title: "SaminOS", archivedAt: "2026-10-01" },
      { id: "b", title: "SaminOS", archivedAt: null },
      { id: "c", title: "Documents", archivedAt: null },
    ];
    expect(findProjectForSlug(projects, "saminos")?.id).toBe("b");
    expect(findProjectForSlug(projects, "missing")).toBeNull();
  });
});
