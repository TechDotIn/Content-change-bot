import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://qhelyctgtdkwrxkgkufr.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoZWx5Y3RndGRrd3J4a2drdWZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1NTAxNDksImV4cCI6MjExMDEyNjE0OX0.mM2hly38J3TVHxH5wlekYoAP4EIRbZDB1WYXhJaHkr8";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
