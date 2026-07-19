# Permissions

How Workspace's permission model applies across file types. This document
covers the intended access-control semantics per format, the underlying
cryptographic approach, and the engineering patterns that make it work
without third-party infrastructure.

Permissions are **not yet implemented**. This document captures the
intended design so that format and app decisions made today don't close
off the P2P permission model planned for later.

---

## Background

The P2P data layer spike (`workspace-sh/workspace-p2p-spike`) established
that Hypercore + UCAN + Autobase is a viable foundation for Workspace's
sync and permission model. The key findings relevant here:

- Each peer's identity is a standards-compliant `did:key:z6Mk…` derived
  from an ed25519 keypair — the same format UCAN tooling (ucanto) expects.
- Permissions travel peer-to-peer as UCAN delegations. No relay or
  central server is required for the data, key distribution, or
  authorisation paths.
- Hypercore's append-only replication is the sync layer; UCAN is the
  authorisation layer; Autobase is the multi-writer layer. They compose
  at different levels.
- Revocation is **forward-only** by design and by necessity: once a peer
  has received and decrypted data, that exposure is accepted. Revocation
  prevents access to *new* data; it cannot retrieve data already received.
  This is the same contract as any system that delivers data to a client.

See [`workspace-p2p-spike/FINDINGS.md`](https://github.com/workspace-sh/workspace-p2p-spike/blob/develop/FINDINGS.md)
and [`workspace-p2p-spike/docs/ucan-prior-research.md`](https://github.com/workspace-sh/workspace-p2p-spike/blob/develop/docs/ucan-prior-research.md)
for the full technical background.

---

## Two layers of keys

Every document uses two unrelated kinds of cryptographic key. Conflating
them leads to confusion — they do different jobs.

### Layer 1 — Hypercore writer keypair (ed25519)

Each Hypercore log has a keypair generated when the log is created.

- The **public half** is the log's address (32 bytes). Anyone with this
  value can ask the network for the log's blocks.
- The **secret half** authorises appends. Only the writer holds it.
- Blocks are signed with the secret key; peers verify with the public
  key during replication.

This layer controls **who can write** and is how the log is **discovered
and replicated**. It does not encrypt content.

### Layer 2 — symmetric encryption keys (`K0`, `K1`, `K2`, …)

Block *contents* are encrypted with symmetric keys (AES-256 or
equivalent) before being written.

- These keys are unrelated to the Hypercore writer keypair.
- Multiple tiers can coexist within a single log (different fields
  encrypted with different keys).
- They're distributed peer-to-peer via UCAN delegation (see *Key
  distribution* below).

This layer controls **who can read what**.

A block on disk looks roughly like:

```
[ block header — signed with Hypercore writer secret key ]
[ block body   — ciphertext( contents, encrypted with K_n ) ]
```

Replication checks the signature. Decryption uses the symmetric key.
**Two independent gates.**

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

**Cryptographic shape:** one symmetric key per document. The Hypercore
public address is shared among permitted peers via UCAN delegation; the
encryption key is wrapped and delivered alongside.

For multi-writer editing (multiple peers with `edit`), the document is
backed by Autobase — each writer has their own Hypercore log, and the
merged view is computed locally on every peer.

---

### Structured data — `.table/`

`.table/` files have a richer internal structure (rows, fields, bodies,
attachments) and can carry fields of varying sensitivity within the same
table. The permission model is tiered.

#### Default: document-level roles (same as simple formats)

For most tables — project trackers, task lists, shared knowledge bases —
document-level roles are sufficient. The same `read / edit / admin` model
applies. One encryption key per `.table/`; all fields visible to anyone
with `read`.

#### Field-level tiering (opt-in, for sensitive tables)

For tables that carry sensitive fields alongside public ones — HR
records, compensation data, personal details — fields can be assigned
to a named tier via the `x-tier` extension key in `schema.json` (the
`x-` prefix is defined in the spec as the extension namespace; readers
must ignore unknown keys):

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

A row in `rows.ndjson` is written as a single JSON object, but each
field's value is encrypted with its tier's key before being written to
the Hypercore log. A peer without `K2` replicates all blocks — the
Hypercore log is fully distributed — but decrypts only the fields their
keys cover. The `schema.json` is unencrypted so every peer knows which
fields exist and which tier they belong to, even when they cannot read
the values.

---

## Worked example — a 54-person org

To make the model concrete, here's a small org:

> 1 admin, 3 managers, 50 employees, with HR as a separate role (held
> alongside admin in small orgs, separable for larger orgs).

### Keys

```
K0_org           — 1 key, all 54 people hold it
K1_<manager>     — 1 key per manager, 3 total
K2_<employee>    — 1 key per employee, 50 total
────────────────────────────────────────────
54 symmetric keys
```

Admin is not a separate key — admin is the peer who issued all the
others and retained copies. "Admin" is a role, not a tier.

### Who holds what

| Role     | Keys held                                    | Can read                                                                  |
|----------|----------------------------------------------|---------------------------------------------------------------------------|
| Admin    | `K0_org` + all `K1`s + all `K2`s             | Everything, for everyone                                                  |
| Manager  | `K0_org` + `K1_<self>`                       | Public info (everyone's) + sensitive info (own reports only)              |
| Employee | `K0_org` + `K2_<self>`                       | Public info (everyone's) + own private info                               |
| HR       | `K0_org` + all `K2`s                         | Public info (everyone's) + private info (everyone's)                      |

### Multi-writer collaboration — Autobase

A single Hypercore has exactly one writer. The employee database
requires multiple writers (Alice edits her own contact info; HR edits
salary; her manager edits notes). This is what **Autobase** is for.

Each contributing peer keeps their own Hypercore log of edits. The
document's current state is a merged view computed locally on every peer:

```
Alice's edits  → Hypercore A  ┐
HR's edits     → Hypercore H  ├── Autobase merge → "Alice's current record"
Manager's edits→ Hypercore B  ┘
```

Encryption tiers still apply: each writer encrypts their fields with
the appropriate `K_n` before appending to their own log.

Autobase is part of the Holepunch stack, in production at Keet. Same
DHT, same Hyperswarm, no central server.

---

## Key distribution

UCAN delegations and the symmetric keys they authorise are *two
different artefacts*. The doc deliberately separates them.

### What UCAN carries

A UCAN is a signed capability token. It says:

> *"Issued by `did:key:zABC…` (the admin), the peer `did:key:zXYZ…` (the
> new employee) is authorised to access resource `<log-key>` at tier
> `K1`."*

UCANs are short-lived, chainable, and verifiable offline. They carry
*authorisation*, not the key itself.

### How the symmetric key actually arrives

The symmetric key (e.g. `K1_<manager>`) is delivered as a separate
**wrapped key blob**: the key material encrypted to the recipient's
ed25519 public key via X25519 ECDH. Only the recipient's matching secret
key can unwrap it.

Each delivery is a self-contained payload:

```
{
  ucan:          <signed delegation token>,
  wrapped_key:   <symmetric key, sealed to recipient's public key>,
  resource:      <hypercore log address this key applies to>
}
```

### The delivery channel — also a Hypercore

Key delivery uses the **same protocol as the documents themselves.**
There is no separate mailbox server, relay, or third-party infrastructure.

The org has a "key delivery" Hypercore log, replicated to every member.
Each block is one delivery payload addressed to one peer's DID. On
joining or coming online, a peer scans the log for blocks addressed to
them, unwraps the keys, and ignores the rest.

```
Key delivery Hypercore log (replicated to all org peers):

Block 0: { ucan: ..., wrapped_key: ..., recipient: did:key:zABC… }
Block 1: { ucan: ..., wrapped_key: ..., recipient: did:key:zDEF… }
Block 2: { ucan: ..., wrapped_key: ..., recipient: did:key:zGHI… }
...
```

Properties:
- Sender and recipient never need to be online simultaneously
- Any peer carries the message — it's just another Hypercore log
- Wrapped key blobs are tiny (~100 bytes each)
- No central infrastructure; the same DHT carries everything

This is the asynchronous secure messaging pattern, applied to key
distribution. It's how the system scales without requiring always-on
peers.

---

## Revocation — two levers

Revocation is forward-only at every layer. What an ex-peer *already
received* cannot be unsent. The design accepts this and provides two
independent levers to control what they receive *next*.

### Lever 1 — Encryption-layer revocation

1. The departing peer's UCAN for the affected key is invalidated.
2. The key is **rotated for future writes** — new blocks use a fresh
   symmetric key, distributed to remaining peers via the key delivery
   log above. (Past blocks remain encrypted with the old key; this is
   not re-encrypted, see *Two layers of keys* above.)
3. The departing peer retains the old key locally. They can still
   decrypt historical blocks they had already replicated. They cannot
   decrypt any new writes.

### Lever 2 — Topic-layer revocation

The Hypercore *public addresses* and the Hyperswarm *topic identifier*
are themselves a kind of metadata leak: even without decryption,
someone with these values can connect to the org's swarm, observe block
arrival timing, log lengths, and write patterns.

To close this lever:

1. The departing peer is dropped from the Hyperswarm topic via
   connection-time authentication. Org peers reject connections from
   peers that cannot present a current valid UCAN proving org
   membership.
2. The topic identifier may be rotated alongside `K0_org` on departure
   to invalidate the discoverability path entirely.

Encryption alone is not enough for full post-departure revocation.
**Topic membership is the second lever** — network-layer access,
distinct from encryption-layer access.

### Bodies and attachments

Long-form bodies (`bodies/{id}.md`) and attachments inherit the
permission of the row they belong to. If a row contains only tier-0
fields, its body is unencrypted (within the org). If a row contains
tier-1 or tier-2 fields, its body is encrypted with the highest tier
present on that row.

---

## Scaling

The simple model — one `K0_org` shared across all members, rotated on
every membership change — scales roughly to:

| Org size       | Approach                                              |
|----------------|-------------------------------------------------------|
| ≤ 500          | Simple `K0_org` + peer-to-peer UCAN delivery          |
| 500 – 10,000   | Same + asynchronous key delivery via Hypercore log    |
| 10,000+        | Add MLS (Messaging Layer Security) for group keys     |

The cost of `K0_org` rotation grows linearly with org size. At a few
hundred peers, that's trivial. At 10,000+, daily turnover means
constant rotation; the simple model becomes painful.

**MLS** ([RFC 9420](https://datatracker.ietf.org/doc/rfc9420/)) is the
IETF standard for group key agreement with frequent membership changes,
used by Signal/WhatsApp/Wickr. It does the same job in O(log n) per
change instead of O(n). It composes cleanly with the rest of the
design: replace the `K0_org` distribution mechanism with MLS group
state; everything else stays the same.

For Workspace's likely audience (small-to-medium teams), the simple
model is sufficient. Enterprise scale needs MLS as an upgrade path. Both
keep the system P2P.

---

## Metadata leakage — what's still observable

Encryption hides contents. It does not hide:

- The existence of a Hypercore log (the public address is visible to
  any peer on the topic)
- Log length and growth rate
- Block size and timing
- Writer identity (with Autobase, each writer's contributions are
  identifiable by their log)

Within the org, this is acceptable — active members already have
legitimate insight into colleagues' activity.

Post-departure, the topic-layer revocation (above) cuts off this
observation channel entirely.

For documents whose *existence itself* is sensitive (severance
discussions, redundancy planning), the answer is a separate Hyperswarm
topic with restricted membership — the document's public address is
never shared with the wider org.

---

## Open questions (tracked in `workspace-p2p-spike`)

- **ucanto delegation for `K_n` keys** — does ucanto's capability model
  handle scoped key delivery cleanly, or does it need a custom capability
  type? ([workspace-p2p-spike #5](https://github.com/workspace-sh/workspace-p2p-spike/issues/5))
- **Autobase merge semantics for `rows.ndjson`** — how do concurrent
  edits to the same field across writer logs resolve? Last-write-wins
  by timestamp, custom rules, or CRDTs on top? The format defers this
  (D14); the P2P spike has not yet validated Autobase as the answer.
- **Topic-layer connection authentication** — peers must present a
  current UCAN proving org membership before block exchange begins.
  Hyperswarm supports this in principle; the spike has not yet
  implemented it.
- **Mobile path** — react-native-bare-kit as the Hypercore host on iOS
  and Android. ([workspace-p2p-spike #6](https://github.com/workspace-sh/workspace-p2p-spike/issues/6))
- **MLS integration** — the upgrade path for enterprise-scale orgs.
  Out of scope for v1; design must not foreclose it.
- **`history.ndjson`** — the reserved extension (D14) for an audit log
  maps naturally to an additional Hypercore log per `.table/`. Parked
  until a concrete UX motivates it.
