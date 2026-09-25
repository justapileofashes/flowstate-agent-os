// Stocks screen — ported from the Claude Design "Flowstate Redesign" mock.
// Research / analyse / predict a symbol: live watchlist, candlestick chart with
// the AI's forward forecast + detected patterns, a buy/hold/sell signal with
// entry · stoploss · take-profit, a factor breakdown, and a risk calculator.
// All data via the typed ipc.stocks.* surface.
//
// Educational analysis — NOT financial advice (persistent banner).
// Free tier: chrome renders behind a locked overlay; no IPC is called.
import { useEffect, useRef, useState, type JSX } from 'react';
import { ipc } from '../lib/ipc';
import { AiTrader } from './trader/AiTrader';
import type {
  StockAnalysisResponse,
  StockQuoteResponse,
  StockFactorDto,
  StocksRange,
} from '@shared/ipc-channels';

const RANGES: StocksRange[] = ['1m', '3m', '6m', '1y', '2y', '5y', 'max'];

// ---- icons ----
const SIcon = {
  plus: (
    <svg viewBox="0 0 12 12" fill="none" width="12" height="12">
      <path d="M6 2v8 M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 12 12" fill="none" width="11" height="11">
      <path d="M2.5 2.5l7 7 M9.5 2.5l-7 7" stroke="currentColor" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
      <circle cx="8" cy="8" r="6" stroke="currentColor" />
      <path d="M8 7.2v3.4 M8 5.2v.2" stroke="currentColor" strokeLinecap="round" />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
      <path d="M13 8a5 5 0 11-1.4-3.5 M12.5 2v2.5H10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 20 20" fill="none" width="20" height="20">
      <rect x="4" y="9" width="12" height="8" rx="1.6" stroke="currentColor" />
      <path d="M6.5 9V6.6a3.5 3.5 0 017 0V9" stroke="currentColor" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
      <path d="M3 8.5l3 3 7-7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  spinner: (s = 15): JSX.Element => (
    <svg className="stk-spin" width={s} height={s} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" />
      <path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeLinecap="round" />
    </svg>
  ),
};

// ---- formatting helpers ----
function decimalsFor(p: number | null): number {
  return p == null ? 2 : p < 5 ? 4 : p < 2000 ? 2 : 0;
}
function fmtPx(p: number | null | undefined): string {
  if (p == null) return '—';
  const d = decimalsFor(p);
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function chgClass(n: number): string {
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
}
function fmtChg(chg: number, pct: number): string {
  const s = chg > 0 ? '+' : '';
  return `${s}${fmtPx(chg)} (${s}${pct.toFixed(2)}%)`;
}

type NumInput = number | '';
type Quotes = Record<string, StockQuoteResponse>;

// =========================================================
// Watchlist (left)
// =========================================================
function StkWatchlist({
  symbols,
  quotes,
  selected,
  onSelect,
  onAdd,
  onRemove,
}: {
  symbols: string[];
  quotes: Quotes;
  selected: string | null;
  onSelect: (s: string) => void;
  onAdd: (s: string) => void;
  onRemove: (s: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const submit = (): void => {
    const s = draft.toUpperCase().trim();
    if (s && !symbols.includes(s)) onAdd(s);
    setDraft('');
  };
  return (
    <div className="stk-watch">
      <div className="stk-watch-head">
        <div className="eyebrow">Watchlist</div>
        <span className="mono" style={{ color: 'var(--ink-faint)', fontSize: 11 }}>
          {symbols.length}
        </span>
      </div>
      <div className="stk-watch-add">
        <input
          className="field mono"
          placeholder="Add symbol…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button className="btn btn-sm" onClick={submit} aria-label="Add symbol" disabled={!draft.trim()}>
          {SIcon.plus}
        </button>
      </div>
      <div className="stk-watch-list scroll">
        {symbols.map((sym) => {
          const q = quotes[sym];
          const cls = q ? chgClass(q.change) : 'flat';
          return (
            <div
              key={sym}
              className={'stk-wrow' + (selected === sym ? ' active' : '')}
              onClick={() => onSelect(sym)}
            >
              <div style={{ minWidth: 0 }}>
                <div className="stk-wrow-sym">{sym}</div>
                <div className="stk-wrow-px">{q ? fmtPx(q.price) : 'loading…'}</div>
              </div>
              <div className="stk-wrow-right">
                <button
                  className="stk-wrow-x"
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(sym);
                  }}
                >
                  {SIcon.x}
                </button>
                {q && (
                  <span className={'stk-wrow-chg ' + cls}>
                    {q.change > 0 ? '+' : ''}
                    {q.changePct.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {symbols.length === 0 && (
          <div style={{ padding: '16px 12px', color: 'var(--ink-faint)', fontSize: 12 }}>
            No symbols yet. Add one above.
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================
// Factor row — diverging bar
// =========================================================
function FactorRow({ f }: { f: StockFactorDto }): JSX.Element {
  const pct = Math.min(50, Math.abs(f.score) * 50);
  const pos = f.score >= 0;
  return (
    <div className="stk-factor">
      <div className="stk-factor-top">
        <span className="stk-factor-name">{f.key}</span>
        <span className="stk-factor-score">
          {f.score > 0 ? '+' : ''}
          {f.score.toFixed(2)} · w{f.weight}
        </span>
      </div>
      <div className="stk-diverge">
        <div className={'stk-diverge-fill ' + (pos ? 'pos' : 'neg')} style={{ width: pct + '%' }} />
      </div>
      <div className="stk-factor-note">{f.note}</div>
    </div>
  );
}

// =========================================================
// Risk calculator
// =========================================================
function RiskCalc({
  account,
  riskPct,
  onChange,
  shares,
  updating,
  entry,
  stoploss,
}: {
  account: NumInput;
  riskPct: NumInput;
  onChange: (patch: { account?: NumInput; riskPct?: NumInput }) => void;
  shares: number | undefined;
  updating: boolean;
  entry: number | null;
  stoploss: number | null;
}): JSX.Element {
  const perShare = entry != null && stoploss != null ? Math.abs(entry - stoploss) : null;
  const accNum = account === '' ? 0 : account;
  const rpNum = riskPct === '' ? 0 : riskPct;
  return (
    <div className="stk-side-sec" style={{ borderBottom: 0 }}>
      <h4>Risk calculator</h4>
      <div className="stk-risk-row">
        <label>Account size</label>
        <div className="stk-risk-inrow">
          <span className="pre">$</span>
          <input
            className="field mono"
            type="number"
            min="0"
            step="100"
            value={account}
            onChange={(e) => onChange({ account: e.target.value === '' ? '' : Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="stk-risk-row">
        <label>Risk per trade</label>
        <div className="stk-risk-inrow">
          <input
            className="field mono"
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={riskPct}
            onChange={(e) => onChange({ riskPct: e.target.value === '' ? '' : Number(e.target.value) })}
          />
          <span className="pre">%</span>
        </div>
      </div>
      <div className={'stk-risk-out' + (updating ? ' updating' : '')}>
        <span className="k">Suggested size</span>
        <span className="v">{shares == null ? '—' : updating ? '…' : `${shares.toLocaleString()} sh`}</span>
      </div>
      {perShare != null && account !== '' && (
        <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
          Risking ${(accNum * (rpNum / 100)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ÷{' '}
          {fmtPx(perShare)}/sh stop distance
        </div>
      )}
    </div>
  );
}

// =========================================================
// Right side — factors / patterns / risk
// =========================================================
function StkSidePanel({
  analysis,
  account,
  riskPct,
  onRiskChange,
  riskUpdating,
}: {
  analysis: StockAnalysisResponse | null;
  account: NumInput;
  riskPct: NumInput;
  onRiskChange: (patch: { account?: NumInput; riskPct?: NumInput }) => void;
  riskUpdating: boolean;
}): JSX.Element {
  if (!analysis) {
    return (
      <div className="stk-side">
        <div className="stk-side-sec">
          <h4>Signal breakdown</h4>
          <div style={{ color: 'var(--ink-faint)', fontSize: 12.5, lineHeight: 1.5 }}>
            Run an analysis to see the factor scores, detected patterns, and position sizing.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="stk-side scroll">
      <div className="stk-side-sec">
        <h4>Why — factor breakdown</h4>
        {analysis.factors.map((f) => (
          <FactorRow key={f.key} f={f} />
        ))}
      </div>
      <div className="stk-side-sec">
        <h4>Detected patterns</h4>
        {analysis.patterns.length === 0 ? (
          <div style={{ color: 'var(--ink-faint)', fontSize: 12 }}>No notable patterns.</div>
        ) : (
          <div className="stk-chips">
            {analysis.patterns.map((p, i) => (
              <span key={i} className={'stk-chip ' + p.bias} title={p.kind}>
                <span className="dot" />
                {p.label}
                <span className="cf">{Math.round(p.confidence * 100)}%</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <RiskCalc
        account={account}
        riskPct={riskPct}
        onChange={onRiskChange}
        shares={analysis.positionShares}
        updating={riskUpdating}
        entry={analysis.entry}
        stoploss={analysis.stoploss}
      />
    </div>
  );
}


// persistent disclaimer
function Disclaimer(): JSX.Element {
  return (
    <div className="stk-disclaimer" role="note">
      {SIcon.info}
      <span>
        <b>Educational analysis from public data — not financial advice.</b> Forecasts are
        illustrative scenarios, not predictions of actual price.
      </span>
    </div>
  );
}

// =========================================================
// Detail + side share one analysis object
// =========================================================
function StkDetailWithSide({
  symbol,
  onQuote,
  account,
  riskPct,
  setAccount,
  setRiskPct,
}: {
  symbol: string;
  onQuote: (sym: string, q: StockQuoteResponse) => void;
  account: NumInput;
  riskPct: NumInput;
  setAccount: (v: NumInput) => void;
  setRiskPct: (v: NumInput) => void;
}): JSX.Element {
  const [range, setRange] = useState<StocksRange>('6m');
  const [quote, setQuote] = useState<StockQuoteResponse | null>(null);
  const [analysis, setAnalysis] = useState<StockAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [riskUpdating, setRiskUpdating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqRef = useRef(0);

  const runAnalyze = (over?: { account?: NumInput; riskPct?: NumInput }): void => {
    const myReq = ++reqRef.current;
    setError(null);
    const acc = over && 'account' in over ? over.account : account;
    const rp = over && 'riskPct' in over ? over.riskPct : riskPct;
    ipc.stocks
      .analyze({
        symbol,
        range,
        ...(acc === '' ? {} : { account: acc }),
        ...(rp === '' ? {} : { riskPct: rp }),
      })
      .then((res) => {
        if (reqRef.current === myReq) {
          setAnalysis(res);
          setLoading(false);
          setRiskUpdating(false);
        }
      })
      .catch((err: unknown) => {
        if (reqRef.current === myReq) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
          setRiskUpdating(false);
        }
      });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setQuote(null);
    ipc.stocks
      .quote(symbol)
      .then((q) => {
        if (alive) {
          setQuote(q);
          onQuote(symbol, q);
        }
      })
      .catch(() => {});
    runAnalyze();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, range]);

  const onRiskChange = (patch: { account?: NumInput; riskPct?: NumInput }): void => {
    if ('account' in patch && patch.account !== undefined) setAccount(patch.account);
    if ('riskPct' in patch && patch.riskPct !== undefined) setRiskPct(patch.riskPct);
    setRiskUpdating(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const next = {
      account: 'account' in patch ? patch.account : account,
      riskPct: 'riskPct' in patch ? patch.riskPct : riskPct,
    };
    debounceRef.current = setTimeout(() => runAnalyze(next), 480);
  };

  const dir = analysis ? analysis.direction : null;
  const price = quote ? quote.price : analysis ? analysis.price : null;

  return (
    <>
      <div className="stk-center">
        <div className="stk-chead">
          <div className="stk-chead-id">
            <span className="stk-chead-sym">{symbol}</span>
            <span className="stk-chead-px">{fmtPx(price)}</span>
            {quote && (
              <span className={'stk-chead-chg ' + chgClass(quote.change)}>
                {fmtChg(quote.change, quote.changePct)}
              </span>
            )}
          </div>
          <div className="stk-chead-spacer" />
          <div className="stk-range" role="tablist" aria-label="Chart range">
            {RANGES.map((r) => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
          <button
            className="btn btn-sm"
            onClick={() => {
              setLoading(true);
              runAnalyze();
            }}
            disabled={loading}
          >
            {loading ? SIcon.spinner(13) : SIcon.refresh}
            <span>{loading ? 'Analyzing…' : 'Analyze'}</span>
          </button>
        </div>

        <div className="stk-cscroll scroll">
          <div className="stk-chart-card">
            {analysis && analysis.chartHtml && (
              <iframe
                key={analysis.asOf + range}
                srcDoc={analysis.chartHtml}
                sandbox="allow-scripts"
                title={`${symbol} candlestick chart with forecast`}
              />
            )}
            {!error && (
              <div className="stk-chart-legend">
                <span style={{ color: 'var(--accent)' }}>
                  <i />
                  base
                </span>
                <span style={{ color: 'var(--ink-muted)' }}>
                  <i style={{ borderTopStyle: 'dashed' }} />
                  bull/bear
                </span>
                <span style={{ color: 'var(--good)' }}>
                  <i style={{ borderTopStyle: 'dashed' }} />
                  TP
                </span>
                <span style={{ color: 'var(--bad)' }}>
                  <i style={{ borderTopStyle: 'dashed' }} />
                  SL
                </span>
              </div>
            )}
            {loading && !error && (
              <div className="stk-chart-state">
                <div className="col center" style={{ gap: 10 }}>
                  <span style={{ color: 'var(--ink-muted)' }}>{SIcon.spinner(22)}</span>
                  <span>
                    Analyzing {symbol} — {range} history, factor scoring, forecast cone…
                  </span>
                </div>
              </div>
            )}
            {error && (
              <div className="stk-chart-state">
                <div className="col center" style={{ gap: 12 }}>
                  <span style={{ color: 'var(--bad)', fontSize: 13 }}>Couldn’t analyze {symbol}</span>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-faint)', maxWidth: 320 }}>
                    {error}
                  </span>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setLoading(true);
                      runAnalyze();
                    }}
                  >
                    {SIcon.refresh}
                    <span>Retry</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {analysis && dir && (
            <div className="stk-signal">
              <div className="stk-signal-top">
                <div className={'stk-dir ' + dir}>
                  <span className="stk-dir-label">{dir.toUpperCase()}</span>
                  <span className="stk-dir-sub">
                    {symbol} · {range}
                  </span>
                </div>
                <div className="stk-conf">
                  <div className="stk-conf-row">
                    <span className="lab">Confidence</span>
                    <span className="val">{Math.round(analysis.confidence * 100)}%</span>
                  </div>
                  <div className="stk-conf-track">
                    <div className="stk-conf-fill" style={{ width: analysis.confidence * 100 + '%' }} />
                  </div>
                  <div className="row" style={{ gap: 14, marginTop: 12 }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                      RSI {analysis.rsi == null ? '—' : analysis.rsi.toFixed(0)}
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                      MACD-h{' '}
                      {analysis.macdHistogram == null
                        ? '—'
                        : (analysis.macdHistogram > 0 ? '+' : '') + analysis.macdHistogram.toFixed(2)}
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                      R:R {analysis.rewardRisk.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="stk-stats">
                <div className="stk-stat">
                  <div className="k">Entry</div>
                  <div className="v">{fmtPx(analysis.entry)}</div>
                </div>
                <div className="stk-stat">
                  <div className="k">Stoploss</div>
                  <div className="v down">{fmtPx(analysis.stoploss)}</div>
                </div>
                <div className="stk-stat">
                  <div className="k">Reward : Risk</div>
                  <div className="v">{analysis.rewardRisk.toFixed(1)} : 1</div>
                </div>
                <div className="stk-stat">
                  <div className="k">Take-profit 1</div>
                  <div className="v up">{fmtPx(analysis.takeProfit[0])}</div>
                </div>
                <div className="stk-stat">
                  <div className="k">Take-profit 2</div>
                  <div className="v up">{fmtPx(analysis.takeProfit[1])}</div>
                </div>
                <div className="stk-stat">
                  <div className="k">Take-profit 3</div>
                  <div className="v up">{fmtPx(analysis.takeProfit[2])}</div>
                </div>
              </div>

              {analysis.positionShares != null && (
                <div className="stk-size">
                  Suggested size at {riskPct === '' ? 0 : riskPct}% risk on $
                  {Number(account || 0).toLocaleString()}: <b>{analysis.positionShares.toLocaleString()} shares</b>
                  <span style={{ color: 'var(--ink-faint)' }}>
                    {' '}
                    · ≈ $
                    {(analysis.positionShares * analysis.entry).toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}{' '}
                    notional
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <StkSidePanel
        analysis={analysis}
        account={account}
        riskPct={riskPct}
        onRiskChange={onRiskChange}
        riskUpdating={riskUpdating}
      />
    </>
  );
}

// =========================================================
// Stocks — top-level screen
// =========================================================
export function Stocks(): JSX.Element {
  const [view, setView] = useState<'analyze' | 'autopilot'>('analyze');
  const [symbols, setSymbols] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Quotes>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [account, setAccount] = useState<NumInput>(25000);
  const [riskPct, setRiskPct] = useState<NumInput>(1);

  // load watchlist once
  useEffect(() => {
    let alive = true;
    void ipc.stocks.getWatchlist().then((r) => {
      if (!alive) return;
      setSymbols(r.symbols);
      setSelected(r.symbols[0] ?? null);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // lazily fetch quotes for watchlist rows (sequential)
  useEffect(() => {
    if (!symbols.length) return;
    let alive = true;
    void (async () => {
      for (const sym of symbols) {
        if (!alive) return;
        if (quotes[sym]) continue;
        try {
          const q = await ipc.stocks.quote(sym);
          if (alive) setQuotes((prev) => ({ ...prev, [sym]: q }));
        } catch {
          /* skip bad symbol quote */
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols]);

  const persist = (next: string[]): void => {
    setSymbols(next);
    void ipc.stocks.setWatchlist(next).catch(() => {});
  };
  const addSymbol = (sym: string): void => {
    persist([...symbols, sym]);
    setSelected(sym);
  };
  const removeSymbol = (sym: string): void => {
    const next = symbols.filter((s) => s !== sym);
    persist(next);
    setQuotes((prev) => {
      const c = { ...prev };
      delete c[sym];
      return c;
    });
    if (selected === sym) setSelected(next[0] ?? null);
  };
  const onQuote = (sym: string, q: StockQuoteResponse): void =>
    setQuotes((prev) => ({ ...prev, [sym]: q }));

  return (
    <div className="stocks-page">
      <Disclaimer />
      <div className="row gap-1" style={{ padding: '8px 16px 0' }}>
        <button
          type="button"
          className={view === 'analyze' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
          onClick={() => setView('analyze')}
        >
          Analyze
        </button>
        <button
          type="button"
          className={view === 'autopilot' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
          onClick={() => setView('autopilot')}
        >
          AI Trader
        </button>
      </div>
      {view === 'autopilot' ? (
        <div className="tr-host">
          <AiTrader />
        </div>
      ) : (
      <div className="stk-body">
        <StkWatchlist
          symbols={symbols}
          quotes={quotes}
          selected={selected}
          onSelect={setSelected}
          onAdd={addSymbol}
          onRemove={removeSymbol}
        />
        {selected ? (
          <StkDetailWithSide
            key={selected}
            symbol={selected}
            onQuote={onQuote}
            account={account}
            riskPct={riskPct}
            setAccount={setAccount}
            setRiskPct={setRiskPct}
          />
        ) : (
          <>
            <div className="stk-center">
              <div className="stk-empty">{ready ? 'Select or add a symbol to begin.' : 'Loading watchlist…'}</div>
            </div>
            <div className="stk-side">
              <div className="stk-side-sec">
                <h4>Signal breakdown</h4>
              </div>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}
