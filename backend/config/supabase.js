import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const opcoesAuthSemPersistencia = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};

// Cliente exclusivo para operações do servidor. Nunca deve receber a sessão
// de uma cliente/admin, pois ele precisa manter o papel service_role.
export const supabase = createClient(
    supabaseUrl,
    supabaseKey,
    opcoesAuthSemPersistencia
);

// O login precisa ser feito em outro cliente. Se fosse feito no cliente acima,
// signInWithPassword gravaria a sessão da dona do salão nele e as próximas
// consultas passariam a obedecer ao RLS como se viessem do navegador.
export const supabaseAuth = createClient(
    supabaseUrl,
    supabaseKey,
    opcoesAuthSemPersistencia
);
