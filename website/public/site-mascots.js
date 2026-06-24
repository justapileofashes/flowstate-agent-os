/* =========================================================
   Flowstate site — vanilla pixel-mascot renderer.
   A compact port of the app's PixelMascot: a 24x24 chunky
   creature with a group hat, breathing + blinking idle.
   Renders to a <canvas data-mascot="Group">.
   ========================================================= */
(function () {
  const PX = {
    o: "#0e0d0c",  // outline
    b: "#e8e3d5",  // body (platinum bone)
    s: "#c8c2b3",  // shadow
    h: "#f0ece2",  // highlight
    m: "#a08278",  // clay
    d: "#5c574f",  // ink-faint
  };

  // ---- group hats (anchored y=0..4 over the body top) -------------------
  const OUTFITS = {
    Code: [
      [11,1,"o"],[12,1,"o"],
      [10,2,"o"],[11,2,"d"],[12,2,"d"],[13,2,"o"],
      [9,3,"o"],[10,3,"d"],[11,3,"d"],[12,3,"d"],[13,3,"d"],[14,3,"o"],
      [8,4,"o"],[9,4,"d"],[14,4,"d"],[15,4,"o"]
    ],
    Stack: [
      [10,2,"o"],[11,2,"o"],[12,2,"o"],[13,2,"o"],
      [8,3,"o"],[9,3,"o"],[14,3,"o"],[15,3,"o"],
      [8,4,"d"],[9,4,"d"],[14,4,"d"],[15,4,"d"]
    ],
    Knowledge: [
      [7,1,"o"],[8,1,"o"],[9,1,"o"],[10,1,"o"],[11,1,"o"],
      [12,1,"o"],[13,1,"o"],[14,1,"o"],[15,1,"o"],[16,1,"o"],
      [10,2,"o"],[11,2,"d"],[12,2,"d"],[13,2,"o"],
      [10,3,"o"],[13,3,"o"],
      [17,2,"b"],[17,3,"b"],[17,4,"b"]
    ],
    Design: [
      [13,1,"o"],
      [9,2,"o"],[10,2,"m"],[11,2,"m"],[12,2,"m"],[13,2,"m"],[14,2,"o"],
      [10,3,"m"],[11,3,"m"],[12,3,"m"],[13,3,"m"],
      [11,4,"o"],[12,4,"o"]
    ],
    Automation: [
      [11,0,"b"],[12,0,"o"],
      [11,1,"o"],
      [11,2,"o"],[12,2,"o"],
      [10,3,"o"],[11,3,"d"],[12,3,"d"],[13,3,"o"],
      [10,4,"o"],[11,4,"d"],[12,4,"d"],[13,4,"o"]
    ],
    Ops: [
      [10,1,"o"],[11,1,"o"],[12,1,"o"],[13,1,"o"],
      [9,2,"o"],[10,2,"d"],[11,2,"d"],[12,2,"d"],[13,2,"d"],[14,2,"o"],
      [8,3,"o"],[9,3,"d"],[10,3,"d"],[11,3,"d"],[12,3,"d"],[13,3,"d"],[14,3,"d"],[15,3,"o"],
      [8,4,"o"],[15,4,"o"]
    ],
    Build: [
      [10,2,"o"],[11,2,"o"],[12,2,"o"],[13,2,"o"],
      [9,3,"o"],[10,3,"b"],[11,3,"b"],[12,3,"b"],[13,3,"b"],[14,3,"o"],
      [9,4,"o"],[10,4,"b"],[11,4,"b"],[12,4,"b"],[13,4,"b"],[14,4,"b"],[15,4,"b"],[16,4,"o"]
    ],
    Other: [
      [11,1,"d"],[12,1,"d"],
      [10,2,"o"],[11,2,"b"],[12,2,"b"],[13,2,"o"],
      [9,3,"o"],[10,3,"b"],[11,3,"b"],[12,3,"b"],[13,3,"b"],[14,3,"o"],
      [8,4,"o"],[9,4,"o"],[10,4,"o"],[11,4,"o"],[12,4,"o"],[13,4,"o"],[14,4,"o"],[15,4,"o"]
    ],
    Default: []
  };

  // ---- creature body (idle, with bob + blink) ---------------------------
  function drawCreature(bob, blink, look, squashH) {
    const px = [];
    const oy = (y) => y + bob;
    const bodyTop = 5, bodyBot = 13;
    const bodyLeft = 7 - squashH, bodyRight = 16 + squashH;

    for (let x = bodyLeft; x <= bodyRight; x++) { px.push([x, oy(bodyTop), "o"]); px.push([x, oy(bodyBot), "o"]); }
    for (let y = bodyTop; y <= bodyBot; y++) { px.push([bodyLeft, oy(y), "o"]); px.push([bodyRight, oy(y), "o"]); }
    for (let y = bodyTop + 1; y <= bodyBot - 1; y++)
      for (let x = bodyLeft + 1; x <= bodyRight - 1; x++) px.push([x, oy(y), "b"]);
    for (let y = bodyTop + 1; y <= bodyBot - 1; y++) px.push([bodyRight - 1, oy(y), "s"]);

    // eyes
    const eyeY = 8;
    const lx0 = 9 + (look < 0 ? -1 : 0);
    const rx0 = 13 + (look > 0 ? 1 : 0);
    if (blink) {
      px.push([lx0, oy(eyeY + 1), "o"]); px.push([lx0 + 1, oy(eyeY + 1), "o"]);
      px.push([rx0, oy(eyeY + 1), "o"]); px.push([rx0 + 1, oy(eyeY + 1), "o"]);
    } else {
      px.push([lx0, oy(eyeY), "o"]); px.push([lx0 + 1, oy(eyeY), "o"]);
      px.push([lx0, oy(eyeY + 1), "o"]); px.push([lx0 + 1, oy(eyeY + 1), "o"]);
      px.push([rx0, oy(eyeY), "o"]); px.push([rx0 + 1, oy(eyeY), "o"]);
      px.push([rx0, oy(eyeY + 1), "o"]); px.push([rx0 + 1, oy(eyeY + 1), "o"]);
    }
    // legs
    [8, 10, 13, 15].forEach((lx) => {
      const startY = oy(bodyBot + 1);
      for (let s = 0; s < 3; s++) px.push([lx, startY + s, "s"]);
    });
    return px;
  }

  function compose(...layers) {
    const map = new Map();
    for (const layer of layers) for (const [x, y, c] of layer) {
      if (x < 0 || y < 0 || x >= 24 || y >= 24) continue;
      map.set(x + "," + y, [x, y, c]);
    }
    return [...map.values()];
  }

  function init() {
    const list = [...document.querySelectorAll("canvas[data-mascot]")];
    const fps = 6;

    list.forEach((canvas, i) => {
      const group = canvas.getAttribute("data-mascot") || "Default";
      const facing = canvas.getAttribute("data-facing") === "-1" ? -1 : 1;
      const size = canvas.width;
      const scale = size / 24;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      const hat = OUTFITS[group] || OUTFITS.Default;
      let f = i * 5;            // per-mascot frame offset so they feel alive
      function loop() {
        const p = f % 24;
        const bob = (p > 4 && p < 12) ? -1 : 0;
        const squashH = (p > 8 && p < 11) ? 1 : 0;
        let look = 0;
        if (p > 18) look = (f % 96 < 48) ? -1 : 1;
        const blink = f % 26 === 25;
        const shiftHat = bob === 0 ? hat : hat.map(([x, y, c]) => [x, y + bob, c]);
        const pixels = compose(drawCreature(bob, blink, look, squashH), shiftHat);
        ctx.clearRect(0, 0, size, size);
        ctx.save();
        if (facing === -1) { ctx.translate(size, 0); ctx.scale(-1, 1); }
        for (const [x, y, c] of pixels) {
          ctx.fillStyle = PX[c];
          ctx.fillRect(Math.round(x * scale), Math.round(y * scale), Math.ceil(scale), Math.ceil(scale));
        }
        ctx.restore();
        f++;
      }
      loop();
      setInterval(loop, 1000 / fps);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
