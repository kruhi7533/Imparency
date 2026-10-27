# Audit-trail integrity (ADM-017 / NEG-013)

## What is built

| Piece | Where |
|---|---|
| Hash chain on every `AdminActionLog` row (`seq`, `prevHash`, `hash`) | BEFORE INSERT trigger `audit_chain_append()` — migration `20261027150000_audit_hash_chain` |
| Append-only table (UPDATE / DELETE / TRUNCATE rejected) | triggers `AdminActionLog_append_only`, `AdminActionLog_no_truncate` (same migration) |
| Chain head (single row, locked `FOR UPDATE` per append) | `AuditChainHead` |
| Signed checkpoints of the head (HMAC-SHA256 with `AUDIT_CHAIN_KEY`) | `AuditChainCheckpoint`, `POST /api/admin/audit/checkpoint` |
| Live verifier — OK or first broken seq/id + reason | `GET /api/admin/audit/verify`, `lib/audit-chain.ts#verifyAuditChain` |
| Export with chain columns + `#chain-head` line | `GET /api/admin/audit/export` |
| Upload-to-verify an exported CSV | `POST /api/admin/audit/verify-export` |
| UI | `/admin/audit/integrity` (Verify, Record checkpoint, Verify file) |

### How a row is hashed

`hash = sha256( audit_chain_canonical(row) )`, where the canonical form is
`jsonb_build_object('v',1,'seq',…,'prevHash',…,'id',…,'adminId',…,'action',…,'entityType',…,'entityId',…,'oldValue',…,'newValue',…,'note',…,'metadata',…,'ipAddress',…,'userAgent',…,'schemaVersion',…,'createdAt',<ISO ms Z>)::text`.
jsonb renders keys in a fixed order (length, then bytewise) with fixed separators, so
the text is deterministic. `canonicalAuditText()` in `lib/audit-chain.ts` reproduces it
byte-for-byte (pinned against real trigger output in `tests/audit-chain.test.ts`), which is
what makes an exported CSV verifiable without trusting the server.

The trigger, not the app, assigns `seq`/`prevHash`/`hash`; anything a client sends for
them is overwritten. Appends serialise on the head row lock, so two concurrent inserts can
never take the same seq, and a rolled-back insert rolls the head back (no gap).
Existing rows were sealed oldest-first by the migration (genesis `prevHash` = 64 zeros).

### Verifier reasons

`HASH_MISMATCH` (row edited) · `PREV_MISMATCH` (row re-linked) · `GAP` (row deleted) ·
`UNCHAINED_ROW` (row written with the trigger disabled) · `HEAD_MISMATCH` (newest rows
deleted, or head rewritten) · `CHECKPOINT_MISMATCH` (chain rewritten after a checkpoint) ·
`CHECKPOINT_SIGNATURE_INVALID` (forged checkpoint).

Export verification adds `REORDERED`, `MISSING_ROWS` (contiguity for unfiltered exports;
re-running the recorded filters for filtered ones) and `NOT_IN_DATABASE` (a row edited
**and** re-hashed in the file — internally consistent, but not what the database holds).

## Threat model — honestly

**Detected**
- Anyone using the app: no route updates or deletes audit rows, and the database refuses it anyway.
- Someone with ordinary SQL write access who edits, deletes or reorders rows without
  recomputing the chain: the verifier names the first broken seq.
- An edited exported CSV (cell changed, row removed, rows swapped), including one whose
  hashes were recomputed by the editor — caught by the cross-check against the database.

**Not detected (by design limits)**
- A database **superuser** can disable the triggers, rewrite rows, recompute every hash
  and the head consistently. The chain alone cannot catch that — it lives in the same
  database it protects.
  - *Mitigation implemented:* signed checkpoints. With `AUDIT_CHAIN_KEY` set, each
    checkpoint is HMAC'd; a rewrite of any row at or before a checkpoint's seq fails
    `CHECKPOINT_MISMATCH`, and the attacker cannot mint a new valid checkpoint without the key.
    This only helps if the key is **not** reachable by the same person (keep it in the
    deployment secret store, not the database) and only covers rows up to the latest checkpoint.
  - *Mitigation to operate:* publish the head hash outside the platform periodically
    (board pack, an email to the auditor, a public commit). An externally held head is the
    only defence against an attacker who controls both the database and the key.
- Deleting checkpoints: the checkpoint table is append-only by trigger, but a superuser
  can bypass that too. Keep exported checkpoints (seq + hash + hmac) off-platform.
- Actions that were never logged. The chain proves the log was not changed, not that it is complete
  (`tests/admin-audit-coverage.test.ts` is the completeness guard).
- `logAdminAction` is best-effort: if the insert fails, the action still happens and the failure goes to
  `captureError` as fatal.

## Operational notes
- A `User` that appears as `adminId` on an audit row can no longer be hard-deleted (the
  FK's `ON DELETE SET NULL` is an UPDATE, which the trigger refuses). That is intended.
- Verification and checkpoint creation are themselves logged (`AUDIT_CHAIN_VERIFIED`,
  `AUDIT_EXPORT_VERIFIED`, `AUDIT_CHECKPOINT_CREATED`). Admin sub-role AUDITOR may run
  verify / verify-export (read routes in `lib/admin-roles.ts`), not create checkpoints.
- Repairing a broken chain is deliberately not a feature. Investigate from the reported
  seq; the evidence is the break itself.
