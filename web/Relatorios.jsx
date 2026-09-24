import React, { useEffect, useMemo, useState } from 'react';
import { api, brl } from './api.js';
import { Loading } from './ui.jsx';
import { QUALIF } from './api.js';

// Tela de relatórios (só admin). O backend entrega tudo pronto em uma chamada;
// aqui só formatamos, desenhamos e derivamos os insights por regra simples.
// ponytail: sem biblioteca de gráfico, os três gráficos são SVG/CSS caseiros.

const DIA = 86400000;
const hojeSP = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const emMs = (s) => Date.parse(s + 'T00:00:00Z');
const iso = (n) => new Date(n).toISOString().slice(0, 10);
const dm = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '');

function presets() {
  const h = hojeSP();
  const [y, mes] = h.split('-').map(Number);
  const primeiroDoMes = iso(Date.UTC(y, mes - 1, 1));
  return [
    { id: 'mes', label: 'Este mês', de: primeiroDoMes, ate: h },
    { id: 'passado', label: 'Mês passado', de: iso(Date.UTC(y, mes - 2, 1)), ate: iso(emMs(primeiroDoMes) - DIA) },
    { id: 'd30', label: 'Últimos 30 dias', de: iso(emMs(h) - 29 * DIA), ate: h },
    { id: 'd90', label: 'Últimos 90 dias', de: iso(emMs(h) - 89 * DIA), ate: h },
    { id: 'ano', label: 'Este ano', de: iso(Date.UTC(y, 0, 1)), ate: h },
  ];
}

// Win rate só existe quando houve fechamento; sem isso o valor é ausente ('—'),
// nunca zero (zero significaria "fechou e não vendeu nada").
const winRate = (vend, perd) => (vend + perd > 0 ? Math.round((vend / (vend + perd)) * 100) : null);
const num = (n) => (Number(n) || 0).toLocaleString('pt-BR');
const pctTxt = (v) => (v == null ? '—' : v + '%');

// Minusculas e sem acento, para a busca das tabelas casar "Festas" com "festa".
// Exportado: a aba Campanhas usa a mesma busca nas três tabelas dela.
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Fatia do total, inteira. Entre 0 e 1 vira "<1%" para não sumir como "0%".
function pctDoTotal(v, total) {
  if (!(total > 0)) return '—';
  const p = (v / total) * 100;
  if (p <= 0) return '0%';
  return p < 1 ? '<1%' : Math.round(p) + '%';
}

// Linha agregada das landing pages: soma as origens cujo nome começa com "LP ".
// Só aparece com 2 ou mais LPs, senão ela seria cópia exata da única linha LP.
// Não entra no total da coluna de porcentagem (contaria as LPs duas vezes).
function linhaTodasLPs(origens) {
  const lps = origens.filter((o) => /^LP\s/i.test(o.origem));
  if (lps.length < 2) return null;
  const soma = (c) => lps.reduce((a, o) => a + (o[c] || 0), 0);
  return {
    origem: 'Todas as LPs',
    agregada: true,
    leads: soma('leads'),
    criadas: soma('criadas'),
    vendidas: soma('vendidas'),
    perdidas: soma('perdidas'),
    valor_vendido: soma('valor_vendido'),
  };
}

// Minutos -> texto curto legível ("42min", "3h 10min", "2d 4h").
function duracaoMin(min) {
  if (min == null) return '—';
  const m = Math.round(min);
  if (m < 60) return m + 'min';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'min' : '');
  const d = Math.floor(h / 24);
  return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}
const dias = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + (v === 1 ? ' dia' : ' dias'));

// Reais em rótulo de eixo, curto o bastante para não empilhar ("18k", "1,2M").
function brlCurto(v) {
  const n = Number(v) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.', ',') + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(Math.round(n));
}

// Escala de eixo com números redondos: o passo é 1, 2, 2,5 ou 5 vezes uma
// potência de 10, então as marcas caem em 0, 5, 10, 20, 50... e nunca em
// valor quebrado. Devolve o topo do eixo e a lista de marcas.
// O passo nunca desce de 1: os dois eixos contam coisas inteiras (negociações
// e reais), e marca fracionada ("0,25 leads") não quer dizer nada.
export function escalaBonita(max, alvo = 4) {
  if (!(max > 0)) return { topo: 1, marcas: [0, 1] };
  const pot = 10 ** Math.floor(Math.log10(max / alvo));
  const passo = Math.max(1, ([1, 2, 2.5, 5, 10].find((m) => m * pot >= max / alvo) || 10) * pot);
  const topo = Math.ceil(max / passo) * passo;
  const marcas = [];
  for (let v = 0; v <= topo + passo / 1000; v += passo) marcas.push(Math.round(v * 1000) / 1000);
  return { topo, marcas };
}

function Delta({ atual, anterior, menorMelhor }) {
  if (atual == null || anterior == null) return <div className="k-delta igual">sem comparação</div>;
  if (!anterior) return <div className="k-delta igual">{atual ? 'sem base anterior' : 'igual ao anterior'}</div>;
  const d = ((atual - anterior) / anterior) * 100;
  const r = Math.round(Math.abs(d));
  if (r === 0) return <div className="k-delta igual">estável vs anterior</div>;
  const subiu = d > 0;
  const bom = menorMelhor ? !subiu : subiu;
  return <div className={'k-delta ' + (bom ? 'melhor' : 'pior')}>{(subiu ? '▲' : '▼') + ' ' + r + '%'}</div>;
}

function Kpi({ rotulo, valor, atual, anterior, menorMelhor }) {
  return (
    <div className="rel-kpi">
      <div className="k-lbl">{rotulo}</div>
      <div className="k-val">{valor}</div>
      <Delta atual={atual} anterior={anterior} menorMelhor={menorMelhor} />
    </div>
  );
}

// Barras horizontais. Em CSS e não em SVG de propósito: rótulo de texto com
// reticências e largura fluida saem de graça na grade, e o SVG só atrapalharia.
function BarrasH({ itens, cor }) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  if (!itens.length) return <p className="muted">Sem dados no período.</p>;
  return (
    <div className="rel-bh">
      {itens.map((i, k) => (
        <React.Fragment key={i.label + k}>
          <div className="bh-lbl" title={i.label}>{i.label}</div>
          <div className="bh-track"><i style={{ width: (i.valor / max) * 100 + '%', background: i.cor || cor || 'var(--evfg)' }} /></div>
          <div className="bh-val">{i.texto}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

// Linhas das 12 semanas: leads e vendas como linhas, valor vendido como barras
// de fundo em escala própria (as grandezas não são comparáveis entre si).
function Linhas({ semanas }) {
  const W = 720; const H = 250;
  const eL = 40; const eR = 46; const eT = 14; const eB = 30;
  const lw = W - eL - eR; const lh = H - eT - eB;
  const n = semanas.length;
  // Duas escalas: contagens à esquerda, reais à direita. As grandezas não se
  // comparam, então cada eixo tem as próprias marcas redondas e o leitor não
  // mede a barra de valor pela régua das linhas.
  const escC = escalaBonita(Math.max(...semanas.map((s) => Math.max(s.leads, s.vendidas)), 0));
  const escV = escalaBonita(Math.max(...semanas.map((s) => s.valor_vendido), 0));
  const x = (i) => eL + (n > 1 ? (i * lw) / (n - 1) : lw / 2);
  const y = (v) => eT + lh - (v / escC.topo) * lh;
  const linha = (chave) => semanas.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[chave]).toFixed(1)}`).join(' ');
  const larguraBarra = Math.max(6, (lw / Math.max(n, 1)) * 0.42);
  // Pula rótulos do eixo X quando não cabem: cada "dd/mm" pede uns 34px.
  const passoRot = Math.max(1, Math.ceil((n * 34) / lw));

  return (
    <>
      <div className="rel-legenda">
        <span><i style={{ background: 'var(--evfg)' }} />Leads novos (esquerda)</span>
        <span><i style={{ background: 'var(--hot)' }} />Vendas (esquerda)</span>
        <span><i style={{ background: 'var(--evbg)', height: 10 }} />Valor vendido (direita, R$)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Tendência das últimas 12 semanas">
        {escC.marcas.map((v) => (
          <g key={'gy' + v}>
            <line x1={eL} x2={W - eR} y1={y(v)} y2={y(v)} stroke="var(--ln)" strokeWidth="1" />
            <text x={eL - 7} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--mut)">{num(v)}</text>
          </g>
        ))}
        {escV.marcas.map((v) => (
          <text key={'vy' + v} x={W - eR + 7} y={eT + lh - (v / escV.topo) * lh + 4} textAnchor="start" fontSize="11" fill="var(--mut)">{brlCurto(v)}</text>
        ))}
        {semanas.map((s, i) => {
          const alt = (s.valor_vendido / escV.topo) * lh;
          return <rect key={'b' + s.semana} x={x(i) - larguraBarra / 2} y={eT + lh - alt} width={larguraBarra} height={alt} fill="var(--evbg)" />;
        })}
        <path d={linha('leads')} fill="none" stroke="var(--evfg)" strokeWidth="2" />
        <path d={linha('vendidas')} fill="none" stroke="var(--hot)" strokeWidth="2" />
        {semanas.map((s, i) => (
          <g key={'p' + s.semana}>
            <circle cx={x(i)} cy={y(s.leads)} r="3" fill="var(--evfg)" />
            <circle cx={x(i)} cy={y(s.vendidas)} r="3" fill="var(--hot)" />
            <rect x={x(i) - larguraBarra / 2} y={eT} width={larguraBarra} height={lh} fill="transparent">
              <title>{`Semana de ${dm(s.semana)}: ${s.leads} leads, ${s.criadas} negociações, ${s.vendidas} vendas, ${brl(s.valor_vendido)}`}</title>
            </rect>
            {i % passoRot === 0 && <text x={x(i)} y={H - 9} textAnchor="middle" fontSize="11" fill="var(--mut)">{dm(s.semana)}</text>}
          </g>
        ))}
      </svg>
    </>
  );
}

// Barras pareadas. Cada par é normalizado pelo próprio máximo: as grandezas
// (contagens e reais) não dividem escala, o que interessa é a diferença dentro
// do par. Por isso o número aparece escrito em cada barra.
function BarrasPareadas({ itens }) {
  const W = 720; const H = 210;
  const eT = 30; const eB = 32;
  const lh = H - eT - eB;
  const passo = W / itens.length;
  const larg = Math.min(46, passo * 0.28);
  return (
    <>
      <div className="rel-legenda">
        <span><i style={{ background: 'var(--evfg)', height: 10 }} />Período atual</span>
        <span><i style={{ background: 'var(--ln)', height: 10 }} />Período anterior</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Comparativo com o período anterior">
        <line x1="0" x2={W} y1={eT + lh} y2={eT + lh} stroke="var(--ln)" strokeWidth="1" />
        {itens.map((it, i) => {
          // Cada par tem escala própria (contagem e reais não dividem régua),
          // por isso o número vai escrito em cima de cada barra: sem o rótulo
          // a altura sozinha não diria nada entre grupos.
          const max = Math.max(it.atual, it.anterior, 1);
          const cx = passo * i + passo / 2;
          const hA = (it.atual / max) * lh;
          const hP = (it.anterior / max) * lh;
          const xA = cx - larg - 3; const xP = cx + 3;
          return (
            <g key={it.label}>
              <rect x={xA} y={eT + lh - hA} width={larg} height={hA} fill="var(--evfg)">
                <title>{`${it.label} (atual): ${it.texto(it.atual)}`}</title>
              </rect>
              <text x={xA + larg / 2} y={eT + lh - hA - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--tx)">{(it.curto || it.texto)(it.atual)}</text>
              <rect x={xP} y={eT + lh - hP} width={larg} height={hP} fill="var(--ln)">
                <title>{`${it.label} (anterior): ${it.texto(it.anterior)}`}</title>
              </rect>
              <text x={xP + larg / 2} y={eT + lh - hP - 6} textAnchor="middle" fontSize="11" fill="var(--mut)">{(it.curto || it.texto)(it.anterior)}</text>
              <text x={cx} y={eT + lh + 18} textAnchor="middle" fontSize="11" fill="var(--mut)">{it.label}</text>
            </g>
          );
        })}
      </svg>
    </>
  );
}

// Insights por regra fixa, com mínimo de volume para cada uma: número pequeno
// não vira conselho. Sem regra satisfeita, a seção diz isso em vez de mentir.
function montaInsights(r) {
  const out = [];
  const fechadas = (o) => o.vendidas + o.perdidas;
  const comVolume = r.origens.filter((o) => fechadas(o) >= 10 && winRate(o.vendidas, o.perdidas) != null);
  if (comVolume.length) {
    const ord = [...comVolume].sort((a, b) => winRate(b.vendidas, b.perdidas) - winRate(a.vendidas, a.perdidas));
    const melhor = ord[0];
    out.push({ tom: 'ok', txt: <>A origem <b>{melhor.origem}</b> converte melhor: {winRate(melhor.vendidas, melhor.perdidas)}% de aproveitamento em {fechadas(melhor)} negociações fechadas.</> });
    const pior = ord[ord.length - 1];
    if (pior !== melhor) {
      out.push({ tom: 'hot', txt: <>A origem <b>{pior.origem}</b> converte pior: {winRate(pior.vendidas, pior.perdidas)}% em {fechadas(pior)} fechadas.</> });
    }
  }

  const totalPerdas = r.motivos_perda.reduce((a, b) => a + b.count, 0);
  const top = r.motivos_perda[0];
  if (top && totalPerdas > 0 && top.count / totalPerdas >= 0.4) {
    out.push({ tom: 'hot', txt: <>Motivo de perda dominante: <b>{top.motivo}</b> responde por {Math.round((top.count / totalPerdas) * 100)}% das {totalPerdas} perdas.</> });
  }

  const v = r.resposta_vs_win;
  const fechRapidas = v.rapida_vendida + v.rapida_perdida;
  const fechLentas = v.lenta_vendida + v.lenta_perdida;
  if (fechRapidas >= 10 && fechLentas >= 10) {
    const wr = winRate(v.rapida_vendida, v.rapida_perdida);
    const wl = winRate(v.lenta_vendida, v.lenta_perdida);
    if (wr > wl) out.push({ tom: 'ok', txt: <>Negociações respondidas em até 24h fecham <b>{wr}%</b> vs <b>{wl}%</b> das respondidas depois disso.</> });
  }

  for (const k of r.kpisPrincipais) {
    if (!k.anterior || k.atual == null) continue;
    const d = ((k.atual - k.anterior) / k.anterior) * 100;
    if (Math.abs(d) < 25) continue;
    const subiu = d > 0;
    const bom = k.menorMelhor ? !subiu : subiu;
    out.push({ tom: bom ? 'ok' : 'hot', txt: <><b>{k.rotulo}</b>: {subiu ? 'alta' : 'queda'} de {Math.round(Math.abs(d))}% vs o período anterior ({k.fmt(k.atual)} contra {k.fmt(k.anterior)}).</> });
  }
  return out;
}

export default function Relatorios() {
  const PRE = useMemo(presets, []);
  const [preset, setPreset] = useState('mes');
  const [de, setDe] = useState(PRE[0].de);
  const [ate, setAte] = useState(PRE[0].ate);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  // Recorte da pagina inteira. Vale nos dois periodos (o backend aplica nos
  // dois), entao a comparacao continua comparando a mesma coisa.
  const [funil, setFunil] = useState('');
  const [origem, setOrigem] = useState('');
  const [funis, setFunis] = useState([]);
  const [origens, setOrigens] = useState([]);
  // Busca de texto por tabela (so esconde linha, nao mexe em conta nenhuma).
  const [buscaFunil, setBuscaFunil] = useState('');
  const [buscaOrigem, setBuscaOrigem] = useState('');

  useEffect(() => {
    let vivo = true;
    setDados(null); setErro('');
    api.relatorios(de, ate, funil, origem)
      .then((d) => { if (vivo) setDados(d); })
      .catch((e) => { if (vivo) setErro(e.message || 'Não foi possível carregar os relatórios.'); });
    return () => { vivo = false; };
  }, [de, ate, funil, origem]);

  // Opcoes dos selects: carregadas uma vez e independentes do recorte ativo
  // (se viessem do payload filtrado, escolher uma origem apagaria as outras).
  useEffect(() => {
    api.pipelines().then(setFunis).catch(() => setFunis([]));
    api.leadOrigens().then((o) => setOrigens(Array.isArray(o) ? o : [])).catch(() => setOrigens([]));
  }, []);

  function aplicaPreset(p) {
    setPreset(p.id); setDe(p.de); setAte(p.ate);
  }

  const barra = (
    <>
      <div className="rel-barra">
        {PRE.map((p) => (
          <button key={p.id} className={'rel-pill' + (preset === p.id ? ' on' : '')} onClick={() => aplicaPreset(p)}>{p.label}</button>
        ))}
        <div className="rel-datas">
          <input type="date" value={de} max={ate} onChange={(e) => { if (e.target.value) { setPreset(''); setDe(e.target.value); } }} />
          <span>até</span>
          <input type="date" value={ate} min={de} onChange={(e) => { if (e.target.value) { setPreset(''); setAte(e.target.value); } }} />
        </div>
      </div>
      <div className="rel-barra">
        <select className="rel-sel" value={funil} onChange={(e) => setFunil(e.target.value)} aria-label="Filtrar por funil">
          <option value="">Todos os funis</option>
          {funis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
        <select className="rel-sel" value={origem} onChange={(e) => setOrigem(e.target.value)} aria-label="Filtrar por origem">
          <option value="">Todas as origens</option>
          <option value="Sem origem">Sem origem</option>
          {origens.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {(funil || origem) && <button className="rel-pill" onClick={() => { setFunil(''); setOrigem(''); }}>Limpar filtros</button>}
      </div>
      {dados && (
        <p className="rel-vs">
          Comparando com {dm(dados.anterior.de)} a {dm(dados.anterior.ate)} ({dados.periodo.dias} {dados.periodo.dias === 1 ? 'dia' : 'dias'}).
          {funil && ' Leads novos não filtram por funil (um lead não pertence a um funil).'}
        </p>
      )}
    </>
  );

  if (erro) return <div className="rel"><h2>Relatórios</h2>{barra}<p className="erro-inline">{erro}</p></div>;
  if (!dados) return <div className="rel"><h2>Relatórios</h2>{barra}<Loading>Calculando os números...</Loading></div>;

  const r = dados;
  const wrAtual = winRate(r.vendas.count, r.perdidas.valor);
  const wrAnt = winRate(r.vendas.anterior.count, r.perdidas.anterior);
  const kpisPrincipais = [
    { rotulo: 'Leads novos', atual: r.leads_novos.valor, anterior: r.leads_novos.anterior, fmt: num },
    { rotulo: 'Negociações criadas', atual: r.negociacoes_criadas.valor, anterior: r.negociacoes_criadas.anterior, fmt: num },
    { rotulo: 'Vendas', atual: r.vendas.count, anterior: r.vendas.anterior.count, fmt: num },
    { rotulo: 'Valor vendido', atual: r.vendas.valor_total, anterior: r.vendas.anterior.valor_total, fmt: brl },
    { rotulo: 'Ticket médio', atual: r.vendas.ticket_medio, anterior: r.vendas.anterior.ticket_medio, fmt: brl },
    { rotulo: 'Resposta inicial', atual: r.resposta_inicial.mediana_min, anterior: r.resposta_inicial.anterior.mediana_min, fmt: duracaoMin, menorMelhor: true },
    { rotulo: 'Ciclo de venda', atual: r.ciclo_venda.mediana_dias, anterior: r.ciclo_venda.anterior.mediana_dias, fmt: dias, menorMelhor: true },
  ];
  const insights = montaInsights({ ...r, kpisPrincipais });

  // Denominadores da coluna "% do total": somam SÓ as linhas reais. A linha
  // agregada das LPs fica de fora para as LPs não contarem duas vezes, mas a
  // porcentagem dela sai sobre esse mesmo total.
  const totalCriadasFunis = r.por_funil.reduce((a, f) => a + f.criadas, 0);
  const totalLeadsOrigens = r.origens.reduce((a, o) => a + o.leads, 0);

  const lps = linhaTodasLPs(r.origens);
  const origensComLPs = (lps ? [...r.origens, lps] : r.origens)
    .slice().sort((a, b) => b.leads - a.leads || b.criadas - a.criadas);

  const casa = (txt, busca) => !busca.trim() || norm(txt).includes(norm(busca.trim()));
  const funisVisiveis = r.por_funil.filter((f) => casa(f.nome, buscaFunil));
  const origensVisiveis = origensComLPs.filter((o) => casa(o.origem, buscaOrigem));

  const totalPerdas = r.motivos_perda.reduce((a, b) => a + b.count, 0);
  const totalTemp = r.temperatura.reduce((a, b) => a + b.count, 0);
  const tempOrdenada = [...QUALIF, 'Sem qualificação']
    .map((q, i) => ({ q, cor: i < 5 ? `var(--t${i + 1})` : 'var(--mut)', n: (r.temperatura.find((t) => t.qualificacao === q) || {}).count || 0 }))
    .filter((t) => t.n > 0 || t.q !== 'Sem qualificação');

  return (
    <div className="rel">
      <h2>Relatórios</h2>
      {barra}

      <div className="rel-kpis">
        <Kpi rotulo="Leads novos" valor={num(r.leads_novos.valor)} atual={r.leads_novos.valor} anterior={r.leads_novos.anterior} />
        <Kpi rotulo="Negociações criadas" valor={num(r.negociacoes_criadas.valor)} atual={r.negociacoes_criadas.valor} anterior={r.negociacoes_criadas.anterior} />
        <Kpi rotulo="Vendas" valor={num(r.vendas.count)} atual={r.vendas.count} anterior={r.vendas.anterior.count} />
        <Kpi rotulo="Valor total" valor={brl(r.vendas.valor_total)} atual={r.vendas.valor_total} anterior={r.vendas.anterior.valor_total} />
        <Kpi rotulo="Ticket médio" valor={brl(r.vendas.ticket_medio)} atual={r.vendas.ticket_medio} anterior={r.vendas.anterior.ticket_medio} />
        <Kpi rotulo="Win rate" valor={pctTxt(wrAtual)} atual={wrAtual} anterior={wrAnt} />
        <Kpi rotulo="Resposta inicial (mediana)" valor={duracaoMin(r.resposta_inicial.mediana_min)} atual={r.resposta_inicial.mediana_min} anterior={r.resposta_inicial.anterior.mediana_min} menorMelhor />
        <Kpi rotulo="SLA 24h" valor={pctTxt(r.resposta_inicial.sla_24h)} atual={r.resposta_inicial.sla_24h} anterior={r.resposta_inicial.anterior.sla_24h} />
        <Kpi rotulo="Ciclo de venda (mediana)" valor={dias(r.ciclo_venda.mediana_dias)} atual={r.ciclo_venda.mediana_dias} anterior={r.ciclo_venda.anterior.mediana_dias} menorMelhor />
      </div>

      <div className="rel-sec">
        <div className="rel-sec-head">
          <h3>Conversão por funil</h3>
          {r.por_funil.length > 0 && (
            <input className="rel-filtro" value={buscaFunil} placeholder="Filtrar..."
              aria-label="Filtrar funis" onChange={(e) => setBuscaFunil(e.target.value)} />
          )}
        </div>
        {r.por_funil.length === 0 ? <p className="muted">Sem movimento em nenhum funil neste período.</p> : (
          <div className="rel-scroll">
            <table className="rel-tab">
              <thead>
                <tr>
                  <th>Funil</th><th className="num">Criadas</th><th className="num">% do total</th>
                  <th className="num">Vendidas</th><th className="num">Perdidas</th>
                  <th className="num">Win rate</th><th>&nbsp;</th><th className="num">Valor vendido</th>
                </tr>
              </thead>
              <tbody>
                {funisVisiveis.map((f) => {
                  const wr = winRate(f.vendidas, f.perdidas);
                  return (
                    <tr key={f.pipeline_id}>
                      <td>{f.nome}</td>
                      <td className="num">{num(f.criadas)}</td>
                      <td className="num">{pctDoTotal(f.criadas, totalCriadasFunis)}</td>
                      <td className="num">{num(f.vendidas)}</td>
                      <td className="num">{num(f.perdidas)}</td>
                      <td className="num">{pctTxt(wr)}</td>
                      <td><div className="rel-mini"><i style={{ width: (wr || 0) + '%' }} /></div></td>
                      <td className="num">{brl(f.valor_vendido)}</td>
                    </tr>
                  );
                })}
                {funisVisiveis.length === 0 && (
                  <tr><td colSpan={8} className="muted">Nenhum funil casa com "{buscaFunil}".</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rel-sec">
        <h3>Motivos de perda</h3>
        <BarrasH
          cor="var(--hot)"
          itens={r.motivos_perda.map((m) => ({
            label: m.motivo,
            valor: m.count,
            texto: `${m.count} (${Math.round((m.count / (totalPerdas || 1)) * 100)}%)`,
          }))}
        />
      </div>

      <div className="rel-sec">
        <div className="rel-sec-head">
          <h3>Origem dos leads</h3>
          {r.origens.length > 0 && (
            <input className="rel-filtro" value={buscaOrigem} placeholder="Filtrar..."
              aria-label="Filtrar origens" onChange={(e) => setBuscaOrigem(e.target.value)} />
          )}
        </div>
        {r.origens.length === 0 ? <p className="muted">Sem leads nem negociações no período.</p> : (
          <div className="rel-scroll">
            <table className="rel-tab">
              <thead>
                <tr>
                  <th>Origem</th><th className="num">Leads novos</th><th className="num">% do total</th>
                  <th className="num">Negociações</th><th className="num">Vendas</th>
                  <th className="num">Win rate</th><th>&nbsp;</th><th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {origensVisiveis.map((o) => {
                  const wr = winRate(o.vendidas, o.perdidas);
                  return (
                    <tr key={o.origem} className={o.agregada ? 'rel-agregada' : undefined}>
                      <td>{o.origem}</td>
                      <td className="num">{num(o.leads)}</td>
                      <td className="num">{pctDoTotal(o.leads, totalLeadsOrigens)}</td>
                      <td className="num">{num(o.criadas)}</td>
                      <td className="num">{num(o.vendidas)}</td>
                      <td className="num">{pctTxt(wr)}</td>
                      <td><div className="rel-mini"><i style={{ width: (wr || 0) + '%' }} /></div></td>
                      <td className="num">{brl(o.valor_vendido)}</td>
                    </tr>
                  );
                })}
                {origensVisiveis.length === 0 && (
                  <tr><td colSpan={8} className="muted">Nenhuma origem casa com "{buscaOrigem}".</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rel-sec">
        <h3>Tendência (12 semanas)</h3>
        <Linhas semanas={r.serie_semanal} />
      </div>

      <div className="rel-sec">
        <h3>Comparativo com o período anterior</h3>
        <BarrasPareadas itens={[
          { label: 'Leads', atual: r.leads_novos.valor, anterior: r.leads_novos.anterior, texto: num },
          { label: 'Criadas', atual: r.negociacoes_criadas.valor, anterior: r.negociacoes_criadas.anterior, texto: num },
          { label: 'Vendas', atual: r.vendas.count, anterior: r.vendas.anterior.count, texto: num },
          { label: 'Valor', atual: r.vendas.valor_total, anterior: r.vendas.anterior.valor_total, texto: brl, curto: (v) => 'R$ ' + brlCurto(v) },
          { label: 'Perdidas', atual: r.perdidas.valor, anterior: r.perdidas.anterior, texto: num },
        ]} />
      </div>

      <div className="rel-sec">
        <h3>Temperatura da carteira</h3>
        <p className="rel-vs">Retrato de agora: {num(totalTemp)} negociações em andamento.</p>
        <BarrasH itens={tempOrdenada.map((t) => ({
          label: t.q,
          valor: t.n,
          cor: t.cor,
          texto: `${t.n} (${Math.round((t.n / (totalTemp || 1)) * 100)}%)`,
        }))} />
      </div>

      <div className="rel-sec">
        <h3>Insights</h3>
        {insights.length === 0 ? <p className="muted">Ainda não há dados suficientes para insights neste período.</p> : (
          <ul className="rel-insights">
            {insights.map((i, k) => (
              <li key={k}><span className={'ponto ' + (i.tom === 'ok' ? 'ok' : i.tom === 'hot' ? 'hot' : 'neutro')}>●</span><span>{i.txt}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
