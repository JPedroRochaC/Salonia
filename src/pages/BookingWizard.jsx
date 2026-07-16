import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSalon } from '../hooks/useSalon';
import {
  useServicos,
  useProfissionaisPorServico,
  useHorariosDisponiveis,
} from '../hooks/useAgendamentoData';
import { supabase } from '../lib/supabaseClient';
import NotFound from './NotFound';

const PASSOS = [
  { key: 'servico', label: 'Serviço' },
  { key: 'profissional', label: 'Profissional' },
  { key: 'horario', label: 'Data e horário' },
  { key: 'dados', label: 'Seus dados' },
  { key: 'resumo', label: 'Confirmar' },
];

function agruparHorarios(horarios) {
  const grupos = { Manhã: [], Tarde: [], Noite: [] };
  horarios.forEach((h) => {
    const hh = h.getHours();
    if (hh < 12) grupos.Manhã.push(h);
    else if (hh < 18) grupos.Tarde.push(h);
    else grupos.Noite.push(h);
  });
  return grupos;
}

export default function BookingWizard() {
  const { slug } = useParams();
  const { salao, loading, erro } = useSalon(slug);

  const [passo, setPasso] = useState(0);
  const [servico, setServico] = useState(null);
  const [profissional, setProfissional] = useState(null);
  const [dataEscolhida, setDataEscolhida] = useState('');
  const [horarioEscolhido, setHorarioEscolhido] = useState(null);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [erroEnvio, setErroEnvio] = useState(null);

  const { servicos, loading: loadingServicos } = useServicos(salao?.id);
  const { profissionais, loading: loadingProfissionais } = useProfissionaisPorServico(servico?.id);
  const { horarios, loading: loadingHorarios } = useHorariosDisponiveis({
    salao,
    profissionalId: profissional?.id,
    data: dataEscolhida,
    duracaoMinutos: servico?.duracao_minutos,
  });

  if (loading) return <div className="pagina-vazia">Carregando...</div>;
  if (erro) return <NotFound />;

  function voltar() { setPasso((p) => Math.max(0, p - 1)); }
  function irPara(indice) { setPasso(indice); }

  async function confirmarAgendamento() {
    setEnviando(true);
    setErroEnvio(null);

    let clienteId;
    const { data: clienteExistente } = await supabase
      .from('clientes').select('id')
      .eq('salao_id', salao.id).eq('telefone', telefone).maybeSingle();

    if (clienteExistente) {
      clienteId = clienteExistente.id;
    } else {
      const { data: novaCliente, error: erroCliente } = await supabase
        .from('clientes').insert({ salao_id: salao.id, nome, telefone })
        .select('id').single();
      if (erroCliente) {
        setErroEnvio('Não foi possível salvar seus dados. Tente novamente.');
        setEnviando(false);
        return;
      }
      clienteId = novaCliente.id;
    }

    const { error: erroAgendamento } = await supabase.from('agendamentos').insert({
      salao_id: salao.id,
      cliente_id: clienteId,
      profissional_id: profissional.id,
      servico_id: servico.id,
      data_hora: horarioEscolhido.toISOString(),
      duracao_minutos: servico.duracao_minutos,
      valor: servico.preco,
      status: salao.exige_sinal ? 'aguardando_pagamento' : 'aguardando_confirmacao',
    });

    if (erroAgendamento) {
      setErroEnvio('Não foi possível confirmar o agendamento. Tente novamente.');
      setEnviando(false);
      return;
    }
    setConcluido(true);
    setEnviando(false);
  }

  if (concluido) {
    return (
      <div className="sucesso-card">
        <div className="sucesso-icon">✓</div>
        <h1>Solicitação enviada!</h1>
        <p>
          {salao.nome} vai confirmar seu horário em breve
          {salao.exige_sinal ? ', após a confirmação do pagamento do sinal.' : ' pelo WhatsApp.'}
        </p>
        <Link to={`/${slug}`} className="btn btn-outline btn-full">Voltar ao início</Link>
      </div>
    );
  }

  const gruposHorarios = agruparHorarios(horarios);

  return (
    <div className="wizard">
      {/* HEADER */}
      <div className="wizard-header">
        <Link to={`/${slug}`} className="wizard-brand">
          {salao.logo_url && <img src={salao.logo_url} alt="" />}
          {salao.nome}
        </Link>
        <Link to={`/${slug}`} className="btn-ghost" style={{ textDecoration: 'none' }}>Cancelar</Link>
      </div>

      {/* PROGRESS */}
      <div className="wizard-progress">
        <div className="wizard-progress-top">
          <span>Passo <strong>{passo + 1}</strong> de {PASSOS.length}</span>
          <span>{PASSOS[passo].label}</span>
        </div>
        <div className="wizard-steps-indicator">
          {PASSOS.map((p, i) => (
            <span
              key={p.key}
              className={`step-dot ${i < passo ? 'done' : ''} ${i === passo ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>

      {passo > 0 && (
        <button className="wizard-back" onClick={voltar}>
          ← Voltar
        </button>
      )}

      {/* PASSO 1 — SERVIÇO */}
      {passo === 0 && (
        <div className="wizard-step">
          <h2>Qual serviço você quer?</h2>
          <p className="sub">Escolha o que combinamos hoje.</p>
          {loadingServicos && (
            <>
              <div className="skeleton-card" /><div className="skeleton-card" /><div className="skeleton-card" />
            </>
          )}
          <div className="option-list">
            {servicos.map((s) => (
              <button
                key={s.id}
                className={`option-card ${servico?.id === s.id ? 'selected' : ''}`}
                onClick={() => {
                  setServico(s);
                  setProfissional(null);
                  setHorarioEscolhido(null);
                  irPara(1);
                }}
              >
                <div className="option-card-body">
                  <strong>{s.nome}</strong>
                  <span className="meta">{s.duracao_minutos} min</span>
                </div>
                <span className="price">R$ {Number(s.preco).toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* PASSO 2 — PROFISSIONAL */}
      {passo === 1 && (
        <div className="wizard-step">
          <h2>Com quem?</h2>
          <p className="sub">Selecione uma profissional disponível.</p>
          {loadingProfissionais && (<><div className="skeleton-card" /><div className="skeleton-card" /></>)}
          <div className="option-list">
            {profissionais.map((p) => (
              <button
                key={p.id}
                className={`option-card ${profissional?.id === p.id ? 'selected' : ''}`}
                onClick={() => {
                  setProfissional(p);
                  setHorarioEscolhido(null);
                  irPara(2);
                }}
              >
                <div className="option-card-body">
                  <strong>{p.nome}</strong>
                </div>
              </button>
            ))}
            {!loadingProfissionais && profissionais.length === 0 && (
              <div className="slot-empty">Nenhuma profissional disponível para esse serviço.</div>
            )}
          </div>
        </div>
      )}

      {/* PASSO 3 — DATA E HORÁRIO */}
      {passo === 2 && (
        <div className="wizard-step">
          <h2>Quando?</h2>
          <p className="sub">Escolha o dia e depois o horário livre.</p>

          <label className="field-label">Data</label>
          <input
            type="date"
            className="field"
            value={dataEscolhida}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => {
              setDataEscolhida(e.target.value);
              setHorarioEscolhido(null);
            }}
          />

          {dataEscolhida && (
            <>
              {loadingHorarios && <p style={{ marginTop: 16, color: 'var(--brown-soft)' }}>Calculando horários livres...</p>}

              {!loadingHorarios && horarios.length === 0 && (
                <div className="slot-empty" style={{ marginTop: 16 }}>Nenhum horário livre nesse dia. Tente outra data.</div>
              )}

              {!loadingHorarios && Object.entries(gruposHorarios).map(([periodo, lista]) => (
                lista.length > 0 && (
                  <div className="slot-group" key={periodo}>
                    <div className="slot-group-label">{periodo}</div>
                    <div className="slot-grid">
                      {lista.map((h) => (
                        <button
                          key={h.toISOString()}
                          className={`slot-btn ${horarioEscolhido?.getTime() === h.getTime() ? 'selected' : ''}`}
                          onClick={() => setHorarioEscolhido(h)}
                        >
                          {h.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              ))}
            </>
          )}

          {horarioEscolhido && (
            <div className="wizard-cta">
              <button className="btn btn-primary btn-full btn-lg" onClick={() => irPara(3)}>
                Continuar
              </button>
            </div>
          )}
        </div>
      )}

      {/* PASSO 4 — DADOS */}
      {passo === 3 && (
        <div className="wizard-step">
          <h2>Seus dados</h2>
          <p className="sub">Pra confirmarmos o agendamento com você.</p>

          <label className="field-label">Nome</label>
          <input
            type="text" className="field"
            placeholder="Como podemos te chamar?"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <label className="field-label">WhatsApp</label>
          <input
            type="tel" className="field"
            placeholder="(11) 99999-9999"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
          />

          <div className="wizard-cta">
            <button
              className="btn btn-primary btn-full btn-lg"
              disabled={!nome || !telefone}
              onClick={() => irPara(4)}
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* PASSO 5 — RESUMO */}
      {passo === 4 && (
        <div className="wizard-step">
          <h2>Confirme seu agendamento</h2>
          <p className="sub">Revise antes de enviar.</p>

          <div className="resumo-card">
            <div className="resumo-row"><span>Serviço</span><strong>{servico.nome}</strong></div>
            <div className="resumo-row"><span>Profissional</span><strong>{profissional.nome}</strong></div>
            <div className="resumo-row"><span>Data</span><strong>{horarioEscolhido.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long' })}</strong></div>
            <div className="resumo-row"><span>Horário</span><strong>{horarioEscolhido.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong></div>
            <div className="resumo-row"><span>Cliente</span><strong>{nome}</strong></div>
            <div className="resumo-row resumo-total"><span>Total</span><strong>R$ {Number(servico.preco).toFixed(2)}</strong></div>
          </div>

          {salao.exige_sinal && (
            <div className="aviso-sinal">
              Este salão pede antecipação para confirmar o horário. Após enviar, você recebe os dados para o pagamento.
            </div>
          )}

          {erroEnvio && <p className="erro-envio">{erroEnvio}</p>}

          <div className="wizard-cta">
            <button
              className="btn btn-primary btn-full btn-lg"
              disabled={enviando}
              onClick={confirmarAgendamento}
            >
              {enviando ? 'Enviando...' : 'Solicitar agendamento'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
