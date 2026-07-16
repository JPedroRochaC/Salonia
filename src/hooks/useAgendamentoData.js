import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export function useServicos(salaoId) {
  const [servicos, setServicos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!salaoId) return;
    let cancelado = false;

    async function buscar() {
      setLoading(true);
      const { data, error } = await supabase
        .from('servicos')
        .select('*')
        .eq('salao_id', salaoId)
        .eq('ativo', true)
        .order('nome');

      if (!cancelado) {
        if (!error) setServicos(data);
        setLoading(false);
      }
    }

    buscar();
    return () => {
      cancelado = true;
    };
  }, [salaoId]);

  return { servicos, loading };
}

export function useProfissionaisPorServico(servicoId) {
  const [profissionais, setProfissionais] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!servicoId) return;
    let cancelado = false;

    async function buscar() {
      setLoading(true);
      const { data, error } = await supabase
        .from('profissional_servicos')
        .select('profissional:profissionais(*)')
        .eq('servico_id', servicoId);

      if (!cancelado) {
        if (!error) {
          const ativos = (data || [])
            .map((row) => row.profissional)
            .filter((p) => p && p.ativo);
          setProfissionais(ativos);
        }
        setLoading(false);
      }
    }

    buscar();
    return () => {
      cancelado = true;
    };
  }, [servicoId]);

  return { profissionais, loading };
}

/**
 * Calcula os horários livres de um profissional em uma data,
 * considerando o horário de funcionamento do salão e os
 * agendamentos já existentes (via view pública agenda_publica).
 */
export function useHorariosDisponiveis({ salao, profissionalId, data, duracaoMinutos, intervaloMinutos = 30 }) {
  const [horarios, setHorarios] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!salao || !profissionalId || !data || !duracaoMinutos) return;
    let cancelado = false;

    async function calcular() {
      setLoading(true);

      const inicioDia = new Date(`${data}T00:00:00`);
      const fimDia = new Date(`${data}T23:59:59`);

      const { data: ocupados, error } = await supabase
        .from('agenda_publica')
        .select('data_hora, duracao_minutos')
        .eq('profissional_id', profissionalId)
        .gte('data_hora', inicioDia.toISOString())
        .lte('data_hora', fimDia.toISOString());

      if (cancelado) return;

      if (error) {
        setHorarios([]);
        setLoading(false);
        return;
      }

      const [horaAbertura, minAbertura] = salao.horario_abertura.split(':').map(Number);
      const [horaFechamento, minFechamento] = salao.horario_fechamento.split(':').map(Number);

      const abertura = new Date(`${data}T00:00:00`);
      abertura.setHours(horaAbertura, minAbertura, 0, 0);

      const fechamento = new Date(`${data}T00:00:00`);
      fechamento.setHours(horaFechamento, minFechamento, 0, 0);

      const blocosOcupados = (ocupados || []).map((o) => {
        const ini = new Date(o.data_hora);
        const fim = new Date(ini.getTime() + o.duracao_minutos * 60000);
        return [ini, fim];
      });

      const livres = [];
      let cursor = new Date(abertura);

      while (cursor.getTime() + duracaoMinutos * 60000 <= fechamento.getTime()) {
        const fimSlot = new Date(cursor.getTime() + duracaoMinutos * 60000);

        const conflita = blocosOcupados.some(
          ([ini, fim]) => cursor < fim && fimSlot > ini
        );

        if (!conflita) {
          livres.push(new Date(cursor));
        }

        cursor = new Date(cursor.getTime() + intervaloMinutos * 60000);
      }

      setHorarios(livres);
      setLoading(false);
    }

    calcular();
    return () => {
      cancelado = true;
    };
  }, [salao, profissionalId, data, duracaoMinutos, intervaloMinutos]);

  return { horarios, loading };
}
