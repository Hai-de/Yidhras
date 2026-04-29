// Unified BigInt serialization for the Repository layer.
// All repository methods use these helpers to ensure consistent BigInt
// handling regardless of the underlying database provider (SQLite / PostgreSQL).
// SQLite stores BigInt as strings over the wire; PostgreSQL uses native bigint.
// These helpers guarantee that repository consumers always receive proper bigint
// values and that values written are provider-safe.

export function toBigInt(value: bigint | number | string): bigint {
  return BigInt(value);
}

export function toNullableBigInt(value: bigint | number | string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  return BigInt(value);
}

export function fromBigInt(value: bigint): string {
  return String(value);
}

export function fromNullableBigInt(value: bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}
