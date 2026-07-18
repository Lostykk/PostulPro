import { describe, expect, it } from "vitest";
import { isSafeHref, stripGenerationArtifacts } from "@/components/deliverables/RichContentRenderer";

describe("stripGenerationArtifacts", () => {
  it("strips a leading/trailing markdown code fence", () => {
    expect(stripGenerationArtifacts("```markdown\n# Titulo\ntexto\n```")).toBe("# Titulo\ntexto");
  });

  it("strips a bare ``` fence with no language tag", () => {
    expect(stripGenerationArtifacts("```\ntexto\n```")).toBe("texto");
  });

  it("leaves normal content untouched", () => {
    expect(stripGenerationArtifacts("## Titulo\n\ntexto normal")).toBe("## Titulo\n\ntexto normal");
  });
});

describe("isSafeHref", () => {
  it("allows http/https/mailto links", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:a@b.com")).toBe(true);
  });

  it("blocks javascript: URLs", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("  JavaScript:alert(1)")).toBe(false);
  });

  it("blocks data:text/html URLs", () => {
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects missing hrefs", () => {
    expect(isSafeHref(undefined)).toBe(false);
  });
});
