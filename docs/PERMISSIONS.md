# Permissions

How Workspace's permission model applies across file types. This document
covers the intended access-control semantics per format, the underlying
cryptographic approach, and links to the research that informs it.

Permissions are **not yet implemented**. This document captures the
intended design so that format and app decisions made today don't close
off the P2P permission model planned for later.

---

## Background

The P2P data layer spike (`workspace-sh/workspace-p2p-spike`) established
that Hypercore + UCAN is a viable foundation for Workspace's sync and
permission model. The key findings relevant here:

- Each peer's identity is a standards-compliant `did:key:z6Mk…` derived
  from an ed25519 keypair — the same format UCAN tooling (ucanto) expects.
- Permissions travel peer-to-peer as UCAN delegations. No relay or
  central server is required for the data or key distribution path.
- Hypercore's append-only replication is the sync layer; UCAN is the
  authorization layer. They compose cleanly because they operate at
  different levels.
- Revocation is **forward-only** by design and by necessity: once a peer
  has received and decrypted data, that exposure is accepted. Revocation
  prevents access to new data; it cannot retrieve data already received.
  This is the same contract as any system that delivers data to a client.

See [`workspace-p2p-spike/FINDINGS.md`](https://github.com/workspace-sh/workspace-p2p-spike/blob/develop/FINDINGS.md)
and [`workspace-p2p-spike/docs/ucan-prior-research.md`](https://github.com/workspace-sh/workspace-p2p-spike/blob/develop/docs/ucan-prior-research.md)
for the full technical background.

---

## Permission tiers by file type

### Simple formats — `.md`, `.canvas`

Markdown documents and JSON Canvas files have a flat permission model.
There are no fields, no rows, no sub-document structure that warrants
tiered access.

| Role   | Can do |
|--------|--------|
| `read` | View the document |
| `edit` | Read + write |
| `admin`| Edit + grant/revoke roles for this document |

**Cryptographic shape:** one encryption key per document, distributed via
a UCAN capability scoped to the document's Hypercore key:

```
with: "hypercore://<log-key-hex>"
can:  "table/read"   |  "table/edit"  |  "table/admin"
```

An admin's device delegates `table/read` or `table/edit` directly to a
peer's `did:key`. No tiers; no field-level complexity.

---

### Structured data — `.table/`

`.table/` files have a richer internal structure (rows, fields, bodies,
attachments) and can carry fields of varying sensitivity within the same
table. The permission model is tiered.

#### Default: document-level roles (same as simple formats)

For most tables — project trackers, task lists, shared knowledge bases —
document-level roles are sufficient. The same `read / edit / admin` model
applies. One encryption key per `.table/`; all fields visible to anyone
with `table/read`.

#### Field-level tiering (opt-in, for sensitive tables)

For tables that carry sensitive fields alongside public ones — HR records,
compensation data, personal details — fields can be assigned to a
named tier via the `x-tier` extension key in `schema.json` (the `x-`
prefix is defined in the spec as the extension namespace; readers must
ignore unknown keys):

```json
{
  "fields": [
    { "name": "name",       "type": "string"  },
    { "name": "team",       "type": "string"  },
    { "name": "manager",    "type": "string"  },
    { "name": "start_date", "type": "date",    "x-tier": 1 },
    { "name": "notes",      "type": "string",  "x-tier": 1, "format": "markdown" },
    { "name": "salary",     "type": "number",  "x-tier": 2 },
    { "name": "personal",   "type": "object",  "x-tier": 2 }
  ]
}
```

Fields without `x-tier` are tier 0 — visible to everyone in the org.

| Tier | Key  | Who holds it | Example fields |
|------|------|--------------|----------------|
| 0    | `K0` | All org members (granted on join) | Name, team, manager |
| 1    | `K1` | Managers + HR (delegated per report) | Start date, performance notes |
| 2    | `K2` | HR + self (tightly scoped) | Salary, personal contact details |

**How it works in practice (the employee database example):**

A row in `rows.ndjson` is written as a single JSON object, but each
field's value is encrypted with its tier's key before being written to
the Hypercore log. A peer without `K2` replicates all blocks — the
Hypercore log is fully distributed — but decrypts only the fields their
keys cover. The `schema.json` is unencrypted so every peer knows which
fields exist and which tier they belong to, even when they cannot read
the values.

```
Peer: Alice (self — holds K0, K1, K2 for her own record)
  → sees: name, team, manager, start_date, notes, salary, personal

Peer: Alice's manager (holds K0 for org, K1 for their reports)
  → sees: name, team, manager, start_date, notes
  → ciphertext: salary, personal

Peer: teammate (holds K0 for org only)
  → sees: name, team, manager
  → ciphertext: start_date, notes, salary, personal
```

Key distribution is peer-to-peer via UCAN delegation. An admin or HR
peer issues a UCAN that delegates `K1` or `K2` directly to another
peer's `did:key`. No relay or server handles the keys.

#### bodies/ and attachments/

Long-form bodies (`bodies/{id}.md`) and attachments inherit the
permission of the row they belong to. If a row contains only tier-0
fields, its body is unencrypted. If a row contains tier-1 or tier-2
fields, its body is encrypted with the highest tier present on that row.

A future refinement could allow per-body encryption at the attachment
level — parked until a concrete UX motivates it.

---

## Revocation

When a peer's access is revoked:

1. Their UCAN delegation is invalidated (forward-only — see Background).
2. The affected tier key (`K1` or `K2`) is rotated for new writes.
   Existing peers receive the new key via a fresh UCAN delegation.
3. The departing peer retains the old key and can decrypt historical
   data up to the point of revocation. This is accepted: the same
   contract applies to any SaaS product where a departing member has
   previously read sensitive data.

For document-level roles, the same applies: revoke the UCAN, rotate the
document encryption key, continue.

---

## Open questions (tracked in workspace-p2p-spike)

- **ucanto delegation for `K_n` keys** — does ucanto's capability model
  handle scoped key delivery cleanly, or does it need a custom capability
  type? ([workspace-p2p-spike #5](https://github.com/workspace-sh/workspace-p2p-spike/issues/5))
- **Concurrent edits to `rows.ndjson`** — two peers appending conflicting
  row updates need a merge strategy. The format defers this (D14); the
  P2P spike has not yet addressed it.
- **Mobile path** — react-native-bare-kit as the Hypercore host on iOS
  and Android. ([workspace-p2p-spike #6](https://github.com/workspace-sh/workspace-p2p-spike/issues/6))
- **`history.ndjson`** — the reserved extension (D14) for an audit log
  maps naturally to an additional Hypercore log per `.table/`. Parked
  until a concrete UX motivates it.
