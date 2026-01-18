import { PikoDB } from 'pikodb';

/**
 * Key-value store using PikoDB for persistence.
 */
export class Store {
  private db: PikoDB;
  private started: boolean = false;

  constructor(dataDir: string) {
    this.db = new PikoDB({ databaseDirectory: dataDir });
  }

  private async ensureStarted(): Promise<void> {
    if (!this.started) {
      await this.db.start();
      this.started = true;
    }
  }

  async write<T>(
    table: string,
    key: string,
    value: T,
    expiresAt?: number
  ): Promise<void> {
    await this.ensureStarted();
    await this.db.write(table, key, value, expiresAt);
  }

  async get<T>(table: string, key: string): Promise<T | undefined>;
  async get<T>(table: string): Promise<T[]>;
  async get<T>(table: string, key?: string): Promise<T | T[] | undefined> {
    await this.ensureStarted();

    if (key === undefined) {
      // Return all values from table
      const entries = await this.db.get(table);
      if (!entries || !Array.isArray(entries)) return [];
      // PikoDB returns [[key, value], ...] format
      return entries.map((entry: [string, T]) => entry[1]);
    }

    return (await this.db.get(table, key)) as T | undefined;
  }

  async delete(table: string, key: string): Promise<void> {
    await this.ensureStarted();
    await this.db.delete(table, key);
  }

  async has(table: string, key: string): Promise<boolean> {
    await this.ensureStarted();
    const value = await this.db.get(table, key);
    return value !== undefined;
  }

  async keys(table: string): Promise<string[]> {
    await this.ensureStarted();
    const entries = await this.db.get(table);
    if (!entries || !Array.isArray(entries)) return [];
    return entries.map((entry: [string, unknown]) => entry[0]);
  }

  async close(): Promise<void> {
    if (this.started) {
      await this.db.close();
      this.started = false;
    }
  }
}
