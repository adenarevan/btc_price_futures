import { randomUUID } from "node:crypto";
import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { getDb } from "./firebase/admin";
import { AppError } from "./errors";
import { hash } from "./portfolio/ledger";
import type {
  AccountContext,
  PaperAccount,
  Position,
  TradingSettings,
} from "./domain";
export function encode(value: unknown, key = ""): unknown {
  if (
    typeof value === "number" &&
    (/At$/.test(key) ||
      [
        "fundingTime",
        "nextFundingTime",
        "serverTime",
        "fundingCursor",
        "lastExpectedFundingTime",
        "lastConfirmedFundingTime",
        "checkedThrough",
      ].includes(key))
  )
    return Timestamp.fromMillis(value);
  if (Array.isArray(value)) return value.map((x) => encode(x));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, encode(v, k)]),
    );
  return value;
}
export function decode<T>(value: unknown): T {
  if (value instanceof Timestamp) return value.toMillis() as T;
  if (Array.isArray(value)) return value.map((x) => decode(x)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, decode(v)]),
    ) as T;
  return value as T;
}
export const path = (uid: string, collection: string, id: string) =>
  `users/${uid}/${collection}/${id}`;
export async function read<T>(document: string): Promise<T | null> {
  const d = await getDb().doc(document).get();
  return d.exists ? decode<T>(d.data()) : null;
}
export async function page<T>(
  uid: string,
  collection: string,
  order: string,
  opts: { cursor?: string; limit?: number; filter?: [string, string] } = {},
) {
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 25));
  let query = getDb()
    .collection(`users/${uid}/${collection}`)
    .where("accountId", "==", "paper-futures-v1")
    .orderBy(order, "desc")
    .orderBy("__name__", "desc");
  if (opts.filter) query = query.where(opts.filter[0], "==", opts.filter[1]);
  if (opts.cursor) {
    if (!/^[\w-]{1,128}$/.test(opts.cursor))
      throw new AppError("INPUT_INVALID");
    const c = await getDb()
      .doc(path(uid, collection, opts.cursor))
      .get();
    if (!c.exists || c.data()?.accountId !== "paper-futures-v1")
      throw new AppError("INPUT_INVALID");
    query = query.startAfter(c);
  }
  const result = await query.limit(limit + 1).get(),
    docs = result.docs.slice(0, limit);
  return {
    items: docs.map((d) => decode<T>({ ...d.data(), id: d.id })),
    nextCursor: result.size > limit ? docs.at(-1)!.id : null,
  };
}
export async function context(uid: string): Promise<AccountContext> {
  const [account, positions] = await Promise.all([
    read<PaperAccount>(path(uid, "accounts", "paper-futures-v1")),
    getDb()
      .collection(`users/${uid}/positions`)
      .where("accountId", "==", "paper-futures-v1")
      .where("status", "in", [
        "OPEN",
        "CLOSED_PENDING_FUNDING",
        "LIQUIDATED_SIM",
      ])
      .limit(100)
      .get(),
  ]);
  if (!account || account.schemaVersion !== 2)
    throw new AppError("ACCOUNT_NOT_READY", 503);
  return {
    account,
    positions: positions.docs
      .map((d) => decode<Position>(d.data()))
      .filter((p) => p.status === "OPEN" || !p.fundingComplete),
  };
}
export async function settings(uid: string) {
  const cfg = await read<TradingSettings>(path(uid, "settings", "trading"));
  if (!cfg) throw new AppError("ACCOUNT_NOT_READY", 503);
  return cfg;
}
export function put(
  tx: Transaction,
  document: string,
  value: object,
  create = false,
) {
  const ref = getDb().doc(document),
    data = encode(value) as Record<string, unknown>;
  if (create) tx.create(ref, data);
  else tx.set(ref, data);
}
export interface Lease {
  key: string;
  owner: string;
  token: number;
  until: number;
}
export async function acquire(key: string, duration = 90000): Promise<Lease> {
  const ref = getDb().doc(`locks/${hash(key)}`),
    owner = randomUUID(),
    now = Date.now();
  return getDb().runTransaction(async (tx) => {
    const previous = (await tx.get(ref)).data();
    if (previous && Number(previous.until) > now)
      throw new AppError("RUN_IN_PROGRESS", 409, true);
    const lease = {
      key,
      owner,
      token: Number(previous?.token ?? 0) + 1,
      until: now + duration,
    };
    tx.set(ref, lease);
    return lease;
  });
}
export async function assertLease(tx: Transaction, lease: Lease) {
  const current = (
    await tx.get(getDb().doc(`locks/${hash(lease.key)}`))
  ).data();
  if (
    current?.owner !== lease.owner ||
    current?.token !== lease.token ||
    Number(current?.until) <= Date.now()
  )
    throw new AppError("STALE_LEASE", 409, true);
}
export async function release(lease: Lease) {
  await getDb().runTransaction(async (tx) => {
    const ref = getDb().doc(`locks/${hash(lease.key)}`),
      current = (await tx.get(ref)).data();
    if (current?.owner === lease.owner && current?.token === lease.token)
      tx.update(ref, { until: 0 });
  });
}
export async function reserveQuota(uid: string, limit: number) {
  const ref = getDb().doc(
    path(uid, "usage", new Date().toISOString().slice(0, 10)),
  );
  await getDb().runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (Number(d?.reserved ?? 0) >= limit) throw new AppError("AI_QUOTA", 429);
    tx.set(
      ref,
      {
        reserved: Number(d?.reserved ?? 0) + 1,
        inputTokens: Number(d?.inputTokens ?? 0),
        outputTokens: Number(d?.outputTokens ?? 0),
      },
      { merge: true },
    );
  });
}
