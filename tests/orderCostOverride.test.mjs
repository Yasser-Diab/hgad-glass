import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveSupplierCost,
  hasSupplierLumpSumCost,
  supplierCostSource,
  supplierLumpSumCost,
  supplierLumpSumCostState
} from "../src/orderCostOverride.js";
import { readFileSync } from "node:fs";

const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

test("supplier lump sum is optional and takes precedence only when valid", () => {
  assert.equal(supplierLumpSumCost({}), null);
  assert.equal(effectiveSupplierCost({}, 85), 85);
  assert.equal(supplierCostSource({}), "calculated");

  const order = { supplierLumpSumCost: "120.5" };
  assert.equal(supplierLumpSumCost(order), 120.5);
  assert.equal(hasSupplierLumpSumCost(order), true);
  assert.equal(effectiveSupplierCost(order, 85), 120.5);
  assert.equal(supplierCostSource(order), "lump-sum");
});

test("supplier lump sum keeps zero and rejects negative or malformed values", () => {
  assert.deepEqual(supplierLumpSumCostState(0), { empty: false, valid: true, value: 0 });
  assert.equal(supplierLumpSumCost({ supplier_lump_sum_cost: 0 }), 0);
  assert.deepEqual(supplierLumpSumCostState("-1"), { empty: false, valid: false, value: null });
  assert.deepEqual(supplierLumpSumCostState("not-a-number"), { empty: false, valid: false, value: null });
});

test("supplier cost labels use invoice language rather than internal row terminology", () => {
  assert.match(mainSource, /فاتورة المورد/);
  assert.match(mainSource, /إجمالي بنود الطلب/);
  assert.doesNotMatch(
    mainSource.slice(mainSource.indexOf('className="supplier-order-cost"'), mainSource.indexOf('className="supplier-order-cost"') + 550),
    /صفوف/
  );
});

test("order-facing copy uses commercial item language, not spreadsheet rows", () => {
  assert.match(mainSource, /كل بنوده ورسوماته/);
  assert.match(mainSource, /بنود الطلب/);
  assert.doesNotMatch(mainSource, /تكلفة الصفوف/);
});
