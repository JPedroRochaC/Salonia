import { useParams, Link } from 'react-router-dom';
import { useSalon } from '../hooks/useSalon';
import IaraWidget from '../components/IaraWidget';
import NotFound from './NotFound';

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export default function SalonHome() {
  const { slug } = useParams();
  const { salao, loading, erro } = useSalon(slug);

  if (loading) return <div className="pagina-vazia">Carregando...</div>;
  if (erro) return <NotFound />;

  const diasTexto = (salao.dias_funcionamento || [])
    .slice()
    .sort()
    .map((d) => DIAS[d])
    .join(' · ');

  const abertura = salao.horario_abertura?.slice(0, 5);
  const fechamento = salao.horario_fechamento?.slice(0, 5);

  // aberto agora?
  const agora = new Date();
  const diaHoje = agora.getDay();
  const hhmm = agora.toTimeString().slice(0, 5);
  const abertoAgora =
    (salao.dias_funcionamento || []).includes(diaHoje) &&
    abertura && fechamento && hhmm >= abertura && hhmm <= fechamento;

  return (
    <div className="salon-home">
      <div className="salon-hero">
        <span className="salon-badge">Agendamento online</span>

        {salao.logo_url && (
          <img src={salao.logo_url} alt={salao.nome} className="salon-logo" />
        )}

        <h1>{salao.nome}</h1>

        {salao.endereco && (
          <p className="salon-endereco">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            {salao.endereco}
          </p>
        )}

        <div className="salon-horario-pill">
          <span className="dot" style={{ background: abertoAgora ? '#22c55e' : '#9a7c66' }} />
          {abertoAgora ? 'Aberto agora' : 'Fechado agora'} · {abertura}–{fechamento}
        </div>

        <div style={{ marginTop: 8, fontSize: '.8rem', color: 'var(--brown-mute)' }}>
          {diasTexto}
        </div>

        <Link to={`/${slug}/agendar`} className="btn btn-primary btn-lg btn-full">
          Agendar meu horário
        </Link>

        <p className="salon-hint">Leva menos de 1 minuto · confirmação pelo WhatsApp</p>
      </div>

      <IaraWidget salaoId={salao.id} />
    </div>
  );
}
