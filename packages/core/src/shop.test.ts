// The shop fixture (shop.table, D37): four linked tables, with formulas
// reading across them, up to two tables deep. The expected values were
// worked out independently of the evaluator, from the fixture's own rows,
// when the fixture was written.

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRows } from "./workbook.js";
import { fixtureBundles } from "./test-fixtures.js";
import type { ParsedTable, Row } from "./types.js";

async function shop(): Promise<Record<string, ParsedTable>> {
  return (await fixtureBundles()).shop!.tables;
}

function computed(tables: Record<string, ParsedTable>, name: string): Row[] {
  const { rows, diagnostics } = computeRows(tables[name]!.schema, tables[name]!.rows, { tables, self: name });
  assert.deepEqual(diagnostics, [], name);
  return rows;
}

const by = (rows: Row[], field: string) => Object.fromEntries(rows.map((r) => [r.id, r[field]]));

test("an order line looks up its product's price and works out its total", async () => {
  const lines = computed(await shop(), "lines");
  const first = lines.find((r) => r.id === "de5mgeh4f39jwgr3qpi4uaqqoq")!;
  assert.equal(first.unit_price, 8.5);
  assert.equal(first.line_total, 17);
});

test("an order totals its lines, then adds shipping", async () => {
  const orders = computed(await shop(), "orders");
  assert.deepEqual(by(orders, "total"), {"ob4xghd7r9hqqs3ake4us1nt63": 32.5, "tkxyjc9eye14wwhp1qu1ct5dhd": 100.0, "a8k5z7ap4qsoy8d1d8gaj98ixf": 22.0, "e4978orkencyqquqdychdambwp": 52.5, "s6q8azgi1ro6hcmhdgw5wysc83": 29.0, "c3hydaasocm1mqdt9f4qahukpc": 31.5, "uiiz5asdafqto7468giry8g45z": 46.0, "o8ee5ux7cxjpwdmrnbeadp6tgz": 78.0, "3gj7ys9pzwkxp7i3dm7bjjufz6": 84.0, "am8adqxn1oubmfri713euckx7x": 31.5, "kf3rpts54th5zw6q8mf64wuqqe": 19.5, "5tbaybjdk4tzbwkq9on45j6q54": 21.5, "g86jbr7d4znp78r4xc7zzns3he": 65.0, "rsa389qbeuffe1hzot7ixz69xj": 85.0});
  assert.deepEqual(by(orders, "items"), {"ob4xghd7r9hqqs3ake4us1nt63": 3, "tkxyjc9eye14wwhp1qu1ct5dhd": 3, "a8k5z7ap4qsoy8d1d8gaj98ixf": 3, "e4978orkencyqquqdychdambwp": 1, "s6q8azgi1ro6hcmhdgw5wysc83": 3, "c3hydaasocm1mqdt9f4qahukpc": 3, "uiiz5asdafqto7468giry8g45z": 4, "o8ee5ux7cxjpwdmrnbeadp6tgz": 2, "3gj7ys9pzwkxp7i3dm7bjjufz6": 3, "am8adqxn1oubmfri713euckx7x": 4, "kf3rpts54th5zw6q8mf64wuqqe": 2, "5tbaybjdk4tzbwkq9on45j6q54": 2, "g86jbr7d4znp78r4xc7zzns3he": 6, "rsa389qbeuffe1hzot7ixz69xj": 3});
  assert.equal(orders.find((r) => r.id === "ob4xghd7r9hqqs3ake4us1nt63")!.city, "Manchester");
});

test("a customer's lifetime value sums their orders' totals, two tables deep", async () => {
  const customers = computed(await shop(), "customers");
  assert.deepEqual(by(customers, "lifetime_value"), {"bj1ghy45ym894an5x1ku56gur5": 116.5, "sqewfr5b4hunz4qe33ebcmy9s4": 43.5, "zt6cy3mx5fb7ozkbdb5knwy5qr": 211.0, "cwaamegmih8i4g7unp6d4amh3y": 114.0, "b44yqmx5oun9kmb51dh8q4qqtb": 31.5, "juhsk7aiywrpx1cexhe5ipgiuf": 78.0, "u7f71dnitqr9fspst36zszspec": 84.0, "igiw397mrupoxa6j6xjk54bzw4": 19.5});
  assert.deepEqual(by(customers, "order_count"), {"bj1ghy45ym894an5x1ku56gur5": 3, "sqewfr5b4hunz4qe33ebcmy9s4": 2, "zt6cy3mx5fb7ozkbdb5knwy5qr": 3, "cwaamegmih8i4g7unp6d4amh3y": 2, "b44yqmx5oun9kmb51dh8q4qqtb": 1, "juhsk7aiywrpx1cexhe5ipgiuf": 1, "u7f71dnitqr9fspst36zszspec": 1, "igiw397mrupoxa6j6xjk54bzw4": 1});
});

test("a product's units sold and revenue come from every line for it", async () => {
  const products = computed(await shop(), "products");
  assert.deepEqual(by(products, "units_sold"), {"8yni337fhkej6p95fhg4g9dni3": 3, "y37pw16qtpzop8uazkmxabk1wj": 4, "99f9rh1upykhpm8hqgocy8dcdt": 5, "ufs5khxeq6srikbgnenm1gk11t": 3, "ckdfth9ap3e5k5zyxwcx4zy5zy": 10, "pms7u6snpaizxau7e9pgonwgp3": 2, "9n6pm887izr8okqbdkawyqud5s": 7, "qcupmwhx8z417nisu3iz1axg9r": 3, "n16m34d35agej3rymwcjdqhbho": 3, "jf4a9dhmjmhatb496bbguo485w": 2});
  assert.deepEqual(by(products, "revenue"), {"8yni337fhkej6p95fhg4g9dni3": 27.0, "y37pw16qtpzop8uazkmxabk1wj": 22.0, "99f9rh1upykhpm8hqgocy8dcdt": 55.0, "ufs5khxeq6srikbgnenm1gk11t": 195.0, "ckdfth9ap3e5k5zyxwcx4zy5zy": 85.0, "pms7u6snpaizxau7e9pgonwgp3": 98.0, "9n6pm887izr8okqbdkawyqud5s": 84.0, "qcupmwhx8z417nisu3iz1axg9r": 19.5, "n16m34d35agej3rymwcjdqhbho": 28.5, "jf4a9dhmjmhatb496bbguo485w": 48.0});
});

test("the shop's orders and its customers agree on the grand total", async () => {
  const tables = await shop();
  const sum = (rows: Row[], f: string) => rows.reduce((a, r) => a + (r[f] as number), 0);
  assert.equal(sum(computed(tables, "orders"), "total"), 698.0);
  assert.equal(sum(computed(tables, "customers"), "lifetime_value"), 698.0);
});
