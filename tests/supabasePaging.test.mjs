import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCompleteGlassData,
  loadAllRpcPages,
  loadAllRpcPagesCompat,
  loadGlassDataCountsCompat
} from "../src/supabasePaging.js";

test("loads every deterministic RPC page beyond the 1000-row API cap", async () => {
  const source = Array.from({ length: 2053 }, (_, index) => ({ id: `row-${index + 1}` }));
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: source.slice(args.p_offset, args.p_offset + args.p_limit), error: null };
    }
  };

  const rows = await loadAllRpcPages(client, "load_glass_order_rows_page");

  assert.equal(rows.length, 2053);
  assert.deepEqual(calls.map((call) => call.args.p_offset), [0, 1000, 2000]);
  assert.deepEqual(calls.map((call) => call.args.p_limit), [1000, 1000, 1000]);
  assert.equal(rows[2052].id, "row-2053");
});

test("loads count-bounded pages concurrently while preserving deterministic order", async () => {
  const source = Array.from({ length: 3200 }, (_, index) => ({ id: `row-${index + 1}` }));
  let active = 0;
  let maxActive = 0;
  const client = {
    async rpc(_name, args) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, args.p_offset === 0 ? 8 : 2));
      active -= 1;
      return { data: source.slice(args.p_offset, args.p_offset + args.p_limit), error: null };
    }
  };

  const rows = await loadAllRpcPages(client, "load_glass_order_rows_page", {}, {
    expectedCount: source.length,
    concurrency: 3
  });

  assert.equal(rows.length, source.length);
  assert.deepEqual(rows.map((row) => row.id), source.map((row) => row.id));
  assert.equal(maxActive, 3);
});

test("falls back to range-paged legacy RPCs while the paging migration is unavailable", async () => {
  const source = Array.from({ length: 2053 }, (_, index) => ({ id: `row-${index + 1}` }));
  const ranges = [];
  const client = {
    rpc(name, args = {}) {
      if (name === "load_glass_order_rows_page") {
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST202",
            message: "Could not find the function public.load_glass_order_rows_page(p_limit, p_offset) in the schema cache"
          }
        });
      }
      assert.equal(name, "load_glass_order_rows");
      assert.deepEqual(args, {});
      return {
        async range(from, to) {
          ranges.push([from, to]);
          return { data: source.slice(from, to + 1), error: null };
        }
      };
    }
  };

  const rows = await loadAllRpcPagesCompat(
    client,
    "load_glass_order_rows_page",
    "load_glass_order_rows"
  );

  assert.equal(rows.length, 2053);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("falls back to exact table counts while the count RPC is unavailable", async () => {
  const client = {
    async rpc(name) {
      assert.equal(name, "load_glass_data_counts");
      return {
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function public.load_glass_data_counts() in the schema cache"
        }
      };
    },
    from(table) {
      return {
        async select(columns, options) {
          assert.equal(columns, "id");
          assert.deepEqual(options, { count: "exact", head: true });
          return { data: null, error: null, count: table === "glass_orders" ? 1154 : 12056 };
        }
      };
    }
  };

  assert.deepEqual(await loadGlassDataCountsCompat(client), {
    order_count: 1154,
    row_count: 12056
  });
});

test("rejects a partial order-row result instead of replacing the current draft", () => {
  const orders = [{ id: "order-1" }];
  const rows = [{ id: "row-1", order_id: "order-1" }];

  assert.throws(
    () => assertCompleteGlassData(orders, rows, { order_count: 1, row_count: 13 }),
    (error) => error.code === "ORDER_DATA_COUNT_MISMATCH"
      && error.expected.rows === 13
      && error.loaded.rows === 1
  );
});

test("accepts all 13 independently identified rows for GO-001289", () => {
  const orders = [{ id: "go-001289" }];
  const rows = Array.from({ length: 13 }, (_, index) => ({
    id: `go-001289-row-${index + 1}`,
    order_id: "go-001289"
  }));

  assert.equal(assertCompleteGlassData(orders, rows, { order_count: 1, row_count: 13 }), true);
});

test("rejects duplicated row IDs even when aggregate counts match", () => {
  const orders = [{ id: "order-1" }];
  const rows = [
    { id: "row-1", order_id: "order-1" },
    { id: "row-1", order_id: "order-1" }
  ];

  assert.throws(
    () => assertCompleteGlassData(orders, rows, { order_count: 1, row_count: 2 }),
    /مفقود أو مكرر/
  );
});
