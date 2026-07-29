export const RANGE_STATEMENT_MODE = "range";
export const SELECTED_ORDERS_STATEMENT_MODE = "selected-orders";
export const SELECTED_ORDERS_TOTAL_LABEL = "إجمالي الطلبات المحددة";

const RANGE_CLOSING_LABEL = "الرصيد الختامي";
const BROUGHT_FORWARD_LABEL = "رصيد مرحل";

function cleanText(value) {
  return String(value ?? "").trim();
}

function comparableText(value) {
  return cleanText(value)
    .toLocaleLowerCase()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/\s+/g, " ");
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function firstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

export function defaultOrderKey(order = {}) {
  return cleanText(firstValue(order, [
    "id",
    "orderId",
    "order_id",
    "orderNo",
    "order_no",
    "documentId",
    "document_id"
  ]));
}

export function normalizeSelectedOrderIds(values = []) {
  const list = values instanceof Set
    ? [...values]
    : Array.isArray(values)
      ? values
      : values === undefined || values === null || values === ""
        ? []
        : [values];
  const seen = new Set();
  const result = [];
  for (const value of list) {
    const key = cleanText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

function supplierId(source = {}) {
  return cleanText(firstValue(source, ["id", "supplierId", "supplier_id"]));
}

function supplierName(source = {}) {
  if (typeof source === "string") return cleanText(source);
  return cleanText(firstValue(source, ["name", "supplierName", "supplier_name"]));
}

export function belongsToSupplier(record = {}, supplier = {}) {
  const expectedId = supplierId(supplier);
  const actualId = cleanText(firstValue(record, ["supplierId", "supplier_id"]));
  if (expectedId && actualId) return expectedId === actualId;

  const expectedName = comparableText(supplierName(supplier));
  const actualName = comparableText(firstValue(record, ["supplierName", "supplier_name"]));
  return !!expectedName && expectedName === actualName;
}

export function statementDateKey(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  const isoPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix) return isoPrefix[1];
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function orderDate(order = {}) {
  return statementDateKey(firstValue(order, [
    "date",
    "orderDate",
    "order_date",
    "issueDate",
    "issue_date",
    "createdAt",
    "created_at"
  ]));
}

function paymentDate(payment = {}) {
  return statementDateKey(firstValue(payment, [
    "paidAt",
    "paid_at",
    "date",
    "createdAt",
    "created_at"
  ]));
}

function normalizedRange(fromDate, toDate) {
  let from = statementDateKey(fromDate);
  let to = statementDateKey(toDate);
  if (from && to && from > to) [from, to] = [to, from];
  return { fromDate: from, toDate: to };
}

function dateInRange(date, fromDate, toDate) {
  if (!date) return !fromDate && !toDate;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

function dateBefore(date, fromDate) {
  return !!date && !!fromDate && date < fromDate;
}

function defaultOrderCost(order = {}) {
  const directCost = firstValue(order, ["supplierCost", "supplier_cost"]);
  return finiteNumber(directCost !== ""
    ? directCost
    : firstValue(order.totals || {}, ["supplierCost", "supplier_cost"]));
}

function defaultOrderRows(order = {}) {
  return Array.isArray(order.rows) ? order.rows : [];
}

function defaultRowDetails(row) {
  return row;
}

function defaultIsPayable() {
  return true;
}

function orderBlock(order, sourceIndex, callbacks) {
  const key = cleanText(callbacks.orderKey(order));
  const rows = callbacks.getOrderRows(order);
  const sourceRows = Array.isArray(rows) ? rows : [];
  return {
    type: "order",
    id: key || `order-${sourceIndex + 1}`,
    orderId: key,
    order,
    orderNo: cleanText(firstValue(order, ["orderNo", "order_no"])),
    documentId: cleanText(firstValue(order, ["documentId", "document_id"])),
    date: orderDate(order),
    customerName: cleanText(firstValue(order, ["customerName", "customer_name"])),
    project: cleanText(order.project),
    status: cleanText(order.status),
    cost: finiteNumber(callbacks.getOrderCost(order)),
    rows: sourceRows.map((row, rowIndex) => callbacks.getRowDetails(row, rowIndex, order))
  };
}

function paymentRow(payment, sourceIndex) {
  const id = cleanText(firstValue(payment, ["id", "paymentId", "payment_id"])) || `payment-${sourceIndex + 1}`;
  return {
    type: "payment",
    id,
    paymentId: id,
    payment,
    date: paymentDate(payment),
    amount: finiteNumber(payment.amount),
    method: cleanText(payment.method),
    reference: cleanText(firstValue(payment, [
      "reference",
      "paymentReference",
      "payment_reference",
      "referenceNo",
      "reference_no",
      "ref"
    ])),
    notes: cleanText(payment.notes)
  };
}

function statementCallbacks(options = {}) {
  return {
    getOrderCost: typeof options.getOrderCost === "function" ? options.getOrderCost : defaultOrderCost,
    getOrderRows: typeof options.getOrderRows === "function" ? options.getOrderRows : defaultOrderRows,
    getRowDetails: typeof options.getRowDetails === "function" ? options.getRowDetails : defaultRowDetails,
    isPayable: typeof options.isPayable === "function" ? options.isPayable : defaultIsPayable,
    orderKey: typeof options.orderKey === "function" ? options.orderKey : defaultOrderKey
  };
}

function supplierOrders(options, callbacks) {
  return (Array.isArray(options.orders) ? options.orders : [])
    .map((order, sourceIndex) => ({ order, sourceIndex }))
    .filter(({ order }) => belongsToSupplier(order, options.supplier) && callbacks.isPayable(order));
}

function supplierPayments(options) {
  return (Array.isArray(options.payments) ? options.payments : [])
    .map((payment, sourceIndex) => ({ payment, sourceIndex }))
    .filter(({ payment }) => belongsToSupplier(payment, options.supplier));
}

function sortTransactions(left, right) {
  const dateOrder = (left.date || "9999-12-31").localeCompare(right.date || "9999-12-31");
  if (dateOrder) return dateOrder;
  const typeOrder = (left.type === "order" ? 0 : 1) - (right.type === "order" ? 0 : 1);
  if (typeOrder) return typeOrder;
  return left.sourceIndex - right.sourceIndex;
}

function rangeStatement(options, callbacks) {
  const { fromDate, toDate } = normalizedRange(options.fromDate, options.toDate);
  const openingBalance = finiteNumber(firstValue(options.supplier, ["openingBalance", "opening_balance"]));
  const orders = supplierOrders(options, callbacks);
  const payments = supplierPayments(options);

  const preRangeOrderCost = fromDate
    ? orders.reduce((sum, item) => dateBefore(orderDate(item.order), fromDate)
      ? sum + finiteNumber(callbacks.getOrderCost(item.order))
      : sum, 0)
    : 0;
  const preRangePayments = fromDate
    ? payments.reduce((sum, item) => dateBefore(paymentDate(item.payment), fromDate)
      ? sum + finiteNumber(item.payment.amount)
      : sum, 0)
    : 0;
  const broughtForward = openingBalance + preRangeOrderCost - preRangePayments;

  const transactions = [
    ...orders
      .filter(({ order }) => dateInRange(orderDate(order), fromDate, toDate))
      .map(({ order, sourceIndex }) => ({ ...orderBlock(order, sourceIndex, callbacks), sourceIndex })),
    ...payments
      .filter(({ payment }) => dateInRange(paymentDate(payment), fromDate, toDate))
      .map(({ payment, sourceIndex }) => ({ ...paymentRow(payment, sourceIndex), sourceIndex }))
  ].sort(sortTransactions);

  let runningBalance = broughtForward;
  const balancedTransactions = transactions.map((transaction) => {
    const balanceBefore = runningBalance;
    runningBalance += transaction.type === "order" ? transaction.cost : -transaction.amount;
    const { sourceIndex, ...publicTransaction } = transaction;
    return {
      ...publicTransaction,
      balanceBefore,
      balanceAfter: runningBalance,
      runningBalance
    };
  });

  const groupsByDate = new Map();
  for (const transaction of balancedTransactions) {
    const date = transaction.date;
    const groupKey = date || "undated";
    if (!groupsByDate.has(groupKey)) {
      groupsByDate.set(groupKey, {
        id: `date-${groupKey}`,
        date,
        label: date || "بدون تاريخ",
        openingBalance: transaction.balanceBefore,
        entries: [],
        orders: [],
        payments: [],
        orderCost: 0,
        paymentTotal: 0,
        closingBalance: transaction.balanceBefore
      });
    }
    const group = groupsByDate.get(groupKey);
    group.entries.push(transaction);
    if (transaction.type === "order") {
      group.orders.push(transaction);
      group.orderCost += transaction.cost;
    } else {
      group.payments.push(transaction);
      group.paymentTotal += transaction.amount;
    }
    group.closingBalance = transaction.balanceAfter;
  }

  const inRangeOrders = balancedTransactions.filter((transaction) => transaction.type === "order");
  const inRangePayments = balancedTransactions.filter((transaction) => transaction.type === "payment");
  const orderCost = inRangeOrders.reduce((sum, order) => sum + order.cost, 0);
  const paymentTotal = inRangePayments.reduce((sum, payment) => sum + payment.amount, 0);

  return {
    mode: RANGE_STATEMENT_MODE,
    supplier: options.supplier,
    fromDate,
    toDate,
    paymentHistoryIncluded: true,
    hasRunningBalance: true,
    openingRow: {
      type: "opening",
      id: `opening-${supplierId(options.supplier) || comparableText(supplierName(options.supplier)) || "supplier"}`,
      label: BROUGHT_FORWARD_LABEL,
      debit: Math.max(0, broughtForward),
      credit: Math.max(0, -broughtForward),
      balance: broughtForward
    },
    broughtForward,
    groups: [...groupsByDate.values()],
    transactions: balancedTransactions,
    orders: inRangeOrders,
    payments: inRangePayments,
    totals: {
      rawOpeningBalance: openingBalance,
      preRangeOrderCost,
      preRangePayments,
      broughtForward,
      orderCost,
      payments: paymentTotal,
      closingBalance: runningBalance
    },
    finalTotal: {
      label: RANGE_CLOSING_LABEL,
      value: runningBalance
    }
  };
}

function selectedOrdersStatement(options, callbacks) {
  const selectedOrderIds = normalizeSelectedOrderIds(options.selectedOrderIds);
  const availableOrders = new Map();
  for (const { order, sourceIndex } of supplierOrders(options, callbacks)) {
    const key = cleanText(callbacks.orderKey(order));
    if (!key || availableOrders.has(key)) continue;
    availableOrders.set(key, { order, sourceIndex });
  }

  const orders = selectedOrderIds
    .map((key) => availableOrders.get(key))
    .filter(Boolean)
    .map(({ order, sourceIndex }) => orderBlock(order, sourceIndex, callbacks));
  const totalSelectedOrders = orders.reduce((sum, order) => sum + order.cost, 0);

  return {
    mode: SELECTED_ORDERS_STATEMENT_MODE,
    supplier: options.supplier,
    paymentHistoryIncluded: false,
    hasRunningBalance: false,
    selectedOrderIds: orders.map((order) => order.orderId),
    orders,
    totalSelectedOrders,
    finalTotal: {
      label: SELECTED_ORDERS_TOTAL_LABEL,
      value: totalSelectedOrders
    }
  };
}

function normalizedMode(mode) {
  const value = comparableText(mode).replace(/[_\s]+/g, "-");
  return ["selected", "selected-order", "selected-orders", "orders"].includes(value)
    ? SELECTED_ORDERS_STATEMENT_MODE
    : RANGE_STATEMENT_MODE;
}

export function buildSupplierStatement(options = {}) {
  const resolvedOptions = {
    ...options,
    mode: normalizedMode(options.mode)
  };
  return resolvedOptions.mode === SELECTED_ORDERS_STATEMENT_MODE
    ? buildSelectedOrdersSupplierStatement(resolvedOptions)
    : buildRangeSupplierStatement(resolvedOptions);
}

export function buildRangeSupplierStatement(options = {}) {
  return rangeStatement(
    { ...options, mode: RANGE_STATEMENT_MODE },
    statementCallbacks(options)
  );
}

export function buildSelectedOrdersSupplierStatement(options = {}) {
  return selectedOrdersStatement(
    { ...options, mode: SELECTED_ORDERS_STATEMENT_MODE },
    statementCallbacks(options)
  );
}

export function filterSupplierOrders({
  supplier = {},
  orders = [],
  query = "",
  getOrderCost,
  isPayable,
  orderKey,
  getSearchText
} = {}) {
  const callbacks = statementCallbacks({ getOrderCost, isPayable, orderKey });
  const needle = comparableText(query);
  return supplierOrders({ supplier, orders }, callbacks)
    .map(({ order }) => order)
    .filter((order) => {
      if (!cleanText(callbacks.orderKey(order))) return false;
      if (!needle) return true;
      const customText = typeof getSearchText === "function" ? getSearchText(order) : "";
      const haystack = comparableText([
        callbacks.orderKey(order),
        firstValue(order, ["orderNo", "order_no"]),
        firstValue(order, ["documentId", "document_id"]),
        firstValue(order, ["customerName", "customer_name"]),
        order.project,
        order.date,
        callbacks.getOrderCost(order),
        customText
      ].join(" "));
      return haystack.includes(needle);
    });
}

export function stableOrderIds(orders = [], orderKey = defaultOrderKey) {
  return normalizeSelectedOrderIds((Array.isArray(orders) ? orders : []).map((order) => orderKey(order)));
}

export function selectAllFilteredOrderIds(
  selectedOrderIds = [],
  filteredOrders = [],
  orderKey = defaultOrderKey
) {
  return normalizeSelectedOrderIds([
    ...normalizeSelectedOrderIds(selectedOrderIds),
    ...stableOrderIds(filteredOrders, orderKey)
  ]);
}

export function removeSelectedOrderId(selectedOrderIds = [], orderId = "") {
  const target = cleanText(orderId);
  return normalizeSelectedOrderIds(selectedOrderIds).filter((id) => id !== target);
}
