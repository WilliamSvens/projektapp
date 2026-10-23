import type { FieldDB } from '../db/db';

export interface Ctx {
  database: FieldDB;
  email: string;
  navigate: (hash: string) => void;
  refreshHeader: () => Promise<void>;
}
