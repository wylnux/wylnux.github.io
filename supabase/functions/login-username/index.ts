import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PUBLISHABLE_KEY = Deno.env.get("LOGIN_PUBLISHABLE_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("LOGIN_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGINS = new Set([
  "https://wylnux.github.io",
]);

function corsHeaders(origin: string | null) {
  const allowedOrigin =
    origin && ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://wylnux.github.io";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders(origin),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Método no permitido." },
      405,
      origin,
    );
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(
      { error: "Origen no autorizado." },
      403,
      origin,
    );
  }

  try {
    const body = await req.json();
    const username = String(body.username ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? "");

    if (
      !/^[a-z0-9._-]{3,32}$/.test(username) ||
      password.length < 1 ||
      password.length > 256
    ) {
      return jsonResponse(
        { error: "Usuario o contraseña incorrectos." },
        400,
        origin,
      );
    }

    // Cliente administrativo: solo se ejecuta en el servidor.
    const adminClient = createClient(
      SUPABASE_URL,
      SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // Buscar el correo interno asociado al nombre de usuario.
    const { data: profile, error: profileError } =
      await adminClient
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();

    if (profileError || !profile?.id) {
      return jsonResponse(
        { error: "Usuario o contraseña incorrectos." },
        401,
        origin,
      );
    }

    const { data: userData, error: userError } =
      await adminClient.auth.admin.getUserById(profile.id);

    const email = userData?.user?.email;

    if (userError || !email) {
      return jsonResponse(
        { error: "Usuario o contraseña incorrectos." },
        401,
        origin,
      );
    }

    // Cliente público: autentica mediante Supabase Auth.
    const authClient = createClient(
      SUPABASE_URL,
      PUBLISHABLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const { data: authData, error: authError } =
      await authClient.auth.signInWithPassword({
        email,
        password,
      });

    if (
      authError ||
      !authData.session?.access_token ||
      !authData.session?.refresh_token
    ) {
      return jsonResponse(
        { error: "Usuario o contraseña incorrectos." },
        401,
        origin,
      );
    }

    return jsonResponse(
      {
        session: {
          access_token: authData.session.access_token,
          refresh_token: authData.session.refresh_token,
        },
      },
      200,
      origin,
    );
  } catch (error) {
    console.error("Error en login-username:", error);

    return jsonResponse(
      { error: "No se pudo iniciar sesión. Inténtalo nuevamente." },
      500,
      origin,
    );
  }
});