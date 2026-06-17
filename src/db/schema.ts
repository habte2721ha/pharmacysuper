import { pgTable, text, jsonb } from 'drizzle-orm/pg-core';

export const appData = pgTable('app_data', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});
