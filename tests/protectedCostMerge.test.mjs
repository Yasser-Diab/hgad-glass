import test from "node:test";
import assert from "node:assert/strict";
import { mergeProtectedLocalOrderRows } from "../server/protectedCostMerge.mjs";

test("preserves every hidden supplier-cost field during an operational edit", () => {
  const incoming = [{
    id: "row-1",
    quantity: 3,
    supplierUnitPrice: 0,
    supplierMaterialUnitPrice: 0,
    layers: [{
      width: 200,
      supplierUnitPrice: 0,
      supplier_unit_price: 0
    }]
  }];
  const stored = [{
    id: "row-1",
    supplier_unit_price: 77,
    supplier_material_unit_price: 11,
    supplier_cost: 110,
    layers: JSON.stringify([{
      width: 100,
      supplierUnitPrice: 55,
      supplier_unit_price: 54
    }])
  }];

  const result = mergeProtectedLocalOrderRows(incoming, stored);

  assert.equal(result.rows[0].quantity, 3);
  assert.equal(result.rows[0].layers[0].width, 200);
  assert.equal(result.rows[0].supplierUnitPrice, 77);
  assert.equal(result.rows[0].supplierMaterialUnitPrice, 11);
  assert.equal(result.rows[0].layers[0].supplierUnitPrice, 55);
  assert.equal(result.rows[0].layers[0].supplier_unit_price, 54);
  assert.equal(result.protectedSupplierCosts.get("row-1"), 110);
  assert.equal(incoming[0].supplierUnitPrice, 0);
});

test("rejects adding a row that has no stored cost source", () => {
  assert.throws(
    () => mergeProtectedLocalOrderRows(
      [{ id: "new-row", layers: [] }],
      [{ id: "stored-row", layers: "[]" }]
    ),
    /إضافة بند جديد/
  );
});

test("rejects changing layer composition without cost permission", () => {
  assert.throws(
    () => mergeProtectedLocalOrderRows(
      [{ id: "row-1", layers: [{}, {}] }],
      [{ id: "row-1", layers: "[{}]" }]
    ),
    /تغيير تركيب طبقات الزجاج/
  );
});
