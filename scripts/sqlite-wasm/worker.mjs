// SQLite in the browser for large tables (#126, Phase 3): streams a table's
// rows.ndjson into an index.sqlite kept in OPFS (the opfs-sahpool VFS: no
// special headers, works in Safari, Firefox and Chromium), then times the
// queries a view needs. Run through server.mjs; see README in LARGE-TABLES.md.
// A spike: it measures, it isn't the indexer. The modes are "memory",
// "opfs-fresh" (clear and build) and "opfs" (reopen what's there).

import sqlite3InitModule from "/sqlite/index.mjs";
const t = () => performance.now();
const ms = (a) => Math.round(performance.now() - a);
onmessage = async (e) => {
  try { postMessage({ done: true, result: await main(e.data) }); } catch (err) { postMessage({ error: String(err && err.stack || err) }); }
};
async function main({ n, mode }) {
  const out = { n, mode };
  const sqlite3 = await sqlite3InitModule();
  let db;
  if (mode === "memory") db = new sqlite3.oo1.DB(":memory:");
  else {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "spike", clearOnInit: mode === "opfs-fresh", initialCapacity: 6 });
    out.poolFiles = pool.getFileCount();
    db = new pool.OpfsSAHPoolDb("/index.sqlite");
  }
  const has = db.selectValue("select count(*) from sqlite_master where name='rows'");
  if (!has) {
    const t0 = t();
    db.exec(`pragma journal_mode=memory; pragma synchronous=off; pragma temp_store=memory; pragma cache_size=-262144;
      create table rows(rowid integer primary key, id text, title text, stage text, amount real, probability real, owner text, close_date text, note text);`);
    const res = await fetch(`/data/${n}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let rest = "", count = 0, fetchMs = 0;
    db.exec("begin");
    const stmt = db.prepare("insert into rows(id,title,stage,amount,probability,owner,close_date,note) values(?,?,?,?,?,?,?,?)");
    for (;;) {
      const f0 = t(); const { value, done } = await reader.read(); fetchMs += t() - f0;
      if (done) break;
      const text = rest + dec.decode(value, { stream: true });
      const lines = text.split("\n"); rest = lines.pop();
      for (const line of lines) { const r = JSON.parse(line); stmt.bind([r.id, r.title, r.stage, r.amount, r.probability, r.owner, r.close_date, r.note]).stepReset(); count++; }
    }
    if (rest.trim()) { const r = JSON.parse(rest); stmt.bind([r.id, r.title, r.stage, r.amount, r.probability, r.owner, r.close_date, r.note]).stepReset(); count++; }
    stmt.finalize(); db.exec("commit");
    out.loadMs = ms(t0); out.fetchMs = Math.round(fetchMs); out.rows = count;
    const t1 = t();
    db.exec("create index rows_id on rows(id); create index rows_stage_amount on rows(stage, amount); create index rows_close on rows(close_date);");
    out.indexMs = ms(t1);
    const t2 = t();
    db.exec("create virtual table fts using fts5(title, note, owner, content='rows', content_rowid='rowid'); insert into fts(fts) values('rebuild');");
    out.ftsMs = ms(t2);
    out.builtNow = true;
  } else out.builtNow = false;
  const q = (label, sql, bind) => { const a = t(); const r = db.selectArrays(sql, bind); out[label] = { ms: +(performance.now() - a).toFixed(1), rows: r.length, first: r[0] }; };
  const a = t(); out.count = db.selectValue("select count(*) from rows"); out.countMs = +(performance.now() - a).toFixed(1);
  q("view", "select rowid,id,title,stage,amount from rows where stage='won' order by amount desc limit 50");
  q("viewOffset", "select rowid,id,title,stage,amount from rows where stage='won' order by amount desc limit 50 offset 10000");
  q("sortByTitle", "select rowid,id,title from rows order by title limit 50");
  q("page", "select rowid,id,title,stage,amount from rows order by rowid limit 50 offset 500000");
  q("point", "select * from rows where id=?", [db.selectValue("select id from rows where rowid=?", [Math.floor(n / 2)])]);
  q("search", "select rowid from fts where fts match 'harbor audit' limit 50");
  q("groupTotals", "select stage, count(*), sum(amount) from rows group by stage");
  const e0 = t(); db.exec("update rows set title='Edited' where id='d5'"); out.editMs = +(performance.now() - e0).toFixed(1);
  db.close();
  return out;
}
