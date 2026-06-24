export interface ReleaseRow {
  version: string;
  notes: string | null;
  setup_url: string;
  portable_url: string;
  pub_date: string;
}

export interface ReleasePayload {
  version: string;
  notes: string | null;
  pubDate: string;
  assets: { setup: string; portable: string };
}

export function shapeRelease(row: ReleaseRow): ReleasePayload {
  return {
    version: row.version,
    notes: row.notes,
    pubDate: row.pub_date,
    assets: { setup: row.setup_url, portable: row.portable_url },
  };
}
