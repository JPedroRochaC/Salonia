import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export function useSalon(slug) {
  const [salao, setSalao] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let cancelado = false;

    async function buscar() {
      setLoading(true);
      setErro(null);

      const { data, error } = await supabase
        .from('saloes')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

      if (cancelado) return;

      if (error) {
        setErro(error.message);
      } else if (!data) {
        setErro('nao_encontrado');
      } else {
        setSalao(data);
      }
      setLoading(false);
    }

    buscar();
    return () => {
      cancelado = true;
    };
  }, [slug]);

  return { salao, loading, erro };
}
