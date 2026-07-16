import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function IaraWidget({ salaoId }) {
  const [aberto, setAberto] = useState(false);
  const [perguntas, setPerguntas] = useState([]);
  const [selecionada, setSelecionada] = useState(null);

  useEffect(() => {
    if (!salaoId || !aberto) return;

    async function buscar() {
      const { data, error } = await supabase
        .from('perguntas_frequentes')
        .select('*')
        .eq('salao_id', salaoId)
        .eq('ativo', true)
        .order('ordem');

      if (!error) setPerguntas(data);
    }

    buscar();
  }, [salaoId, aberto]);

  return (
    <div className="iara-widget">
      {aberto && (
        <div className="iara-widget-panel">
          <div className="iara-widget-header">
            <span>Iara</span>
            <button onClick={() => setAberto(false)} aria-label="Fechar">
              ×
            </button>
          </div>

          <div className="iara-widget-body">
            {!selecionada ? (
              <>
                <p className="iara-widget-intro">Oi! Posso ajudar com:</p>
                {perguntas.length === 0 && (
                  <p className="iara-widget-empty">Nenhuma pergunta cadastrada ainda.</p>
                )}
                {perguntas.map((p) => (
                  <button
                    key={p.id}
                    className="iara-widget-option"
                    onClick={() => setSelecionada(p)}
                  >
                    {p.pergunta}
                  </button>
                ))}
              </>
            ) : (
              <>
                <button className="iara-widget-back" onClick={() => setSelecionada(null)}>
                  ← Voltar
                </button>
                <p className="iara-widget-question">{selecionada.pergunta}</p>
                <p className="iara-widget-answer">{selecionada.resposta}</p>
              </>
            )}
          </div>
        </div>
      )}

      <button
        className="iara-widget-fab"
        onClick={() => setAberto((v) => !v)}
        aria-label="Abrir assistente Iara"
      >
        {aberto ? '×' : 'Iara'}
      </button>
    </div>
  );
}
