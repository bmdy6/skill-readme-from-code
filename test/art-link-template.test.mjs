import { test } from "node:test";
import assert from "node:assert/strict";
import { linkHTML } from "../scripts/lib/art-link.mjs";

test("hero-link preview shows a complete short source line but keeps long excerpts bounded", () => {
  const fullText = "h1 { font-size: 25.00px; line-height: 1.2; }";
  assert.ok(fullText.length > 40 && fullText.length <= 44);
  const data = {
    source: { file: "main.css" },
    output: { file: "tokens.json" },
    items: [{ name: "fontSize.xl", value: "25px", line: 9 }],
    excerpts: [{ line: 9, text: "…font-size: 25.00px;…", fullText }],
    focus: 0,
    total: 1,
    status: { verified: true, value: "1/1 sampled sources still match" },
  };
  assert.ok(linkHTML(data).includes(fullText));
  data.excerpts[0].fullText = fullText.repeat(10);
  assert.ok(linkHTML(data).includes("…font-size: 25.00px;…"));
  assert.ok(!linkHTML(data).includes(fullText.repeat(10)));
});
