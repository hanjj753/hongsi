export type DataSource = 'sheets' | 'supabase';

const configuredSource = process.env.EXPO_PUBLIC_DATA_SOURCE?.trim().toLowerCase();

// Default to the current backend; legacy Sheets requires explicit opt-in.
export const DATA_SOURCE: DataSource = configuredSource === 'sheets' ? 'sheets' : 'supabase';
export const isSupabaseDataSource = DATA_SOURCE === 'supabase';
