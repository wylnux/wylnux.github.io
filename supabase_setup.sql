-- =============================================================
-- BITÁCORA INDUSTRIAL - AUTENTICACIÓN Y POLÍTICAS RLS
-- Conserva public.tareas y todos sus registros.
-- Ejecutar en Supabase > SQL Editor como postgres.
-- =============================================================

-- 1) Perfiles vinculados a Supabase Auth.
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username text NOT NULL UNIQUE,
    role text NOT NULL DEFAULT 'user'
        CHECK (role IN ('admin', 'user')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profiles_username_format CHECK (
        username = lower(username)
        AND username ~ '^[a-z0-9._-]{3,32}$'
    )
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;

-- Quitar cualquier política previa de profiles para dejar solo lectura propia.
DO $$
DECLARE p record;
BEGIN
    FOR p IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'profiles'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.profiles', p.policyname);
    END LOOP;
END;
$$;

CREATE POLICY "Leer perfil propio"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

-- 2) Esquema privado para funciones auxiliares.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

-- 3) Crear perfil automáticamente cuando se crea una cuenta en Auth.
CREATE OR REPLACE FUNCTION private.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_username text;
BEGIN
    v_username := lower(
        coalesce(
            nullif(trim(NEW.raw_user_meta_data ->> 'username'), ''),
            'user_' || substr(NEW.id::text, 1, 12)
        )
    );

    INSERT INTO public.profiles (id, username, role)
    VALUES (NEW.id, v_username, 'user')
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.handle_new_auth_user() FROM PUBLIC;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION private.handle_new_auth_user();

-- 4) Función de comprobación de rol administrador.
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = (SELECT auth.uid())
          AND p.role = 'admin'
    );
$$;

REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

-- 5) Reemplazar las políticas de tareas.
-- IMPORTANTE: esto no elimina ni modifica filas de public.tareas.
ALTER TABLE public.tareas ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
    FOR p IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tareas'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.tareas', p.policyname);
    END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.tareas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tareas TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.tareas TO authenticated;

-- Todos pueden consultar todas las tareas y todos los estados.
CREATE POLICY "Lectura publica de tareas"
ON public.tareas
FOR SELECT
TO anon, authenticated
USING (true);

-- Cualquier usuario autenticado puede registrar.
CREATE POLICY "Usuarios autenticados insertan tareas"
ON public.tareas
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
));

-- Cualquier usuario con perfil autenticado puede editar y cambiar estados.
CREATE POLICY "Usuarios autenticados actualizan tareas"
ON public.tareas
FOR UPDATE
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
))
WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
));

-- Solo el rol admin puede eliminar.
CREATE POLICY "Solo administradores eliminan tareas"
ON public.tareas
FOR DELETE
TO authenticated
USING ((SELECT private.is_admin()));

-- 6) Bloquear la tabla antigua de contraseñas en texto plano.
-- No se elimina todavía para permitir una verificación posterior.
ALTER TABLE public.administradores ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
    FOR p IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'administradores'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.administradores', p.policyname);
    END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.administradores FROM PUBLIC, anon, authenticated;

-- 7) Verificación básica de políticas instaladas.
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('tareas', 'profiles', 'administradores')
ORDER BY tablename, policyname;

-- =============================================================
-- DESPUÉS DE CREAR CADA USUARIO EN AUTH > USERS:
-- Cambiar el correo por el correo real de la cuenta creada.
-- El perfil se crea automáticamente con rol 'user'.
-- =============================================================
-- UPDATE public.profiles
-- SET username = 'wylnux', role = 'admin'
-- WHERE id = (
--     SELECT id FROM auth.users
--     WHERE email = 'CORREO_REAL_DEL_ADMIN'
--     LIMIT 1
-- );
--
-- Para asignar un usuario normal:
-- UPDATE public.profiles
-- SET username = 'operador01', role = 'user'
-- WHERE id = (
--     SELECT id FROM auth.users
--     WHERE email = 'CORREO_REAL_DEL_OPERADOR'
--     LIMIT 1
-- );