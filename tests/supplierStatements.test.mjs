import test from "node:test";
import assert from "node:assert/strict";

import {
  RANGE_STATEMENT_MODE,
  SELECTED_ORDERS_STATEMENT_MODE,
  SELECTED_ORDERS_TOTAL_LABEL,
  buildRangeSupplierStatement,
  buildSelectedOrdersSupplierStatement,
  buildSupplierStatement,
  filterSupplierOrders,
  normalizeSelectedOrderIds,
  removeSelectedOrderId,
  selectAllFilteredOrderIds,
  stableOrderIds
} from "../src/supplierStatements.js";

const supplierA = { id: "supplier-a", name: "المورد الأول", opening_balance: 100 };
const supplierB = { id: "supplier-b", name: "المورد الثاني", opening_balance: 999 };

const orders = [
  {
    id: "pre-a",
    orderNo: "GO-001270",
    supplierId: supplierA.id,
    supplierName: supplierA.name,
    customerName: "نور",
    project: "واجهة قديمة",
    date: "2026-07-01",
    status: "ordered",
    supplierCost: 200,
    rows: [{ id: "pre-row", description: "زجاج شفاف 6 مم", quantity: 2 }]
  },
  {
    id: "in-a-1",
    orderNo: "GO-001278",
    supplierId: supplierA.id,
    supplierName: supplierA.name,
    customerName: "نور",
    project: "برج النور",
    date: "2026-07-10",
    status: "ordered",
    supplierCost: 300,
    rows: [
      { id: "row-a1", description: "زجاج شفاف 6 مم", quantity: 20 },
      { id: "row-a2", description: "زجاج سكريت 10 مم", quantity: 15 }
    ]
  },
  {
    id: "in-a-2",
    orderNo: "GO-001281",
    supplierId: supplierA.id,
    supplierName: supplierA.name,
    customerName: "الهدى",
    project: "بوابة شرقية",
    date: "2026-07-20",
    status: "ready",
    supplierCost: 50,
    rows: [{ id: "row-a3", description: "زجاج أزرق", quantity: 1 }]
  },
  {
    id: "after-a",
    orderNo: "GO-001290",
    supplierId: supplierA.id,
    supplierName: supplierA.name,
    customerName: "نور",
    project: "واجهة مستقبلية",
    date: "2026-07-25",
    status: "fabrication",
    supplierCost: 500,
    rows: [{ id: "after-row", description: "زجاج دبل", quantity: 3 }]
  },
  {
    id: "cancelled-a",
    orderNo: "GO-001279",
    supplierId: supplierA.id,
    supplierName: supplierA.name,
    customerName: "نور",
    project: "ملغي",
    date: "2026-07-12",
    status: "cancelled",
    supplierCost: 80,
    rows: []
  },
  {
    id: "in-b",
    orderNo: "GO-001278-B",
    supplierId: supplierB.id,
    supplierName: supplierB.name,
    customerName: "نور",
    project: "برج النور",
    date: "2026-07-10",
    status: "ordered",
    supplierCost: 700,
    rows: [{ id: "row-b", description: "يجب ألا يظهر", quantity: 99 }]
  }
];

const payments = [
  {
    id: "payment-pre-a",
    supplier_id: supplierA.id,
    supplier_name: supplierA.name,
    paid_at: "2026-07-03",
    amount: 40,
    method: "cash",
    reference: "PRE-40",
    notes: "دفعة سابقة"
  },
  {
    id: "payment-in-a",
    supplier_id: supplierA.id,
    supplier_name: supplierA.name,
    paid_at: "2026-07-15",
    amount: 60,
    method: "bank",
    payment_reference: "BANK-60",
    notes: "تحويل بنكي"
  },
  {
    id: "payment-after-a",
    supplier_id: supplierA.id,
    supplier_name: supplierA.name,
    paid_at: "2026-07-22",
    amount: 20,
    method: "cash",
    reference: "AFTER-20",
    notes: "بعد الفترة"
  },
  {
    id: "payment-in-b",
    supplier_id: supplierB.id,
    supplier_name: supplierB.name,
    paid_at: "2026-07-15",
    amount: 500,
    method: "bank",
    reference: "WRONG-SUPPLIER",
    notes: "يجب ألا تظهر"
  }
];

const callbacks = {
  getOrderCost: (order) => order.supplierCost,
  getOrderRows: (order) => order.rows,
  getRowDetails: (row, index, order) => ({
    rowId: row.id,
    line: index + 1,
    description: row.description,
    quantity: row.quantity,
    parentOrderId: order.id
  }),
  isPayable: (order) => order.status !== "cancelled",
  orderKey: (order) => order.id
};

test("range mode isolates supplier, carries prior activity forward, and keeps hierarchical details", () => {
  const statement = buildSupplierStatement({
    supplier: supplierA,
    orders,
    payments,
    mode: RANGE_STATEMENT_MODE,
    fromDate: "2026-07-05",
    toDate: "2026-07-20",
    ...callbacks
  });

  assert.equal(statement.mode, RANGE_STATEMENT_MODE);
  assert.equal(statement.paymentHistoryIncluded, true);
  assert.equal(statement.hasRunningBalance, true);
  assert.equal(statement.totals.rawOpeningBalance, 100);
  assert.equal(statement.totals.preRangeOrderCost, 200);
  assert.equal(statement.totals.preRangePayments, 40);
  assert.equal(statement.broughtForward, 260);
  assert.equal(statement.openingRow.balance, 260);

  assert.deepEqual(statement.orders.map((order) => order.orderId), ["in-a-1", "in-a-2"]);
  assert.equal(statement.orders[0].rows.length, 2);
  assert.deepEqual(statement.orders[0].rows[0], {
    rowId: "row-a1",
    line: 1,
    description: "زجاج شفاف 6 مم",
    quantity: 20,
    parentOrderId: "in-a-1"
  });

  assert.deepEqual(statement.payments.map((payment) => payment.paymentId), ["payment-in-a"]);
  assert.deepEqual(
    {
      date: statement.payments[0].date,
      amount: statement.payments[0].amount,
      method: statement.payments[0].method,
      reference: statement.payments[0].reference,
      notes: statement.payments[0].notes
    },
    {
      date: "2026-07-15",
      amount: 60,
      method: "bank",
      reference: "BANK-60",
      notes: "تحويل بنكي"
    }
  );

  assert.deepEqual(
    statement.transactions.map((entry) => [entry.type, entry.id, entry.balanceBefore, entry.balanceAfter]),
    [
      ["order", "in-a-1", 260, 560],
      ["payment", "payment-in-a", 560, 500],
      ["order", "in-a-2", 500, 550]
    ]
  );
  assert.deepEqual(statement.groups.map((group) => group.date), [
    "2026-07-10",
    "2026-07-15",
    "2026-07-20"
  ]);
  assert.equal(statement.totals.orderCost, 350);
  assert.equal(statement.totals.payments, 60);
  assert.equal(statement.totals.closingBalance, 550);
  assert.deepEqual(statement.finalTotal, { label: "الرصيد الختامي", value: 550 });
  assert.equal(statement.transactions.some((entry) => entry.id === "in-b"), false);
  assert.equal(statement.transactions.some((entry) => entry.id === "cancelled-a"), false);
});

test("range boundaries are inclusive and reversed inputs are normalized", () => {
  const statement = buildRangeSupplierStatement({
    supplier: supplierA,
    orders,
    payments,
    mode: "range",
    fromDate: "2026-07-20",
    toDate: "2026-07-10",
    ...callbacks
  });

  assert.equal(statement.fromDate, "2026-07-10");
  assert.equal(statement.toDate, "2026-07-20");
  assert.deepEqual(statement.orders.map((order) => order.orderId), ["in-a-1", "in-a-2"]);
  assert.deepEqual(statement.payments.map((payment) => payment.paymentId), ["payment-in-a"]);
});

test("selected-orders mode deduplicates, isolates supplier, excludes payments/opening, and totals only selected orders", () => {
  const statement = buildSelectedOrdersSupplierStatement({
    supplier: supplierA,
    orders,
    payments,
    mode: SELECTED_ORDERS_STATEMENT_MODE,
    selectedOrderIds: [
      "in-a-1",
      "in-a-1",
      "after-a",
      "in-b",
      "cancelled-a",
      "missing"
    ],
    ...callbacks
  });

  assert.equal(statement.mode, SELECTED_ORDERS_STATEMENT_MODE);
  assert.equal(statement.paymentHistoryIncluded, false);
  assert.equal(statement.hasRunningBalance, false);
  assert.deepEqual(statement.selectedOrderIds, ["in-a-1", "after-a"]);
  assert.deepEqual(statement.orders.map((order) => order.orderId), ["in-a-1", "after-a"]);
  assert.equal(statement.totalSelectedOrders, 800);
  assert.deepEqual(statement.finalTotal, {
    label: SELECTED_ORDERS_TOTAL_LABEL,
    value: 800
  });
  assert.equal(SELECTED_ORDERS_TOTAL_LABEL, "إجمالي الطلبات المحددة");
  assert.equal(Object.hasOwn(statement, "payments"), false);
  assert.equal(Object.hasOwn(statement, "openingRow"), false);
  assert.equal(Object.hasOwn(statement, "transactions"), false);
  assert.equal(Object.hasOwn(statement, "closingBalance"), false);
});

test("supplier matching trusts explicit IDs before duplicate names", () => {
  const sameNameDifferentIdOrder = {
    id: "wrong-id",
    supplierId: supplierB.id,
    supplierName: supplierA.name,
    date: "2026-07-10",
    status: "ordered",
    supplierCost: 123
  };
  const statement = buildSupplierStatement({
    supplier: supplierA,
    orders: [sameNameDifferentIdOrder],
    payments: [],
    mode: "selected",
    selectedOrderIds: ["wrong-id"],
    ...callbacks
  });

  assert.deepEqual(statement.orders, []);
  assert.equal(statement.totalSelectedOrders, 0);
});

test("order picker search is supplier-scoped and searches number, customer, and project", () => {
  const byNumber = filterSupplierOrders({
    supplier: supplierA,
    orders,
    query: "001278",
    ...callbacks
  });
  assert.deepEqual(byNumber.map((order) => order.id), ["in-a-1"]);

  const byCustomer = filterSupplierOrders({
    supplier: supplierA,
    orders,
    query: "الهدى",
    ...callbacks
  });
  assert.deepEqual(byCustomer.map((order) => order.id), ["in-a-2"]);

  const byProject = filterSupplierOrders({
    supplier: supplierA,
    orders,
    query: "واجهة",
    ...callbacks
  });
  assert.deepEqual(byProject.map((order) => order.id), ["pre-a", "after-a"]);
  assert.equal(byProject.some((order) => order.id === "in-b"), false);
  assert.equal(byProject.some((order) => order.id === "cancelled-a"), false);
});

test("stable selection utilities preserve existing order, avoid duplicates, and remove one ID", () => {
  assert.deepEqual(normalizeSelectedOrderIds(["in-a-1", "in-a-1", "", null, "after-a"]), [
    "in-a-1",
    "after-a"
  ]);
  assert.deepEqual(stableOrderIds([orders[1], orders[2], orders[1]], callbacks.orderKey), [
    "in-a-1",
    "in-a-2"
  ]);

  const selected = selectAllFilteredOrderIds(
    ["after-a", "in-a-1"],
    [orders[1], orders[2], orders[1]],
    callbacks.orderKey
  );
  assert.deepEqual(selected, ["after-a", "in-a-1", "in-a-2"]);
  assert.deepEqual(removeSelectedOrderId(selected, "in-a-1"), ["after-a", "in-a-2"]);
});
