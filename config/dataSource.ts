export type DataSource = 'sheets' | 'supabase';

const configuredSource = process.env.EXPO_PUBLIC_DATA_SOURCE?.trim().toLowerCase();

export const DATA_SOURCE: DataSource = configuredSource === 'supabase' ? 'supabase' : 'sheets';
export const isSupabaseDataSource = DATA_SOURCE === 'supabase';
