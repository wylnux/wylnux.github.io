// Cliente público de Supabase para el navegador.
// La publishable/anon key puede estar en el frontend; NUNCA coloques aquí
// la service_role key ni una secret key.

const SUPABASE_URL = 'https://qtmvbmrfbsuqqmytkvzj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_vEgjmMkxcIzrrPbiW61aYA_a97sbzqY';

const { createClient } = supabase;

window._supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage
    }
});
