'use strict';

// Windblown petals with the vermilion / ivory palette of the supplied reference.
(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const palette = ['#8b211d', '#b82c20', '#d9412c', '#e65a3d', '#eee9dd', '#fff4df', '#d6c8a5'];
  const random = (min, max) => min + Math.random() * (max - min);
  const scenes = [];

  document.querySelectorAll('.hero, .stats-band, #overview, #method, #results, .footer').forEach(section => {
    const canvas = document.createElement('canvas');
    canvas.className = 'petal-background';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    section.classList.add('petal-scene');
    section.prepend(canvas);
    const kind = section.classList.contains('hero') ? 'hero' : section.id || 'footer';
    const scene = { section, canvas, ctx, kind, width: 0, height: 0, petals: [], flowers: [], loose: [], time: 0, mouseX: 0, mouseY: 0, visible: false };
    if (kind === 'hero') {
      section.addEventListener('pointermove', event => {
        const rect = section.getBoundingClientRect();
        scene.mouseX = (event.clientX - rect.left) / rect.width - 0.5;
        scene.mouseY = (event.clientY - rect.top) / rect.height - 0.5;
      });
      section.addEventListener('pointerleave', () => { scene.mouseX = scene.mouseY = 0; });
    }
    scenes.push(scene);
  });

  function sizeScene(scene) {
    const rect = scene.section.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (scene.width === width && scene.height === height && scene.left === rect.left && scene.dpr === dpr) return;
    scene.width = width;
    scene.height = height;
    scene.left = rect.left;
    scene.dpr = dpr;
    // Extend beyond the content wrapper so both page margins receive petals too.
    scene.canvas.style.width = `${width}px`;
    scene.canvas.style.left = `${-rect.left}px`;
    scene.canvas.width = Math.round(width * dpr);
    scene.canvas.height = Math.round(height * dpr);
    scene.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Start with even coverage; the shared wind then bends the trajectories.
    const columns = Math.ceil(width / 135);
    const rows = Math.ceil(height / 135);
    scene.petals = [];
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows; row++) {
        const depth = random(0.35, 1);
        scene.petals.push({
          x: (column + random(0.2, 0.8)) / columns,
          y: (row + random(0.2, 0.8)) / rows,
          size: (width < 720 ? 6 : 8) + depth * (width < 720 ? 13 : 21),
          depth, fall: random(12, 25), vx: random(-15, 0), vy: random(8, 20),
          angle: random(0, Math.PI * 2), spin: random(-0.8, 0.8),
          phase: random(0, Math.PI * 2), flutter: random(0.7, 1.6),
          fold: random(0, Math.PI * 2), shape: Math.floor(random(1, 4)),
          color: palette[Math.floor(Math.random() * palette.length)], alpha: 0.16 + depth * 0.34
        });
      }
    }
    if (scene.kind === 'hero') {
      layoutFlowers(scene, rect);
      scene.loose = [];
    }
    drawScene(scene, 0);
  }

  function layoutFlowers(scene, rect) {
    const mobile = scene.width < 720;
    const colors = [['#a52b23', '#dc4935'], ['#d95a44', '#ef8d70'], ['#ded5bf', '#fff4df']];
    const protectedAreas = [...scene.section.querySelectorAll('.hero-copy, .hero-foot, .visual-top, .visual-bottom, .network-status, .orbit-label')]
      .map(element => element.getBoundingClientRect());
    const network = scene.section.querySelector('#network').getBoundingClientRect();
    scene.flowers = [];
    // Smaller flowers, generous gaps, and three loose groups rather than a
    // dense strip. Keep the reference's warm palette and stemless blooms.
    const anchors = mobile ? [0.12, 0.52, 0.88] : [0.59, 0.77, 0.95];
    for (let attempt = 0; attempt < 240 && scene.flowers.length < (mobile ? 8 : 16); attempt++) {
      const group = attempt % anchors.length;
      if (scene.flowers.filter(flower => flower.group === group).length >= (mobile ? 3 : 6)) continue;
      const radius = random(mobile ? 8 : 10, mobile ? 14 : 20);
      const x = (anchors[group] + random(-0.055, 0.055)) * scene.width;
      const y = random(mobile ? 0.66 : 0.50, 0.94) * scene.height;
      if (x - radius < 8 || x + radius > scene.width - 8) continue;
      if (protectedAreas.some(area => x + radius + 12 > area.left && x - radius - 12 < area.right &&
        y + rect.top + radius + 12 > area.top && y + rect.top - radius - 12 < area.bottom)) continue;
      // Frame the existing attention sphere instead of covering its nodes.
      if (Math.hypot((x - network.left - network.width * 0.5) / (network.width * 0.39 + radius),
        (y + rect.top - network.top - network.height * 0.46) / (network.height * 0.36 + radius)) < 1) continue;
      if (scene.flowers.some(flower => Math.hypot(x - flower.x * scene.width, y - flower.y * scene.height) < radius + flower.radius + 14)) continue;
      const pair = colors[group % colors.length];
      scene.flowers.push({
        x: x / scene.width, y: y / scene.height, radius, group,
        petals: Math.floor(random(7, 10)), angle: random(0, Math.PI * 2),
        color: pair[0], color2: pair[1],
        start: random(0, 2.5), nextEject: scene.time + random(1, 3), phase: random(0, Math.PI * 2)
      });
    }
  }

  function drawPetal(ctx, size, color, alpha, shape = 0) {
    ctx.globalAlpha = alpha;
    if (shape) {
      const shading = ctx.createLinearGradient(-size * 0.5, 0, size * 0.5, size);
      shading.addColorStop(0, color);
      shading.addColorStop(0.6, color);
      shading.addColorStop(1, '#2a1412');
      ctx.fillStyle = shading;
    } else ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    if (shape === 1) {
      // An asymmetric, cupped rose petal.
      ctx.bezierCurveTo(size * 0.62, -size * 0.08, size * 0.64, size * 0.63, size * 0.12, size);
      ctx.bezierCurveTo(-size * 0.56, size * 0.82, -size * 0.28, size * 0.16, 0, 0);
    } else if (shape === 2) {
      ctx.bezierCurveTo(size * 0.25, -size * 0.16, size * 0.58, size * 0.18, size * 0.39, size * 0.56);
      ctx.bezierCurveTo(size * 0.16, size * 0.78, size * 0.14, size * 0.9, 0, size);
      ctx.bezierCurveTo(-size * 0.45, size * 0.61, -size * 0.52, size * 0.1, 0, 0);
    } else {
      ctx.bezierCurveTo(size * 0.42, size * 0.18, size * 0.52, size * 0.82, 0, size);
      ctx.bezierCurveTo(-size * 0.52, size * 0.82, -size * 0.42, size * 0.18, 0, 0);
    }
    ctx.fill();
  }

  // A continuous wind field shared by nearby petals: long gusts, small eddies,
  // and occasional lift, rather than independent random direction changes.
  function windAt(x, y, time) {
    const gust = Math.sin(time * 0.38) * 0.5 + Math.sin(time * 0.17 + 1.4) * 0.5;
    return {
      x: -18 + gust * 30 + Math.sin(y * 5 + time * 0.65) * 16,
      y: -8 + Math.sin(x * 5 - time * 0.5) * 27 + gust * 12,
      turn: Math.cos(y * 5 + time * 0.65) * 0.5
    };
  }

  function drawFlowers(scene, dt) {
    const { ctx, width, height, time } = scene;
    scene.flowers.forEach(flower => {
      const bloom = motion.matches ? 1 : Math.min(1, Math.max(0, (time - flower.start) / 0.7));
      const scale = 1 - Math.pow(1 - bloom, 3);
      const x = flower.x * width + scene.mouseX * 10;
      const y = flower.y * height + scene.mouseY * 6;
      ctx.save();
      ctx.translate(x, y);
      const breeze = windAt(flower.x, flower.y, time);
      ctx.rotate(flower.angle + Math.sin(time * 0.7 + flower.phase) * 0.06 + breeze.x * 0.002);
      ctx.scale(scale, scale);
      for (let i = 0; i < flower.petals; i++) {
        ctx.save();
        ctx.rotate(i / flower.petals * Math.PI * 2);
        ctx.scale(0.56, 1);
        drawPetal(ctx, flower.radius, i % 2 ? flower.color : flower.color2, 0.76);
        ctx.restore();
      }
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#e5c78c';
      ctx.beginPath();
      ctx.arc(0, 0, flower.radius * 0.19, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (!motion.matches && bloom > 0.7 && time >= flower.nextEject && scene.loose.length < 80) {
        scene.loose.push({
          x, y, vx: random(-24, -6), vy: random(-12, 16), size: flower.radius * random(0.4, 0.8),
          angle: random(0, Math.PI * 2), spin: random(-2, 2),
          phase: random(0, Math.PI * 2), color: Math.random() < 0.5 ? flower.color : flower.color2,
          depth: random(0.6, 1), shape: Math.floor(random(1, 4)),
          life: 0, maxLife: random(5, 10)
        });
        flower.nextEject = time + random(0.8, 1.8);
      }
    });
    scene.loose = scene.loose.filter(p => p.life < p.maxLife);
    scene.loose.forEach(p => {
      p.life += dt;
      const progress = p.life / p.maxLife;
      p.phase += dt * 3;
      const wind = windAt(p.x / width, p.y / height, time);
      const response = 1 - Math.exp(-dt * 1.4);
      p.vx += (wind.x * p.depth - p.vx) * response;
      p.vy += ((wind.y + 15 + progress * 12) * p.depth - p.vy) * response;
      p.x += (p.vx + Math.sin(p.phase) * 8 + scene.mouseX * 4) * dt;
      p.y += p.vy * dt;
      p.angle += (p.spin + wind.turn) * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(Math.cos(p.phase), 0.8 + Math.sin(p.phase * 0.7) * 0.2);
      drawPetal(ctx, p.size, p.color, Math.max(0, Math.min(1, progress / 0.1, (1 - progress) / 0.25)) * 0.8, p.shape);
      ctx.restore();
    });
  }

  function drawScene(scene, dt) {
    const { ctx, width, height } = scene;
    ctx.clearRect(0, 0, width, height);
    if (!width || !height) return;
    scene.time += dt;
    if (scene.kind === 'hero') drawFlowers(scene, dt);
    if (motion.matches) return;
    scene.petals.forEach(p => {
      p.phase += dt * p.flutter;
      const wind = windAt(p.x, p.y, scene.time);
      const response = 1 - Math.exp(-dt * (0.9 + p.depth));
      p.vx += (wind.x * p.depth - p.vx) * response;
      p.vy += ((p.fall + wind.y) * p.depth - p.vy) * response;
      p.x += p.vx * dt / width;
      p.y += p.vy * dt / height;
      p.angle += (p.spin + wind.turn * p.depth) * dt;
      // Wrap outside the drawing area; edge fading hides the re-entry.
      const marginX = 32 / width, marginY = 32 / height;
      if (p.x < -marginX) p.x = 1 + marginX;
      if (p.x > 1 + marginX) p.x = -marginX;
      if (p.y < -marginY) p.y = 1 + marginY;
      if (p.y > 1 + marginY) p.y = -marginY;
      ctx.save();
      ctx.translate(p.x * width + Math.sin(p.phase) * 9, p.y * height);
      ctx.rotate(p.angle);
      const flip = Math.cos(p.phase + p.fold);
      ctx.scale(flip, 0.85 + Math.sin(p.phase * 0.7) * 0.15);
      const fade = Math.max(0, Math.min(1, (p.x * width + 32) / 48, ((1 - p.x) * width + 32) / 48,
        (p.y * height + 32) / 48, ((1 - p.y) * height + 32) / 48));
      drawPetal(ctx, p.size, p.color, p.alpha * fade * (0.65 + Math.abs(flip) * 0.35), p.shape);
      ctx.restore();
    });
  }

  let frame = null;
  let last = 0;
  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    scenes.forEach(scene => { if (scene.visible) drawScene(scene, dt); });
    frame = requestAnimationFrame(tick);
  }

  function syncAnimation() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    last = 0;
    if (motion.matches) scenes.forEach(scene => drawScene(scene, 0));
    if (!motion.matches && !document.hidden && scenes.some(scene => scene.visible)) {
      frame = requestAnimationFrame(tick);
    }
  }

  const visibilityObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      scenes.find(scene => scene.section === entry.target).visible = entry.isIntersecting;
    });
    syncAnimation();
  });
  const sizeObserver = new ResizeObserver(entries => {
    entries.forEach(entry => sizeScene(scenes.find(scene => scene.section === entry.target)));
  });
  scenes.forEach(scene => {
    sizeScene(scene);
    visibilityObserver.observe(scene.section);
    sizeObserver.observe(scene.section);
  });
  // A max-width section can keep the same size while viewport margins change,
  // so ResizeObserver alone cannot keep its full-width canvas aligned.
  let resizeFrame = null;
  window.addEventListener('resize', () => {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      scenes.forEach(sizeScene);
    });
  });
  motion.addEventListener('change', syncAnimation);
  document.addEventListener('visibilitychange', syncAnimation);
})();
