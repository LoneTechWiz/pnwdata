import { describe, expect, it } from "vitest";
import { buildCsv } from "./excel";

describe("buildCsv", () => {
  it("preserves every discovered column and escapes CSV values", () => {
    expect(buildCsv([
      { nation: "Alpha, Inc.", score: 123 },
      { nation: 'Bravo "Two"', note: "line one\nline two" },
    ])).toBe(
      'nation,score,note\r\n"Alpha, Inc.",123,\r\n"Bravo ""Two""",,"line one\nline two"',
    );
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(buildCsv([{ value: "=HYPERLINK(\"https://example.test\")" }]))
      .toBe('value\r\n"\'=HYPERLINK(""https://example.test"")"');
  });
});
