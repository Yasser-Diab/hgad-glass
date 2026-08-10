import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

function sourceSection(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("saving can create first-time customer or supplier names instead of requiring a stale selected ID", () => {
  const helper = sourceSection("async function selectedPartyForPersistence(", "function upsertLocalParty(");

  assert.match(helper, /if \(!selectedName\)/);
  assert.doesNotMatch(helper, /if \(!selectedId \|\| !selectedName\)/);
  assert.match(helper, /\.from\(table\)\.select\("id, name"\)\.eq\("name", selectedName\)\.maybeSingle\(\)/);
  assert.match(helper, /\.from\(table\)\.insert\(\{ name: selectedName, opening_balance: 0 \}\)\.select\("id, name"\)\.single\(\)/);
});
