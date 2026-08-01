const DEFAULT_PAGE_SIZE = 1000;

function positivePageSize(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > DEFAULT_PAGE_SIZE) {
    throw new RangeError(`Supabase page size must be between 1 and ${DEFAULT_PAGE_SIZE}.`);
  }
  return parsed;
}

function nonNegativeExpectedCount(value) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RangeError("Supabase expected row count must be a non-negative integer.");
  }
  return parsed;
}

async function mapWithConcurrency(values, concurrency, callback) {
  const results = new Array(values.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, values.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(values[index], index);
    }
  }));
  return results;
}

/**
 * Load every page from a parameter-paged Supabase RPC.
 *
 * The database function must provide deterministic ordering and accept
 * `p_offset` and `p_limit`. Using explicit RPC parameters avoids silently
 * accepting PostgREST's configured maximum-row response as the complete data
 * set.
 */
export async function loadAllRpcPages(client, functionName, args = {}, options = {}) {
  if (!client || typeof client.rpc !== "function") throw new TypeError("A Supabase client is required.");
  const pageSize = positivePageSize(options.pageSize ?? DEFAULT_PAGE_SIZE);
  const expectedCount = nonNegativeExpectedCount(options.expectedCount);
  if (expectedCount !== null) {
    const offsets = Array.from({ length: Math.ceil(expectedCount / pageSize) }, (_, index) => index * pageSize);
    const pages = await mapWithConcurrency(offsets, options.concurrency ?? 4, async (offset) => {
      const result = await client.rpc(functionName, {
        ...args,
        p_offset: offset,
        p_limit: pageSize
      });
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) throw new TypeError(`${functionName} must return an array.`);
      return result.data;
    });
    return pages.flat();
  }
  const rows = [];

  for (let offset = 0; ; offset += pageSize) {
    const result = await client.rpc(functionName, {
      ...args,
      p_offset: offset,
      p_limit: pageSize
    });
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) {
      throw new TypeError(`${functionName} must return an array.`);
    }
    rows.push(...result.data);
    if (result.data.length < pageSize) break;
  }

  return rows;
}

export function isMissingRpcFunction(error, functionName = "") {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ");
  if (code !== "PGRST202" && !/could not find the function|schema cache/i.test(message)) return false;
  return !functionName || message.toLocaleLowerCase().includes(String(functionName).toLocaleLowerCase());
}

/**
 * Compatibility path for installations that have not received the explicit
 * paging migration yet. PostgREST range headers still page a set-returning RPC,
 * so the app can start safely instead of treating the first 1,000 rows as the
 * complete data set.
 */
export async function loadAllLegacyRpcRanges(client, functionName, args = {}, options = {}) {
  if (!client || typeof client.rpc !== "function") throw new TypeError("A Supabase client is required.");
  const pageSize = positivePageSize(options.pageSize ?? DEFAULT_PAGE_SIZE);
  const expectedCount = nonNegativeExpectedCount(options.expectedCount);
  if (expectedCount !== null) {
    const offsets = Array.from({ length: Math.ceil(expectedCount / pageSize) }, (_, index) => index * pageSize);
    const pages = await mapWithConcurrency(offsets, options.concurrency ?? 4, async (from) => {
      const query = client.rpc(functionName, args);
      if (!query || typeof query.range !== "function") {
        throw new TypeError(`${functionName} does not support PostgREST range paging.`);
      }
      const result = await query.range(from, from + pageSize - 1);
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) throw new TypeError(`${functionName} must return an array.`);
      return result.data;
    });
    return pages.flat();
  }
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const query = client.rpc(functionName, args);
    if (!query || typeof query.range !== "function") {
      throw new TypeError(`${functionName} does not support PostgREST range paging.`);
    }
    const result = await query.range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new TypeError(`${functionName} must return an array.`);
    rows.push(...result.data);
    if (result.data.length < pageSize) break;
  }

  return rows;
}

export async function loadAllRpcPagesCompat(
  client,
  pagedFunctionName,
  legacyFunctionName,
  args = {},
  options = {}
) {
  try {
    return await loadAllRpcPages(client, pagedFunctionName, args, options);
  } catch (error) {
    if (!isMissingRpcFunction(error, pagedFunctionName)) throw error;
    return loadAllLegacyRpcRanges(client, legacyFunctionName, args, options);
  }
}

export async function loadGlassDataCountsCompat(client) {
  if (!client || typeof client.rpc !== "function" || typeof client.from !== "function") {
    throw new TypeError("A Supabase client is required.");
  }

  const rpcResult = await client.rpc("load_glass_data_counts");
  if (!rpcResult.error) return rpcResult.data;
  if (!isMissingRpcFunction(rpcResult.error, "load_glass_data_counts")) throw rpcResult.error;

  const [ordersResult, rowsResult] = await Promise.all([
    client.from("glass_orders").select("id", { count: "exact", head: true }),
    client.from("glass_order_rows").select("id", { count: "exact", head: true })
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (rowsResult.error) throw rowsResult.error;

  return {
    order_count: Number(ordersResult.count),
    row_count: Number(rowsResult.count)
  };
}

export function assertCompleteGlassData(orders, rows, counts) {
  const expectedOrders = Number(counts?.order_count);
  const expectedRows = Number(counts?.row_count);
  if (!Number.isInteger(expectedOrders) || !Number.isInteger(expectedRows)) {
    throw new Error("تعذر التحقق من اكتمال بيانات الطلبات المحملة.");
  }
  if (orders.length !== expectedOrders || rows.length !== expectedRows) {
    const error = new Error(
      `لم تُحمّل جميع بيانات الطلبات بأمان. المتوقع ${expectedOrders} طلباً و${expectedRows} بنداً، `
      + `وتم تحميل ${orders.length} طلباً و${rows.length} بنداً. لم يتم استبدال البيانات الحالية.`
    );
    error.code = "ORDER_DATA_COUNT_MISMATCH";
    error.expected = Object.freeze({ orders: expectedOrders, rows: expectedRows });
    error.loaded = Object.freeze({ orders: orders.length, rows: rows.length });
    throw error;
  }

  const orderIds = new Set();
  for (const order of orders) {
    const id = String(order?.id || "").trim();
    if (!id || orderIds.has(id)) throw new Error("بيانات الطلبات المحملة تحتوي على معرّف مفقود أو مكرر.");
    orderIds.add(id);
  }

  const rowIds = new Set();
  for (const row of rows) {
    const id = String(row?.id || "").trim();
    const orderId = String(row?.order_id || "").trim();
    if (!id || rowIds.has(id)) throw new Error("بنود الطلبات المحملة تحتوي على معرّف مفقود أو مكرر.");
    if (!orderIds.has(orderId)) throw new Error("تم تحميل بند لا يتبع طلباً موجوداً في البيانات الكاملة.");
    rowIds.add(id);
  }

  return true;
}
