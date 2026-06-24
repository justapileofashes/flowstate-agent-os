/* =========================================================
   stocks-ipc.js — simulated ipc.stocks.* surface.

   In the real app these are typed in src/renderer/src/lib/ipc.ts and
   implemented in the main process (market data + a local analysis model).
   Here everything is generated DETERMINISTICALLY from the symbol so the
   prototype behaves like a real backend: the same ticker always draws the
   same chart, quote ≈ last close, and analyze() returns a complete,
   self-contained candlestick chartHtml with all five overlay layers.

   Educational analysis only — not financial advice. The numbers are
   synthetic and illustrative.
   ========================================================= */
(function () {
  window.ipc = window.ipc || {};

  /* ---------- seeded RNG ---------- */
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- per-symbol character ---------- */
  const BASE = {
    "NVDA": 122, "AAPL": 213, "TSLA": 246, "MSFT": 438, "AMZN": 201, "GOOGL": 178,
    "META": 564, "SPY": 548, "QQQ": 472, "AMD": 158,
    "BTC-USD": 67200, "ETH-USD": 3480, "SOL-USD": 168,
    "EURUSD": 1.082, "GBPUSD": 1.268, "USDJPY": 156.4
  };
  const KIND = (sym) =>
    /-USD$/.test(sym) ? "crypto" :
    /^[A-Z]{6}$/.test(sym) && /USD|JPY|EUR|GBP/.test(sym) ? "forex" :
    "equity";

  function basePrice(sym) {
    if (BASE[sym] != null) return BASE[sym];
    const r = mulberry32(hashStr(sym));
    const k = KIND(sym);
    if (k === "crypto") return 40 + Math.floor(r() * 900);
    if (k === "forex") return 0.8 + r() * 0.9;
    return 18 + Math.floor(r() * 380);
  }
  function volOf(sym) {
    const k = KIND(sym);
    const r = mulberry32(hashStr(sym + ":v"));
    if (k === "crypto") return 0.028 + r() * 0.02;
    if (k === "forex") return 0.0035 + r() * 0.003;
    return 0.012 + r() * 0.014;
  }

  function decimalsFor(p) { return p < 5 ? 4 : p < 2000 ? 2 : 0; }
  function fmt(p) {
    const d = decimalsFor(p);
    return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* ---------- deterministic master OHLC path ---------- */
  const MASTER_LEN = 1300;
  const _master = {};
  function masterPath(sym) {
    if (_master[sym]) return _master[sym];
    const rng = mulberry32(hashStr(sym));
    let p = basePrice(sym);
    const vol = volOf(sym);
    // long-run drift + a couple of regime waves so charts have structure
    const drift = (rng() - 0.42) * 0.0006;
    const w1 = 0.6 + rng() * 0.8, w2 = 1.7 + rng() * 1.6;
    const bars = [];
    let prevClose = p;
    for (let i = 0; i < MASTER_LEN; i++) {
      const cycle = Math.sin(i / 90 * w1) * 0.0012 + Math.sin(i / 31 * w2) * 0.0008;
      const shock = (rng() - 0.5) * 2;
      p = Math.max(0.0001, p * (1 + drift + cycle + shock * vol));
      const open = prevClose;
      const close = p;
      const hi = Math.max(open, close) * (1 + rng() * vol * 0.9);
      const lo = Math.min(open, close) * (1 - rng() * vol * 0.9);
      const volume = Math.round((0.6 + rng() * 0.9) * (KIND(sym) === "crypto" ? 38000 : 1200000));
      bars.push({ o: open, h: hi, l: lo, c: close, v: volume });
      prevClose = close;
    }
    _master[sym] = bars;
    return bars;
  }

  const RANGE_BARS = { "1m": 22, "3m": 66, "6m": 130, "1y": 252, "2y": 504, "5y": 600, "max": 900 };
  function dateStr(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  }
  function sliceSeries(sym, range) {
    const n = RANGE_BARS[range] || RANGE_BARS["6m"];
    const m = masterPath(sym);
    const slice = m.slice(m.length - n);
    return slice.map((b, i) => ({
      time: dateStr(n - 1 - i),
      open: round(b.o), high: round(b.h), low: round(b.l), close: round(b.c), volume: b.v
    }));
    function round(x) { const d = decimalsFor(x); const f = Math.pow(10, d); return Math.round(x * f) / f; }
  }

  /* ---------- indicators ---------- */
  function sma(arr, p) { if (arr.length < p) return null; let s = 0; for (let i = arr.length - p; i < arr.length; i++) s += arr[i]; return s / p; }
  function ema(arr, p) {
    if (!arr.length) return null;
    const k = 2 / (p + 1); let e = arr[0];
    for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  }
  function emaSeries(arr, p) {
    const k = 2 / (p + 1); const out = []; let e = arr[0];
    for (let i = 0; i < arr.length; i++) { e = i ? arr[i] * k + e * (1 - k) : arr[i]; out.push(e); }
    return out;
  }
  function rsi(closes, p) {
    if (closes.length < p + 1) return null;
    let g = 0, l = 0;
    for (let i = closes.length - p; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) g += d; else l -= d;
    }
    g /= p; l /= p;
    if (l === 0) return 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  }
  function macdHist(closes) {
    if (closes.length < 35) return null;
    const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
    const macd = closes.map((_, i) => e12[i] - e26[i]);
    const sig = emaSeries(macd, 9);
    return macd[macd.length - 1] - sig[sig.length - 1];
  }
  function atr(bars, p) {
    if (bars.length < p + 1) return null;
    let s = 0;
    for (let i = bars.length - p; i < bars.length; i++) {
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close)
      );
      s += tr;
    }
    return s / p;
  }
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /* ---------- the analysis engine ---------- */
  function buildAnalysis(opts) {
    const symbol = (opts.symbol || "").toUpperCase().trim();
    const range = opts.range || "6m";
    const horizon = opts.horizon || 22;
    const bars = sliceSeries(symbol, range);
    const closes = bars.map(b => b.close);
    const price = closes[closes.length - 1];
    const sym = symbol;

    const sma20 = sma(closes, 20), sma50 = sma(closes, 50);
    const r = rsi(closes, 14);
    const mh = macdHist(closes);
    const a = atr(bars, 14) || price * 0.02;
    const stable = mulberry32(hashStr(sym + ":factors"));

    // slope of sma20 over last ~10 bars (normalized)
    const slopeRef = sma(closes.slice(0, -10).concat(), 20);
    const slope = sma20 != null && slopeRef != null ? (sma20 - slopeRef) / price : 0;

    // recent swing levels
    const recent = bars.slice(-40);
    const swingHi = Math.max(...recent.map(b => b.high));
    const swingLo = Math.min(...recent.map(b => b.low));
    const posInRange = (price - swingLo) / Math.max(1e-9, swingHi - swingLo); // 0..1

    const avgVol = closes.length ? bars.slice(-20).reduce((s, b) => s + b.volume, 0) / 20 : 1;
    const lastVol = bars[bars.length - 1].volume;
    const volRatio = lastVol / Math.max(1, avgVol);

    // factor scores in -1..+1
    const fTrend = clamp((sma20 && sma50 ? (sma20 - sma50) / price * 28 : 0) + slope * 60, -1, 1);
    const fMomentum = clamp(r != null ? (r - 50) / 32 : 0, -1, 1);
    const fVolatility = clamp(0.45 - (a / price) * 14, -1, 1); // lower vol → mildly positive
    const fLevels = clamp((0.5 - posInRange) * 1.7, -1, 1);    // near support → positive
    const fVolume = clamp((volRatio - 1) * 1.1 * Math.sign(fMomentum || 1), -1, 1);
    const fPattern = clamp((slope * 50) + (stable() - 0.5) * 0.7, -1, 1);
    const fFund = clamp((stable() - 0.45) * 1.6, -1, 1);
    const fSent = clamp((stable() - 0.5) * 1.8, -1, 1);

    const factors = [
      { key: "trend", weight: 0.22, score: round2(fTrend), note: noteTrend(fTrend, sma20, sma50) },
      { key: "momentum", weight: 0.18, score: round2(fMomentum), note: r != null ? `RSI ${r.toFixed(0)} — ${r > 60 ? "strong" : r < 40 ? "weak" : "neutral"} momentum.` : "Insufficient data." },
      { key: "volatility", weight: 0.10, score: round2(fVolatility), note: `ATR ${fmt(a)} (${((a / price) * 100).toFixed(1)}% of price) — ${a / price > 0.03 ? "elevated" : "contained"}.` },
      { key: "levels", weight: 0.15, score: round2(fLevels), note: `${(posInRange * 100).toFixed(0)}% up the ${recent.length}-bar range; ${posInRange < 0.4 ? "near support" : posInRange > 0.7 ? "near resistance" : "mid-range"}.` },
      { key: "volume", weight: 0.10, score: round2(fVolume), note: `Last bar ${volRatio.toFixed(2)}× the 20-bar average volume.` },
      { key: "pattern", weight: 0.10, score: round2(fPattern), note: notePattern(fPattern) },
      { key: "fundamentals", weight: 0.08, score: round2(fFund), note: fFund > 0 ? "Valuation & growth screen mildly supportive." : "Valuation screen mildly cautious." },
      { key: "sentiment", weight: 0.07, score: round2(fSent), note: fSent > 0 ? "News & social tone leans constructive." : "News & social tone leans cautious." }
    ];

    const composite = factors.reduce((s, f) => s + f.score * f.weight, 0); // ~ -1..1
    let direction = "hold";
    if (composite > 0.14) direction = "buy";
    else if (composite < -0.14) direction = "sell";
    const confidence = round2(clamp(0.5 + Math.abs(composite) * 0.9, 0.5, 0.94));

    // trade levels
    const dir = direction === "sell" ? -1 : 1;
    const entry = round(price);
    const slDist = a * (direction === "hold" ? 1.6 : 1.5);
    const stoploss = round(direction === "sell" ? entry + slDist : entry - slDist);
    const R = Math.abs(entry - stoploss);
    const takeProfit = [1, 2, 3].map(m => round(entry + dir * R * m));
    const rewardRisk = round2(2.0);

    // patterns
    const patterns = detectPatterns(bars, { fTrend, fPattern, r, sym, stable });

    // forecast cone (bull / base / bear), projected forward `horizon` steps
    const fc = forecast(price, a, composite, horizon, sym);

    // optional position sizing
    let positionShares;
    if (opts.account != null && opts.riskPct != null && R > 0) {
      const riskAmount = opts.account * (opts.riskPct / 100);
      positionShares = Math.max(0, Math.floor(riskAmount / R));
    }

    const asOf = new Date().toISOString();

    const chartData = {
      symbol: sym, asOf, price,
      decimals: decimalsFor(price),
      bars: bars.map(b => ({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close })),
      levels: { entry, stoploss, takeProfit },
      forecast: fc,
      patterns: patterns.map(p => ({ label: p.label, bias: p.bias, line: p.line || null })),
      direction, confidence
    };

    return {
      symbol: sym, range, asOf, price,
      direction, confidence, factors,
      entry, stoploss, takeProfit, rewardRisk,
      positionShares,
      rsi: r == null ? null : round2(r),
      macdHistogram: mh == null ? null : round2(mh),
      patterns,
      chartHtml: buildChartHtml(chartData)
    };

    function round(x) { const d = decimalsFor(x); const f = Math.pow(10, d); return Math.round(x * f) / f; }
  }

  function round2(x) { return Math.round(x * 100) / 100; }
  function noteTrend(s, s20, s50) {
    if (s20 == null || s50 == null) return "Building moving-average history.";
    const rel = s20 > s50 ? "above" : "below";
    return `20-MA ${rel} 50-MA; ${s > 0.2 ? "uptrend intact" : s < -0.2 ? "downtrend pressure" : "trend flattening"}.`;
  }
  function notePattern(s) {
    return s > 0.25 ? "Higher-highs / higher-lows structure." :
           s < -0.25 ? "Lower-highs / lower-lows structure." :
           "No decisive pattern; consolidating.";
  }

  function detectPatterns(bars, ctx) {
    const out = [];
    const recent = bars.slice(-50);
    const closes = recent.map(b => b.close);
    const first = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    const last = closes.slice(-12).reduce((a, b) => a + b, 0) / 12;
    const n = bars.length;
    const loIdx = bars.length - 50 + recent.reduce((mi, b, i, arr) => b.low < arr[mi].low ? i : mi, 0);
    const hiIdx = bars.length - 50 + recent.reduce((mi, b, i, arr) => b.high > arr[mi].high ? i : mi, 0);

    if (ctx.fTrend > 0.25 && last > first) {
      out.push({ kind: "channel", label: "Ascending channel", bias: "bullish", confidence: round2(clamp(0.55 + ctx.fTrend * 0.3, 0.5, 0.9)),
        line: [{ i: loIdx, p: bars[loIdx].low }, { i: n - 1, p: bars[n - 1].close }] });
    } else if (ctx.fTrend < -0.25 && last < first) {
      out.push({ kind: "channel", label: "Descending channel", bias: "bearish", confidence: round2(clamp(0.55 - ctx.fTrend * 0.3, 0.5, 0.9)),
        line: [{ i: hiIdx, p: bars[hiIdx].high }, { i: n - 1, p: bars[n - 1].close }] });
    } else {
      out.push({ kind: "range", label: "Sideways range", bias: "neutral", confidence: 0.6,
        line: [{ i: bars.length - 40, p: bars[hiIdx].high }, { i: n - 1, p: bars[hiIdx].high }] });
    }

    if (ctx.r != null && ctx.r > 68) out.push({ kind: "rsi", label: "RSI overbought", bias: "bearish", confidence: 0.58 });
    else if (ctx.r != null && ctx.r < 32) out.push({ kind: "rsi", label: "RSI oversold", bias: "bullish", confidence: 0.58 });

    if (ctx.stable() > 0.62) {
      const bull = ctx.fPattern >= 0;
      out.push({ kind: "candle", label: bull ? "Bullish engulfing" : "Bearish engulfing", bias: bull ? "bullish" : "bearish", confidence: round2(0.52 + ctx.stable() * 0.2) });
    }
    return out;
  }

  function forecast(price, atrv, composite, steps, sym) {
    const rng = mulberry32(hashStr(sym + ":fc"));
    const drift = composite * atrv * 0.35;       // per-step expected move
    const base = [], bull = [], bear = [];
    let bp = price;
    for (let i = 1; i <= steps; i++) {
      bp = bp + drift + (rng() - 0.5) * atrv * 0.18;
      const widen = atrv * Math.sqrt(i) * 1.25;  // cone widens with √time
      base.push(r4(bp));
      bull.push(r4(bp + widen));
      bear.push(r4(Math.max(0.0001, bp - widen)));
    }
    return { base, bull, bear };
    function r4(x) { const d = decimalsFor(x); const f = Math.pow(10, d); return Math.round(x * f) / f; }
  }

  /* =========================================================
     chartHtml — a complete, self-contained candlestick chart.
     Five layers: candles · entry/SL/TP · bull/base/bear cone ·
     pattern line · confidence + "not advice" label.
     Rendered inside a sandboxed iframe (allow-scripts).
     ========================================================= */
  function buildChartHtml(D) {
    const json = JSON.stringify(D);
    return '<!doctype html><html><head><meta charset="utf-8"><style>' +
      'html,body{margin:0;padding:0;height:100%;width:100%;background:#14110d;overflow:hidden;' +
      "font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace}" +
      '#c{display:block;width:100vw;height:100vh}</style></head><body><canvas id="c"></canvas><script>' +
      'const D=' + json + ';' + CHART_RENDERER + '<\/script></body></html>';
  }

  // The renderer runs INSIDE the iframe. Kept as a string so the outer file
  // stays a normal module; it draws everything with Canvas 2D.
  const CHART_RENDERER = `
  (function(){
    var C={ ink:'#f0ece2', strong:'#faf6ec', muted:'#a09a8e', faint:'#5c574f',
      grid:'rgba(240,236,226,0.05)', accent:'#e8e3d5', up:'#c8c2b3', down:'#a08278',
      cone:'rgba(232,227,213,0.06)', border:'rgba(240,236,226,0.10)' };
    var cv=document.getElementById('c'), ctx=cv.getContext('2d');
    var dec=D.decimals||2;
    function nf(x){ return Number(x).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec}); }
    function draw(W,H){
      ctx.clearRect(0,0,W,H);
      var padT=18, padB=20, padL=10, padR=72;
      var plotW=W-padL-padR, plotH=H-padT-padB;
      // downsample candles for width
      var bars=D.bars, maxB=Math.max(40, Math.floor(plotW/4));
      if(bars.length>maxB){ var step=Math.ceil(bars.length/maxB); var nb=[]; for(var i=0;i<bars.length;i+=step){ var seg=bars.slice(i,i+step); nb.push({t:seg[seg.length-1].t,o:seg[0].o,h:Math.max.apply(null,seg.map(function(s){return s.h})),l:Math.min.apply(null,seg.map(function(s){return s.l})),c:seg[seg.length-1].c}); } bars=nb; }
      var nHist=bars.length, fc=D.forecast||{base:[],bull:[],bear:[]}, nFut=fc.base.length, total=nHist+nFut;
      var slot=plotW/total;
      function cx(i){ return padL+(i+0.5)*slot; }
      // y-domain
      var vals=[];
      bars.forEach(function(b){ vals.push(b.h,b.l); });
      fc.bull.forEach(function(v){ vals.push(v); }); fc.bear.forEach(function(v){ vals.push(v); });
      var L=D.levels; vals.push(L.entry,L.stoploss); L.takeProfit.forEach(function(v){ vals.push(v); });
      var lo=Math.min.apply(null,vals), hi=Math.max.apply(null,vals), pad=(hi-lo)*0.07||1; lo-=pad; hi+=pad;
      function cy(p){ return padT+(1-(p-lo)/(hi-lo))*plotH; }
      var nowX=padL+nHist*slot;

      // grid + right-edge price labels
      ctx.font='10px JetBrains Mono, monospace'; ctx.textBaseline='middle';
      ctx.strokeStyle=C.grid; ctx.lineWidth=1;
      var ticks=5;
      for(var g=0; g<=ticks; g++){
        var p=lo+(hi-lo)*g/ticks, y=cy(p);
        ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke();
        ctx.fillStyle=C.faint; ctx.textAlign='left'; ctx.fillText(nf(p), W-padR+6, y);
      }

      // forecast cone (bull over, bear back)
      if(nFut){
        ctx.beginPath();
        ctx.moveTo(nowX, cy(D.price));
        for(var i=0;i<nFut;i++){ ctx.lineTo(cx(nHist+i), cy(fc.bull[i])); }
        for(var j=nFut-1;j>=0;j--){ ctx.lineTo(cx(nHist+j), cy(fc.bear[j])); }
        ctx.lineTo(nowX, cy(D.price)); ctx.closePath();
        ctx.fillStyle=C.cone; ctx.fill();
      }

      // candles
      var bw=Math.max(1, Math.min(9, slot*0.62));
      bars.forEach(function(b,i){
        var x=cx(i), up=b.c>=b.o, col=up?C.up:C.down;
        ctx.strokeStyle=col; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(x, cy(b.h)); ctx.lineTo(x, cy(b.l)); ctx.stroke();
        var yo=cy(b.o), yc=cy(b.c), top=Math.min(yo,yc), hgt=Math.max(1,Math.abs(yc-yo));
        if(up){ ctx.fillStyle=col; ctx.fillRect(x-bw/2, top, bw, hgt); }
        else { ctx.fillStyle=col; ctx.globalAlpha=0.9; ctx.fillRect(x-bw/2, top, bw, hgt); ctx.globalAlpha=1; }
      });

      // pattern line(s)
      (D.patterns||[]).forEach(function(p){
        if(!p.line) return;
        var bias=p.bias, col=bias==='bullish'?C.up:bias==='bearish'?C.down:C.muted;
        // remap line indices (full-res) onto downsampled x by ratio
        var ratio=nHist/D.bars.length;
        var x1=cx(Math.round(p.line[0].i*ratio)), y1=cy(p.line[0].p);
        var x2=cx(Math.round(p.line[1].i*ratio)), y2=cy(p.line[1].p);
        ctx.save(); ctx.setLineDash([5,4]); ctx.strokeStyle=col; ctx.globalAlpha=0.7; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); ctx.restore();
      });

      // forecast lines: base solid (accent), bull/bear dashed (faint)
      if(nFut){
        function line(arr,style,dash,alpha){
          ctx.save(); if(dash) ctx.setLineDash(dash); ctx.strokeStyle=style; ctx.globalAlpha=alpha; ctx.lineWidth=dash?1:1.4;
          ctx.beginPath(); ctx.moveTo(nowX, cy(D.price));
          for(var i=0;i<nFut;i++) ctx.lineTo(cx(nHist+i), cy(arr[i]));
          ctx.stroke(); ctx.restore();
        }
        line(fc.bull, C.muted, [3,3], 0.6);
        line(fc.bear, C.muted, [3,3], 0.6);
        line(fc.base, C.accent, null, 0.95);
      }

      // 'now' divider
      ctx.save(); ctx.setLineDash([2,4]); ctx.strokeStyle=C.border; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(nowX,padT); ctx.lineTo(nowX,H-padB); ctx.stroke(); ctx.restore();
      ctx.fillStyle=C.faint; ctx.textAlign='center'; ctx.font='9px JetBrains Mono, monospace';
      if(nFut) ctx.fillText('now', nowX, padT-9>6?padT-9:H-padB+12);

      // level lines: entry (accent), SL (down), TP (up)
      function level(p,col,label,alpha){
        var y=cy(p);
        ctx.save(); ctx.setLineDash([6,4]); ctx.strokeStyle=col; ctx.globalAlpha=alpha||0.85; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke(); ctx.restore();
        ctx.fillStyle=col; ctx.globalAlpha=0.95; ctx.textAlign='left'; ctx.font='9px JetBrains Mono, monospace';
        ctx.fillText(label, padL+3, y-6<padT?y+8:y-6); ctx.globalAlpha=1;
      }
      level(L.entry, C.accent, 'Entry '+nf(L.entry), 0.9);
      level(L.stoploss, C.down, 'SL '+nf(L.stoploss), 0.85);
      L.takeProfit.forEach(function(tp,i){ level(tp, C.up, 'TP'+(i+1)+' '+nf(tp), 0.5+i*0.0); });

      // header label: symbol · direction · confidence
      ctx.textAlign='left'; ctx.textBaseline='top';
      ctx.fillStyle=C.strong; ctx.font='600 11px JetBrains Mono, monospace';
      var dirTxt=(D.direction||'hold').toUpperCase();
      ctx.fillText(D.symbol+'  '+dirTxt+'  ·  conf '+Math.round((D.confidence||0)*100)+'%', padL+2, 4);

      // footer disclaimer
      ctx.fillStyle=C.faint; ctx.font='9px JetBrains Mono, monospace'; ctx.textBaseline='bottom';
      ctx.fillText('Illustrative scenario — not financial advice', padL+2, H-4);
    }
    function resize(){
      var r=cv.getBoundingClientRect(); var dpr=window.devicePixelRatio||1;
      var w=r.width||cv.clientWidth||600, h=r.height||cv.clientHeight||360;
      cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0); draw(w,h);
    }
    window.addEventListener('resize',resize);
    resize(); setTimeout(resize,60);
  })();`;

  /* =========================================================
     The IPC surface
     ========================================================= */
  let _watchlist = ["NVDA", "AAPL", "BTC-USD", "TSLA", "SPY", "EURUSD"];
  const valid = (s) => /^[A-Za-z]{1,5}(-USD)?$|^[A-Za-z]{6}$/.test((s || "").trim());

  function lag(min, max) { return min + Math.random() * (max - min); }

  window.ipc.stocks = {
    getWatchlist() {
      return new Promise(res => setTimeout(() => res({ symbols: _watchlist.slice() }), 120));
    },
    setWatchlist(symbols) {
      return new Promise(res => setTimeout(() => {
        _watchlist = (symbols || []).map(s => s.toUpperCase().trim()).filter(Boolean);
        res({ symbols: _watchlist.slice() });
      }, 120));
    },
    quote(symbol) {
      const sym = (symbol || "").toUpperCase().trim();
      return new Promise((res, rej) => setTimeout(() => {
        if (!valid(sym)) { rej(new Error(`Unknown symbol "${symbol}".`)); return; }
        const s = sliceSeries(sym, "3m");
        if (s.length < 2) { rej(new Error("Not enough history for a quote.")); return; }
        const price = s[s.length - 1].close;
        const prev = s[s.length - 2].close;
        const change = round2(price - prev);
        res({ symbol: sym, price, change, changePct: round2((change / prev) * 100), asOf: new Date().toISOString() });
      }, lag(110, 320)));
    },
    history(symbol, range) {
      const sym = (symbol || "").toUpperCase().trim();
      return new Promise((res, rej) => setTimeout(() => {
        if (!valid(sym)) { rej(new Error(`Unknown symbol "${symbol}".`)); return; }
        const bars = sliceSeries(sym, range || "6m");
        if (bars.length < 20) { rej(new Error("Not enough history for this range.")); return; }
        res({ symbol: sym, range: range || "6m", bars });
      }, lag(160, 420)));
    },
    analyze(opts) {
      opts = opts || {};
      const sym = (opts.symbol || "").toUpperCase().trim();
      return new Promise((res, rej) => setTimeout(() => {
        if (!valid(sym)) { rej(new Error(`Unknown symbol "${opts.symbol}". Try a ticker like NVDA or BTC-USD.`)); return; }
        if (window.__simStocksFail) { rej(new Error("Analysis service unreachable. Check your connection.")); return; }
        try { res(buildAnalysis(Object.assign({}, opts, { symbol: sym }))); }
        catch (e) { rej(new Error("Could not analyze " + sym + ": " + e.message)); }
      }, lag(620, 1050)));
    }
  };
})();
