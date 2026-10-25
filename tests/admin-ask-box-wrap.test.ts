import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Ask dialog is rendered inside `whitespace-nowrap` action cells (e.g. the
 * verification queue), and white-space inherits — its text ran out of the box.
 */
describe("AskNgoBox dialog", () => {
  it("resets white-space so its text wraps inside the dialog", () => {
    const src = readFileSync(join(process.cwd(), "app/admin/components/AskNgoBox.tsx"), "utf8");
    expect(src).toMatch(/fixed inset-0[^"]*whitespace-normal/);
    expect(src).toMatch(/max-w-md w-full[^"]*break-words/);
  });
});
