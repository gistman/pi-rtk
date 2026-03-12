import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  files?: string[];
  main?: string;
  types?: string;
  exports?: Record<string, { default?: string; types?: string }>;
  pi?: { extensions?: string[] };
  scripts?: Record<string, string>;
};

describe("package metadata", () => {
  it("points Pi package discovery at the built extension entrypoint", () => {
    expect(packageJson.pi?.extensions).toEqual(["./dist/index.js"]);
    expect(packageJson.main).toBe("./dist/index.js");
    expect(packageJson.types).toBe("./dist/index.d.ts");
    expect(packageJson.exports?.["."]).toEqual({
      types: "./dist/index.d.ts",
      default: "./dist/index.js"
    });
  });

  it("ships built artifacts and rebuilds them for install and publish flows", () => {
    expect(packageJson.files).toContain("dist");
    expect(packageJson.files).not.toContain("src");
    expect(packageJson.scripts?.prepare).toBe("npm run build");
    expect(packageJson.scripts?.prepack).toBe("npm run clean");
  });
});
