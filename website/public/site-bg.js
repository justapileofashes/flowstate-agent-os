/* =========================================================
   Flowstate site — reactive waveform field background.
   A grid of vertical "equalizer" bars that breathe with
   travelling sine waves and lift toward the cursor — an
   echo of the brand's 9-bar waveform mark.
   ========================================================= */
(function () {
  const canvas = document.getElementById("bg-field");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, DPR = 1;
  let cols = 0, rows = 0;
  const SPACING_X = 46;        // px between bar columns
  const SPACING_Y = 74;        // px between bar rows (taller so bars never overlap)
  const BAR_W = 3;             // bar thickness
  const MAX_H = SPACING_Y - 14; // hard cap so a bar never reaches its neighbour row
  let bars = [];               // {x, y, base phase}

  // pointer (smoothed) in CSS px
  const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
  // scroll influence
  let scrollY = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildGrid();
  }

  function buildGrid() {
    cols = Math.ceil(W / SPACING_X) + 1;
    rows = Math.ceil(H / SPACING_Y) + 1;
    bars = [];
    const offX = (W - (cols - 1) * SPACING_X) / 2;
    const offY = (H - (rows - 1) * SPACING_Y) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = offX + c * SPACING_X;
        const y = offY + r * SPACING_Y;
        bars.push({ x, y, ph: (c * 0.55 + r * 0.32) });
      }
    }
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("mousemove", (e) => {
    mouse.tx = e.clientX; mouse.ty = e.clientY; mouse.active = true;
  }, { passive: true });
  window.addEventListener("mouseleave", () => { mouse.active = false; });
  window.addEventListener("scroll", () => { scrollY = window.scrollY || 0; }, { passive: true });

  // touch: gentle follow
  window.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches[0]) {
      mouse.tx = e.touches[0].clientX; mouse.ty = e.touches[0].clientY; mouse.active = true;
    }
  }, { passive: true });

  const INK = [240, 236, 226];
  const ACC = [232, 227, 213];

  let t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    // ease pointer toward target
    if (mouse.tx < -9000) { mouse.active = false; }
    mouse.x += (mouse.tx - mouse.x) * 0.12;
    mouse.y += (mouse.ty - mouse.y) * 0.12;

    ctx.clearRect(0, 0, W, H);

    const R = 230;             // pointer influence radius
    const R2 = R * R;
    const scrollPhase = scrollY * 0.0016;

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      // travelling waves across the field + slow scroll drift
      const wave =
        Math.sin(b.x * 0.010 + t * 0.9 + b.ph) * 0.5 +
        Math.sin(b.y * 0.012 - t * 0.6 + scrollPhase) * 0.5;
      let amp = 6 + (wave * 0.5 + 0.5) * 12;   // base 6..18px
      let glow = 0;

      // pointer lift
      if (mouse.active) {
        const dx = b.x - mouse.x;
        const dy = b.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const f = 1 - Math.sqrt(d2) / R;       // 0..1
          const ff = f * f;
          amp += ff * 36;
          glow = ff;
        }
      }

      const h = Math.min(amp, MAX_H);            // never tall enough to touch a neighbour row
      const baseAlpha = 0.05 + (wave * 0.5 + 0.5) * 0.06;
      const alpha = Math.min(0.7, baseAlpha + glow * 0.55);

      // colour: lean platinum when lit by cursor
      const col = glow > 0.04 ? ACC : INK;
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;

      const x = b.x - BAR_W / 2;
      const y = b.y - h / 2;
      // rounded bar
      const r = BAR_W / 2;
      ctx.beginPath();
      ctx.moveTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.arcTo(x + BAR_W, y, x + BAR_W, y + r, r);
      ctx.lineTo(x + BAR_W, y + h - r);
      ctx.arcTo(x + BAR_W, y + h, x + r, y + h, r);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.closePath();
      ctx.fill();

      // node dot for lit bars
      if (glow > 0.25) {
        ctx.fillStyle = `rgba(${ACC[0]},${ACC[1]},${ACC[2]},${glow * 0.6})`;
        ctx.fillRect(b.x - 0.75, b.y - 0.75, 1.5, 1.5);
      }
    }

    if (!reduce) requestAnimationFrame(frame);
  }

  resize();
  if (reduce) {
    // one static frame
    requestAnimationFrame(frame);
  } else {
    requestAnimationFrame(frame);
  }
})();
