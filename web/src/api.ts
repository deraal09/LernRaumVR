export interface Health {
  status: 'ok' | 'error';
  version?: string;
  db: boolean;
  freeBytes?: number;
}

export async function getHealth(): Promise<Health> {
  const res = await fetch('/api/health');
  return (await res.json()) as Health;
}
