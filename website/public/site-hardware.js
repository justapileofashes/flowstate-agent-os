/* =========================================================
   Flowstate site — live local-model recommender.
   Reads what the browser will expose about the visitor's
   machine (GPU via WebGL/WebGPU, RAM, CPU cores, OS),
   estimates a usable memory budget, scores a catalog of
   real Ollama models by fit, and renders the top picks.
   Everything runs client-side; nothing is sent anywhere.
   ========================================================= */
(function () {
  "use strict";

  /* ---------- model catalog (real Ollama models) ----------
     gb   = approx VRAM/RAM to run Q4_K_M at a usable context
     q    = quality score (0..100, rough community consensus)
     spd  = inverse-size speed proxy (0..100)
     tags = which "slot" it can win                              */
  const CATALOG = [
    { name: "qwen2.5:0.5b",        gb: 0.6,  q: 30, spd: 100, slots: ["fast"] },
    { name: "llama3.2:1b",         gb: 1.3,  q: 38, spd: 99,  slots: ["fast"] },
    { name: "llama3.2:3b",         gb: 2.4,  q: 50, spd: 95,  slots: ["fast", "overall"] },
    { name: "phi4-mini:3.8b",      gb: 2.8,  q: 56, spd: 93,  slots: ["fast", "overall"] },
    { name: "qwen2.5:7b",          gb: 4.7,  q: 64, spd: 88,  slots: ["overall", "fast"] },
    { name: "llama3.1:8b",         gb: 4.9,  q: 66, spd: 86,  slots: ["overall", "fast"] },
    { name: "qwen2.5-coder:7b",    gb: 4.7,  q: 70, spd: 87,  slots: ["code", "fast"] },
    { name: "deepseek-r1:8b",      gb: 5.2,  q: 72, spd: 82,  slots: ["overall", "code"] },
    { name: "gemma2:9b",           gb: 5.8,  q: 69, spd: 80,  slots: ["overall"] },
    { name: "mistral-nemo:12b",    gb: 7.6,  q: 72, spd: 72,  slots: ["overall"] },
    { name: "qwen2.5:14b",         gb: 9.0,  q: 77, spd: 66,  slots: ["overall"] },
    { name: "qwen2.5-coder:14b",   gb: 9.0,  q: 82, spd: 65,  slots: ["code"] },
    { name: "phi4:14b",            gb: 9.1,  q: 79, spd: 64,  slots: ["overall"] },
    { name: "deepseek-r1:14b",     gb: 9.0,  q: 80, spd: 62,  slots: ["overall", "code"] },
    { name: "gemma2:27b",          gb: 16.0, q: 82, spd: 50,  slots: ["overall"] },
    { name: "qwen2.5:32b",         gb: 20.0, q: 86, spd: 44,  slots: ["overall"] },
    { name: "qwen2.5-coder:32b",   gb: 19.5, q: 90, spd: 43,  slots: ["code"] },
    { name: "deepseek-r1:32b",     gb: 20.0, q: 88, spd: 41,  slots: ["overall", "code"] },
    { name: "llama3.3:70b",        gb: 43.0, q: 92, spd: 24,  slots: ["overall"] },
    { name: "qwen2.5:72b",         gb: 47.0, q: 93, spd: 22,  slots: ["overall"] },
  ];

  /* ---------- GPU VRAM heuristics from renderer string ---------- */
  const GPU_VRAM = [
    [/rtx\s*50?90/i, 32], [/rtx\s*4090/i, 24], [/rtx\s*4080/i, 16], [/rtx\s*4070\s*ti/i, 12],
    [/rtx\s*4070/i, 12], [/rtx\s*4060\s*ti/i, 16], [/rtx\s*4060/i, 8],
    [/rtx\s*3090/i, 24], [/rtx\s*3080\s*ti/i, 12], [/rtx\s*3080/i, 10], [/rtx\s*3070/i, 8],
    [/rtx\s*3060\s*ti/i, 8], [/rtx\s*3060/i, 12], [/rtx\s*3050/i, 8],
    [/rtx\s*20\d0/i, 8], [/gtx\s*1080/i, 8], [/gtx\s*1070/i, 8], [/gtx\s*1060/i, 6], [/gtx\s*16\d0/i, 6],
    [/a100/i, 80], [/h100/i, 80], [/a6000/i, 48], [/a40/i, 48], [/l40/i, 48], [/v100/i, 32],
    [/rx\s*7900\s*xtx?/i, 24], [/rx\s*7900/i, 20], [/rx\s*7800/i, 16], [/rx\s*7700/i, 12],
    [/rx\s*6900/i, 16], [/rx\s*6800/i, 16], [/rx\s*6700/i, 12], [/rx\s*6600/i, 8],
    [/arc\s*a770/i, 16], [/arc\s*a750/i, 8], [/arc\s*b580/i, 12],
  ];

  function detectGPUName() {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (!gl) return null;
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        const r = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        if (r) return String(r);
      }
      const r2 = gl.getParameter(gl.RENDERER);
      return r2 ? String(r2) : null;
    } catch (e) { return null; }
  }

  function prettyGPU(raw) {
    if (!raw) return null;
    // pull the human-recognisable chunk out of e.g.
    // "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)"
    let s = raw;
    const ang = s.match(/ANGLE\s*\(([^)]*)\)/i);
    if (ang) s = ang[1];
    s = s.replace(/Direct3D\d+.*$/i, "")
         .replace(/\b(vs|ps)_\d+_\d+\b/gi, "")
         .replace(/\bOpenGL.*$/i, "")
         .replace(/\bMetal.*$/i, "")
         .replace(/\(0x[0-9a-f]+\)/gi, "")
         .replace(/\(0x[0-9a-f]+.*$/gi, "")
         .replace(/\b0x[0-9a-f]+\b/gi, "")
         .replace(/,?\s*(D3D11|D3D12|Vulkan)\b/gi, "");
    // drop duplicate vendor prefix "NVIDIA, NVIDIA GeForce..."
    const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
    let best = parts.sort((a, b) => b.length - a.length)[0] || s;
    best = best.replace(/\(0x[0-9a-f].*$/i, "").replace(/\s{2,}/g, " ").trim();
    // Apple GPUs
    const apple = raw.match(/Apple\s*(M\d[\w\s]*?GPU|GPU)/i);
    if (apple) return "Apple " + (raw.match(/M\d[\w\s]*/i) || ["Silicon"])[0].trim();
    return best.length > 40 ? best.slice(0, 40) + "…" : best;
  }

  function classifyGPU(name) {
    if (!name) return { kind: "unknown", vram: 0 };
    if (/apple/i.test(name)) return { kind: "apple", vram: 0 };          // unified memory
    if (/(nvidia|geforce|rtx|gtx|quadro|tesla|a100|h100|a6000)/i.test(name)) {
      for (const [re, v] of GPU_VRAM) if (re.test(name)) return { kind: "nvidia", vram: v };
      return { kind: "nvidia", vram: 8 };
    }
    if (/(radeon|\brx\b|amd|firepro)/i.test(name)) {
      for (const [re, v] of GPU_VRAM) if (re.test(name)) return { kind: "amd", vram: v };
      return { kind: "amd", vram: 8 };
    }
    if (/(intel|arc|iris|uhd|hd graphics)/i.test(name)) {
      for (const [re, v] of GPU_VRAM) if (re.test(name)) return { kind: "intel-arc", vram: v };
      return { kind: "intel-igpu", vram: 0 };                            // shares RAM
    }
    return { kind: "unknown", vram: 0 };
  }

  async function detectWebGPU() {
    try {
      if (!navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
      let maxBuf = 0;
      try { maxBuf = adapter.limits && adapter.limits.maxBufferSize ? adapter.limits.maxBufferSize : 0; } catch (e) {}
      return { vendor: info && (info.vendor || ""), arch: info && (info.architecture || ""),
               desc: info && (info.description || ""), maxBufferGB: maxBuf ? maxBuf / 1073741824 : 0 };
    } catch (e) { return null; }
  }

  function detectOS() {
    const ua = navigator.userAgent || "";
    const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/Mac|iPhone|iPad/i.test(ua + p)) return "macOS";
    if (/Win/i.test(ua + p)) return "Windows";
    if (/Linux|X11/i.test(ua + p)) return "Linux";
    return "your OS";
  }

  function fmtGB(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + " TB";
    return (Math.round(n * 10) / 10) + " GB";
  }

  function setText(id, txt) { const e = document.getElementById(id); if (e) e.textContent = txt; }

  function fit(model, budget) {
    const ratio = model.gb / budget;
    if (ratio <= 0.7) return { tag: "excellent", cls: "fit-excellent" };
    if (ratio <= 0.92) return { tag: "good", cls: "fit-good" };
    return { tag: "tight", cls: "fit-tight" };
  }

  function pickBest(slot, budget) {
    // fits within budget (allow up to 1.0), prefers highest quality, then speed
    const fits = CATALOG.filter((m) => m.slots.includes(slot) && m.gb <= budget * 1.0);
    if (!fits.length) {
      // nothing fits — return the smallest in that slot as a "tight" suggestion
      const all = CATALOG.filter((m) => m.slots.includes(slot)).sort((a, b) => a.gb - b.gb);
      return all[0] || null;
    }
    if (slot === "fast") {
      // fastest that's still genuinely useful: keep a quality floor, then take the
      // highest quality among the snappiest tier so we never suggest a toy 0.5b.
      const floor = fits.filter((m) => m.q >= 60);
      const pool = floor.length ? floor : fits;
      pool.sort((a, b) => (b.spd - a.spd) || (b.q - a.q));
      // among the top few fastest, prefer the best quality
      const topSpd = pool[0].spd;
      const near = pool.filter((m) => m.spd >= topSpd - 6);
      near.sort((a, b) => (b.q - a.q) || (b.spd - a.spd));
      return near[0];
    }
    fits.sort((a, b) => (b.q - a.q) || (b.spd - a.spd));
    return fits[0];
  }

  function renderReccos(budget) {
    const wrap = document.getElementById("reccos");
    if (!wrap) return;
    const slots = [
      { key: "overall", label: "Best overall" },
      { key: "code",    label: "Best for code" },
      { key: "fast",    label: "Fastest" },
    ];
    const seen = new Set();
    const html = slots.map(({ key, label }) => {
      let m = pickBest(key, budget);
      // avoid showing the identical model in two cards where possible
      if (m && seen.has(m.name)) {
        const alt = CATALOG.filter((x) => x.slots.includes(key) && x.gb <= budget && !seen.has(x.name));
        if (alt.length) { alt.sort((a, b) => (key === "fast" ? b.spd - a.spd : b.q - a.q)); m = alt[0]; }
      }
      if (!m) return "";
      seen.add(m.name);
      const f = fit(m, budget);
      const spd = Math.round(m.spd);
      const ql = Math.round(m.q);
      return (
        '<div class="recco">' +
          '<div class="slot">' + label + '</div>' +
          '<div class="mn">' + m.name + '</div>' +
          '<div class="sz">' + fmtGB(m.gb) + ' · <span class="fit-tag ' + f.cls + '">fit ' + f.tag + '</span></div>' +
          '<div class="mbar"><span class="lab">speed</span><span class="bar"><span class="fill" data-w="' + spd + '"></span></span></div>' +
          '<div class="mbar"><span class="lab">quality</span><span class="bar"><span class="fill" data-w="' + ql + '"></span></span></div>' +
        '</div>'
      );
    }).join("");
    wrap.innerHTML = html;
    // animate the new bars in
    requestAnimationFrame(() => {
      wrap.querySelectorAll(".mbar .fill").forEach((el) => {
        el.style.width = (el.getAttribute("data-w") || "0") + "%";
      });
    });
  }

  async function run() {
    const bar = document.getElementById("hwbar");
    const gpuRaw = detectGPUName();
    const gpuName = prettyGPU(gpuRaw);
    const cls = classifyGPU(gpuName || gpuRaw);
    const wgpu = await detectWebGPU();

    const cores = navigator.hardwareConcurrency || null;
    const ramGb = navigator.deviceMemory || null;   // Chrome-only, capped at 8 on many devices
    const os = detectOS();

    setText("hw-thisdevice", "this " + (os === "your OS" ? "device" : os + " device"));

    /* ---- GPU cell ---- */
    if (cls.kind === "apple") {
      setText("hw-gpu", gpuName || "Apple Silicon");
      setText("hw-gpu-sub", "unified memory");
    } else if (gpuName) {
      setText("hw-gpu", gpuName);
      setText("hw-gpu-sub", cls.vram ? "~" + cls.vram + " GB VRAM" : (wgpu && wgpu.vendor ? wgpu.vendor : "integrated"));
    } else if (wgpu && (wgpu.desc || wgpu.vendor)) {
      setText("hw-gpu", (wgpu.desc || wgpu.vendor) || "GPU");
      setText("hw-gpu-sub", "via WebGPU");
    } else {
      setText("hw-gpu", "Not exposed");
      setText("hw-gpu-sub", "browser hid it");
    }

    /* ---- CPU cell ---- */
    if (cores) { setText("hw-cpu", cores + " cores"); setText("hw-cpu-sub", "logical / threads"); }
    else { setText("hw-cpu", "Not exposed"); setText("hw-cpu-sub", "—"); }

    /* ---- Memory cell ---- */
    let ramLabel, ramApprox = false;
    if (ramGb) {
      // deviceMemory caps at 8 for privacy; treat 8 as "8 GB or more"
      ramLabel = ramGb >= 8 ? "8 GB+" : ramGb + " GB";
      ramApprox = ramGb >= 8;
    } else {
      ramLabel = "Not exposed";
    }
    setText("hw-mem", ramLabel);
    setText("hw-mem-sub", ramGb ? (ramApprox ? "reported minimum" : "system RAM") : "browser hid it");

    /* ---- compute a model memory budget (GB) ---- */
    let budget, basis;
    if (cls.vram >= 1) {
      budget = cls.vram;                         // dedicated GPU → its VRAM
      basis = "dedicated VRAM";
    } else if (cls.kind === "apple") {
      // Apple unified memory: estimate from RAM; ~70% usable for GPU.
      const guessRam = ramGb && ramGb < 8 ? ramGb : 16;   // most Apple silicon ships 16GB+
      budget = Math.max(5, Math.round(guessRam * 0.7));
      basis = "unified memory (est.)";
    } else if (ramGb) {
      const guessRam = ramGb >= 8 ? 16 : ramGb;   // assume ≥16GB if capped report
      budget = Math.max(3, Math.round(guessRam * 0.6));
      basis = "system RAM (est.)";
    } else {
      budget = 8;                                 // safe default
      basis = "assumed 8 GB";
    }

    setText("hw-budget", "~" + fmtGB(budget));
    setText("hw-budget-sub", basis);

    if (bar) bar.setAttribute("data-state", "done");

    /* ---- note line ---- */
    const note = document.getElementById("hw-note");
    if (note) {
      const bits = [];
      if (!gpuName && !(wgpu && wgpu.desc)) bits.push("your browser hides the GPU model");
      if (!ramGb) bits.push("RAM isn't exposed here");
      if (cls.vram >= 1) {
        note.innerHTML = "Recommendations sized to your <b>~" + cls.vram + " GB</b> of VRAM. In the app, Flowstate reads exact VRAM and free disk directly.";
      } else if (bits.length) {
        note.innerHTML = "Browsers limit hardware detection (" + bits.join(", ") + "), so this is an estimate. The Flowstate desktop app reads your real VRAM, RAM and disk.";
      } else {
        note.innerHTML = "Estimated from your browser — the Flowstate desktop app measures exact VRAM, RAM and free disk for precise picks.";
      }
    }

    renderReccos(budget);
  }

  // run when the models section is first scrolled near (keeps the reveal feeling live)
  const target = document.getElementById("models");
  if (!target) return;
  let started = false;
  const kick = () => { if (started) return; started = true; setTimeout(run, 350); };
  try {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { kick(); io.disconnect(); } });
    }, { threshold: 0.15 });
    io.observe(target);
  } catch (e) { kick(); }
  // safety: also run on load if already in view
  window.addEventListener("load", () => {
    const r = target.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) kick();
  });
})();
