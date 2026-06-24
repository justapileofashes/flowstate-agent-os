/* =========================================================
   Flowstate site — interaction layer
   · scroll reveals (IntersectionObserver)
   · 3D parallax tilt on the hero app window
   · magnetic + tilt motion on buttons
   · self-animating app mock (typing, agent cards, stream)
   · model-bar fills + count-ups when in view
   ========================================================= */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- FlowMark — real app streaming animation (nav + hero) ---------- */
  (function flowmark() {
    const marks = [...document.querySelectorAll("[data-flowmark]")];
    if (!marks.length) return;
    const setups = marks.map((svg) => {
      const bars = [...svg.querySelectorAll("rect")];
      const state = svg.getAttribute("data-flowmark") || "streaming";
      return { bars, base: bars.map((b) => parseFloat(b.getAttribute("data-base"))), state };
    });
    const place = (H, b) => {
      const barH = (H / 100) * 96;
      b.setAttribute("height", barH.toFixed(2));
      b.setAttribute("y", ((100 - barH) / 2).toFixed(2));
    };
    // per-state multipliers, matching the app's FlowMark component
    const mulFor = (state, t, i) =>
      state === "tool" ? 0.85 + 0.20 * Math.sin(t * 1.2 + i)
      : state === "idle" ? 0.92 + 0.08 * Math.sin(t * 0.6 + i * 0.4)
      : 0.70 + 0.45 * Math.sin(t * 2.4 + i * 0.7);   // streaming (default)
    if (reduce) {
      setups.forEach(({ bars, base }) => base.forEach((H, i) => place(H, bars[i])));
      return;
    }
    const start = performance.now();
    function loop(now) {
      const t = (now - start) / 1000;
      for (const { bars, base, state } of setups) {
        for (let i = 0; i < bars.length; i++) {
          place(Math.max(10, Math.min(100, base[i] * mulFor(state, t, i))), bars[i]);
        }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  })();

  /* ---------- nav scrolled state + hide over hero ---------- */
  const nav = document.querySelector(".site-nav");
  const splash = document.querySelector(".splash");
  const onScrollNav = () => {
    if (!nav) return;
    nav.classList.toggle("scrolled", window.scrollY > 24);
    if (splash) {
      // hide the bar while the splash hero still covers the top of the viewport
      const overHero = splash.getBoundingClientRect().bottom > 80;
      nav.classList.toggle("nav-hidden", overHero);
    }
  };
  onScrollNav();
  window.addEventListener("scroll", onScrollNav, { passive: true });

  /* ---------- scroll reveals ---------- */
  const revs = [...document.querySelectorAll(".reveal")];
  const showAll = () => revs.forEach((e) => e.classList.add("in"));
  const inView = (e) => {
    const r = e.getBoundingClientRect();
    return r.top < (window.innerHeight || 800) * 0.92 && r.bottom > 0;
  };
  if (reduce) {
    showAll();
  } else {
    // anything already on screen reveals straight away
    revs.forEach((e) => { if (inView(e)) e.classList.add("in"); });
    try {
      // two-way: fade in on enter, fade out on leave
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          en.target.classList.toggle("in", en.isIntersecting);
        });
      }, { threshold: 0, rootMargin: "-8% 0px -12% 0px" });
      revs.forEach((e) => io.observe(e));
    } catch (err) { showAll(); }
    // safety net: never leave content hidden
    window.addEventListener("load", () => revs.forEach((e) => { if (inView(e)) e.classList.add("in"); }));
    setTimeout(() => revs.forEach((e) => { if (inView(e)) e.classList.add("in"); }), 1400);
  }

  /* ---------- model-bar fills + count-ups ---------- */
  const fillIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const el = en.target;
      if (el.classList.contains("fill")) {
        el.style.width = (el.getAttribute("data-w") || "0") + "%";
      }
      fillIO.unobserve(el);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll(".mbar .fill").forEach((e) => fillIO.observe(e));

  const countIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const el = en.target;
      const target = parseFloat(el.getAttribute("data-count"));
      const suffix = el.getAttribute("data-suffix") || "";
      const dur = 1100;
      const t0 = performance.now();
      const isInt = Number.isInteger(target);
      function step(now) {
        const k = Math.min(1, (now - t0) / dur);
        const e2 = 1 - Math.pow(1 - k, 3);
        const v = target * e2;
        el.textContent = (isInt ? Math.round(v) : v.toFixed(1)) + suffix;
        if (k < 1) requestAnimationFrame(step);
      }
      if (reduce) { el.textContent = (isInt ? target : target.toFixed(1)) + suffix; }
      else requestAnimationFrame(step);
      countIO.unobserve(el);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll("[data-count]").forEach((e) => countIO.observe(e));

  /* ---------- magnetic + tilt buttons ---------- */
  if (!reduce && window.matchMedia("(pointer:fine)").matches) {
    document.querySelectorAll(".btn").forEach((btn) => {
      const strength = btn.classList.contains("btn-lg") ? 0.32 : 0.22;
      btn.addEventListener("mousemove", (e) => {
        const r = btn.getBoundingClientRect();
        const mx = e.clientX - r.left - r.width / 2;
        const my = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${mx * strength}px, ${my * strength}px)`;
      });
      btn.addEventListener("mouseleave", () => { btn.style.transform = ""; });
    });
  }

  /* ---------- 3D parallax tilt on hero app window ---------- */
  const stage = document.querySelector(".appmock-stage");
  const mock = document.querySelector(".appmock");
  if (stage && mock && !reduce) {
    let rx = 0, ry = 0, trx = 0, try_ = 0;
    let scrollTilt = 0;

    // scroll-driven tilt: window starts laid back, rises to flat as it enters
    function onScroll() {
      const r = stage.getBoundingClientRect();
      const vh = window.innerHeight;
      // progress 0 (just appearing at bottom) -> 1 (centred)
      const prog = 1 - Math.max(0, Math.min(1, (r.top) / vh));
      scrollTilt = (1 - prog) * 7;   // up to 7deg laid-back
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    stage.addEventListener("mousemove", (e) => {
      const r = stage.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      try_ = px * 6;
      trx = -py * 5;
    });
    stage.addEventListener("mouseleave", () => { trx = 0; try_ = 0; });

    function tick() {
      rx += (trx - rx) * 0.08;
      ry += (try_ - ry) * 0.08;
      const totalX = rx + scrollTilt;
      mock.style.transform = `rotateX(${totalX.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      requestAnimationFrame(tick);
    }
    tick();
  }

  /* ---------- self-animating app mock ---------- */
  const phEl = document.getElementById("mock-typed");
  if (phEl && !reduce) {
    const prompts = [
      "Refactor the auth flow to refresh-token rotation",
      "Summarize today's standup and post to #eng",
      "Find the race in the Stripe webhook handler",
      "Draft the v2 landing copy — keep it to one screen",
    ];
    let pi = 0;
    function typePrompt() {
      const text = prompts[pi % prompts.length];
      let i = 0;
      phEl.classList.remove("done");
      const typeId = setInterval(() => {
        phEl.firstChild.textContent = text.slice(0, i);
        i++;
        if (i > text.length) {
          clearInterval(typeId);
          setTimeout(() => {
            // erase
            let j = text.length;
            const erId = setInterval(() => {
              phEl.firstChild.textContent = text.slice(0, j);
              j--;
              if (j < 0) { clearInterval(erId); pi++; setTimeout(typePrompt, 420); }
            }, 18);
          }, 2200);
        }
      }, 42);
    }
    // ensure a text node exists before the caret
    if (!phEl.firstChild || phEl.firstChild.nodeType !== 3) {
      phEl.insertBefore(document.createTextNode(""), phEl.firstChild);
    }
    setTimeout(typePrompt, 900);

    // cycle highlighted agent card
    const cards = [...document.querySelectorAll(".am-card")];
    if (cards.length) {
      let ci = 0;
      setInterval(() => {
        cards.forEach((c) => (c.style.transform = ""));
        cards.forEach((c) => (c.style.borderColor = ""));
        cards.forEach((c) => (c.style.background = ""));
        const c = cards[ci % cards.length];
        c.style.transform = "translateY(-2px)";
        c.style.borderColor = "var(--border-strong)";
        c.style.background = "var(--surface-2)";
        ci++;
      }, 1500);
    }
  }

  /* ---------- team-run streaming text ---------- */
  const streams = document.querySelectorAll("[data-stream]");
  if (streams.length && !reduce) {
    const sIO = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        const full = el.getAttribute("data-stream");
        let i = 0;
        el.textContent = "";
        const id = setInterval(() => {
          el.textContent = full.slice(0, i);
          i += 2;
          if (i > full.length) clearInterval(id);
        }, 22);
        sIO.unobserve(el);
      });
    }, { threshold: 0.4 });
    streams.forEach((e) => sIO.observe(e));
  } else {
    streams.forEach((e) => { e.textContent = e.getAttribute("data-stream"); });
  }

  /* ---------- 3D coverflow tour ---------- */
  (function coverflow() {
    const stage = document.getElementById("cf-stage");
    if (!stage) return;
    const cards = [...stage.querySelectorAll(".cf-card")];
    const dotsWrap = document.getElementById("cf-dots");
    const capN = document.querySelector("#cf-caption .cn");
    const capD = document.querySelector("#cf-caption .cd");
    const prev = document.getElementById("cf-prev");
    const next = document.getElementById("cf-next");
    const n = cards.length;
    if (!n) return;
    let cur = 0, auto = null;

    const dots = cards.map((_, i) => {
      const b = document.createElement("button");
      b.className = "cf-dot"; b.setAttribute("role", "tab");
      b.setAttribute("aria-label", "Surface " + (i + 1));
      b.addEventListener("click", () => { go(i); restart(); });
      dotsWrap.appendChild(b);
      return b;
    });

    // windows arranged evenly around a vertical cylinder
    const theta = 360 / n;
    const small = window.matchMedia("(max-width: 720px)").matches;
    // radius so neighbours sit just past the edges of the front card
    const radius = Math.round((small ? 200 : 300) / Math.tan(Math.PI / n)) ;
    let spin = 0; // continuous accumulated angle (deg) — lets it keep revolving

    function render() {
      // rotate the whole ring so the current card faces front
      stage.style.transform = `translateZ(${-radius}px) rotateY(${spin}deg)`;
      cards.forEach((card, i) => {
        // shortest signed distance from the front position
        let off = i - cur;
        if (off > n / 2) off -= n;
        if (off < -n / 2) off += n;
        const a = Math.abs(off);
        // pin each card to its seat on the cylinder, facing outward
        card.style.transform = `rotateY(${i * theta}deg) translateZ(${radius}px)`;
        card.style.opacity = a > 2.4 ? "0.18" : (a === 0 ? "1" : "0.7");
        card.style.zIndex = String(100 - a);
        card.style.pointerEvents = a > 2.4 ? "none" : "auto";
        card.classList.toggle("active", i === cur);
      });
      dots.forEach((d, i) => d.classList.toggle("on", i === cur));
      const c = cards[cur];
      if (capN) capN.textContent = c.dataset.name || "";
      if (capD) capD.textContent = c.dataset.desc || "";
    }
    function go(i) {
      i = (i % n + n) % n;
      // step the ring the short way so it always revolves continuously
      let step = i - cur;
      if (step > n / 2) step -= n;
      if (step < -n / 2) step += n;
      cur = i;
      spin -= step * theta;
      render();
    }
    const nextS = () => go(cur + 1);
    const prevS = () => go(cur - 1);

    cards.forEach((card, i) => card.addEventListener("click", () => {
      if (i !== cur) { go(i); restart(); }
    }));
    if (next) next.addEventListener("click", () => { nextS(); restart(); });
    if (prev) prev.addEventListener("click", () => { prevS(); restart(); });

    // drag / swipe
    let down = false, sx = 0, moved = false;
    const onDown = (x) => { down = true; sx = x; moved = false; stopAuto(); };
    const onMove = (x) => {
      if (!down) return;
      const dx = x - sx;
      if (Math.abs(dx) > 56) { dx < 0 ? nextS() : prevS(); sx = x; moved = true; }
    };
    const onUp = () => { down = false; if (moved) restart(); };
    stage.addEventListener("pointerdown", (e) => onDown(e.clientX));
    window.addEventListener("pointermove", (e) => onMove(e.clientX));
    window.addEventListener("pointerup", onUp);

    // keyboard when the carousel is in view
    window.addEventListener("keydown", (e) => {
      const r = stage.getBoundingClientRect();
      if (r.bottom < 0 || r.top > (window.innerHeight || 800)) return;
      if (e.key === "ArrowRight") { nextS(); restart(); }
      else if (e.key === "ArrowLeft") { prevS(); restart(); }
    });

    function stopAuto() { if (auto) { clearInterval(auto); auto = null; } }
    function startAuto() { if (!reduce && !auto) auto = setInterval(nextS, 4200); }
    function restart() { stopAuto(); startAuto(); }
    const cf = document.getElementById("cf3d");
    if (cf) {
      cf.addEventListener("mouseenter", stopAuto);
      cf.addEventListener("mouseleave", startAuto);
    }

    // only auto-advance while on screen
    try {
      const io = new IntersectionObserver((ents) => {
        ents.forEach((en) => { en.isIntersecting ? startAuto() : stopAuto(); });
      }, { threshold: 0.25 });
      if (cf) io.observe(cf);
    } catch (e) { startAuto(); }

    render();
  })();

  /* ---------- smooth anchor scroll w/ offset ---------- */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (id.length < 2) return;
      const t = document.querySelector(id);
      if (!t) return;
      e.preventDefault();
      const y = t.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
    });
  });
})();
