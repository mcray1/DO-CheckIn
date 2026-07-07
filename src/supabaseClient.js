import { createClient } from "@supabase/supabase-js";
 
const SUPABASE_URL = "https://ghofeoxrkrcibzeqcbih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdob2Zlb3hya3JjaWJ6ZXFjYmloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NTI4MTIsImV4cCI6MjA5ODIyODgxMn0.RsFkrqiuv4CzXGRg2FP33nTj5dMUtD2aF8w5NQYtmKQ";
 
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      apikey: SUPABASE_ANON_KEY,
    },
  },
});
 
export { SUPABASE_URL, SUPABASE_ANON_KEY };