import assert from "node:assert/strict";
import test from "node:test";

import { groupGlassReceiptEntries } from "../src/glassGrouping.js";

const sameDoubleGlassRows = [
  {
    id: "row-176",
    glassMode: "double",
    doubleGap: "فراغ 16مم",
    notes: "دبل على بوهات استراكنر شطف سير - العاكس للداخل *سانجوبان*",
    layers: [
      { glassType: "عاكس أزرق فاتح", company: "سانجوبان", thickness: "5 مم", secure: true },
      { glassType: "شفاف", company: "سانجوبان", thickness: "6مم", secure: true }
    ]
  },
  {
    id: "row-22",
    glassMode: "double",
    doubleGap: "فراغ ١٦ مم",
    notes: "دبل على بوهات استراكنر شطف سير - العاكس للداخل سانجوبان",
    layers: [
      { glassType: "عاكس ازرق فاتح", company: "سانجوبان", thickness: "٥مم", secure: true },
      { glassType: "شفاف", company: "سانجوبان", thickness: "٦ مم", secure: true }
    ]
  }
];

test("status report groups same glass material into one breakdown entry", () => {
  const groups = groupGlassReceiptEntries({ rows: sameDoubleGlassRows }, [
    {
      rowId: "row-176",
      rowIndex: 0,
      description: "زجاج دبل عاكس أزرق فاتح 5مم سيكوريت سانجوبان - فراغ 16مم - شفاف 6مم سيكوريت سانجوبان (دبل على بوهات استراكنر شطف سير - العاكس للداخل *سانجوبان*)",
      orderedQuantity: 176,
      previouslyReceivedQuantity: 0,
      remainingQuantity: 176
    },
    {
      rowId: "row-22",
      rowIndex: 1,
      description: "زجاج دبل عاكس أزرق فاتح 5مم سيكوريت سانجوبان - فراغ 16مم - شفاف 6مم سيكوريت سانجوبان (دبل على بوهات استراكنر شطف سير - العاكس للداخل سانجوبان)",
      orderedQuantity: 22,
      previouslyReceivedQuantity: 0,
      remainingQuantity: 22
    }
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].orderedQuantity, 198);
  assert.equal(groups[0].previouslyReceivedQuantity, 0);
  assert.equal(groups[0].remainingQuantity, 198);
  assert.equal(groups[0].entries.length, 2);
});

test("status report keeps genuinely different glass materials separate", () => {
  const groups = groupGlassReceiptEntries({
    rows: [
      sameDoubleGlassRows[0],
      {
        ...sameDoubleGlassRows[1],
        id: "row-different",
        layers: [
          sameDoubleGlassRows[1].layers[0],
          { ...sameDoubleGlassRows[1].layers[1], thickness: "8مم" }
        ]
      }
    ]
  }, [
    { rowId: "row-176", rowIndex: 0, description: "زجاج دبل عاكس أزرق فاتح 5مم", orderedQuantity: 176, previouslyReceivedQuantity: 0, remainingQuantity: 176 },
    { rowId: "row-different", rowIndex: 1, description: "زجاج دبل عاكس أزرق فاتح 5مم مع طبقة 8مم", orderedQuantity: 22, previouslyReceivedQuantity: 0, remainingQuantity: 22 }
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.orderedQuantity), [176, 22]);
});
