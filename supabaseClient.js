/*
 * CONFIGURACIÓN DE SUPABASE
 * Proyecto: jllskvnfwjqlujrepnvk
 * La clave publishable puede utilizarse en el navegador.
 * NUNCA coloques aquí una Secret key ni una service_role.
 */
(() => {
  const SUPABASE_URL = "https://jllskvnfwjqlujrepnvk.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vEgjmMkxcIzrrPbiW61aYA_a97sbzqY";

  if (!window.supabase || !window.supabase.createClient) {
    console.error("No se pudo cargar la biblioteca de Supabase.");
    return;
  }

  window.db = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
})();
