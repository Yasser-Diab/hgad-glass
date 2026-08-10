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
  assert.match(helper, /table === "suppliers"[\s\S]*\{ name: selectedName, opening_balance: 0 \}[\s\S]*\{ name: selectedName \}/);
  assert.match(helper, /missingSupabaseSchemaColumn\(inserted\.error, table\) === "opening_balance"[\s\S]*\.from\(table\)\.insert\(\{ name: selectedName \}\)/);
});

test("local server creates first-time parties inside save instead of requiring existing IDs", () => {
  const serverSource = readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8");
  const helperStart = serverSource.indexOf("async function ensureOrderPartyForSave(");
  const saveStart = serverSource.indexOf("async function saveOrder(", helperStart);
  assert.ok(helperStart >= 0);
  assert.ok(saveStart > helperStart);
  const localHelper = serverSource.slice(helperStart, saveStart);
  const saveSource = serverSource.slice(saveStart, serverSource.indexOf("async function deleteOrder", saveStart));

  assert.match(localHelper, /select id, name from \$\{table\} where id = \$1 and lower\(name\) = lower\(\$2\)/);
  assert.match(localHelper, /select id, name from \$\{table\} where lower\(name\) = lower\(\$1\)/);
  assert.match(localHelper, /insert into customers \(id, name\) values/);
  assert.match(localHelper, /insert into suppliers \(id, name, opening_balance\) values/);
  assert.match(saveSource, /ensureOrderPartyForSave\("customers", customerId, customerName\)/);
  assert.match(saveSource, /ensureOrderPartyForSave\("suppliers", supplierId, supplierName\)/);
  assert.doesNotMatch(saveSource, /اختيار العميل أو المورد غير صالح\. اخترهما مرة أخرى من القائمة/);
});
