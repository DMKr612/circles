import { useEffect, useRef } from "react";

type AnimationState = "FLIGHT" | "CONVERGE" | "BURST" | "LOGO" | "FADE";

type Point = {
  x: number;
  y: number;
};

type Meteor = {
  isConverging: boolean;
  progress: number;
  opacity: number;
  size: number;
  palette: MeteorPalette;
  history: Point[];
  amplitude: number;
  phase: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  x: number;
  y: number;
  logoX: number;
  logoY: number;
};

type LandingMeteorCanvasProps = {
  className?: string;
};

type MeteorPalette = {
  head: string;
  trail: string;
  glow: string;
};

const CONFIG = {
  trailLength: 34,
  singleProgressStep: 0.0052,
  convergeProgressStep: 0.0054,
  burstFrames: 44,
  logoHoldFrames: 180,
};

const METEOR_PALETTES: MeteorPalette[] = [
  { head: "rgba(255,72,72,0.94)", trail: "rgba(255,72,72,0.46)", glow: "rgba(255,66,66,0.88)" },
  { head: "rgba(66,136,255,0.94)", trail: "rgba(66,136,255,0.46)", glow: "rgba(88,154,255,0.9)" },
  { head: "rgba(20,26,44,0.95)", trail: "rgba(54,76,130,0.44)", glow: "rgba(74,108,180,0.82)" },
];

export default function LandingMeteorCanvas({ className }: LandingMeteorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let cycleCount = 0;
    let meteors: Meteor[] = [];
    let animationState: AnimationState = "FLIGHT";
    let stateTimer = 0;
    let rafId = 0;
    let disposed = false;

    const logoImage = new Image();
    let logoLoaded = false;
    logoImage.onload = () => {
      logoLoaded = true;
    };
    logoImage.src = "/image5.png";

    const randomBetween = (min: number, max: number): number => min + Math.random() * (max - min);

    const createMeteor = (isConverging = false, index = 0): Meteor => {
      const meteor: Meteor = {
        isConverging,
        progress: 0,
        opacity: 1,
        size: randomBetween(7.2, 11.8),
        palette: METEOR_PALETTES[Math.floor(Math.random() * METEOR_PALETTES.length)] ?? METEOR_PALETTES[0],
        history: [],
        amplitude: randomBetween(40, 88),
        phase: Math.random() * Math.PI * 2,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        x: 0,
        y: 0,
        logoX: width / 2,
        logoY: height / 2,
      };

      if (!isConverging) {
        const direction = Math.floor(Math.random() * 4);
        if (direction === 0) {
          meteor.startX = -130;
          meteor.startY = Math.random() * height;
          meteor.endX = width + 130;
          meteor.endY = meteor.startY + randomBetween(-220, 220);
        } else if (direction === 1) {
          meteor.startX = width + 130;
          meteor.startY = Math.random() * height;
          meteor.endX = -130;
          meteor.endY = meteor.startY + randomBetween(-220, 220);
        } else if (direction === 2) {
          meteor.startX = Math.random() * width;
          meteor.startY = -130;
          meteor.endX = meteor.startX + randomBetween(-220, 220);
          meteor.endY = height + 130;
        } else {
          meteor.startX = Math.random() * width;
          meteor.startY = height + 130;
          meteor.endX = meteor.startX + randomBetween(-220, 220);
          meteor.endY = -130;
        }
      } else {
        meteor.size = randomBetween(9.4, 14.8);
        const padding = 220;
        const centerX = width / 2;
        const centerY = height / 2;
        const starts = [
          { x: -padding, y: -padding },
          { x: width + padding, y: -padding },
          { x: width + padding, y: height + padding },
          { x: -padding, y: height + padding },
        ];
        meteor.startX = starts[index]?.x ?? -padding;
        meteor.startY = starts[index]?.y ?? -padding;
        meteor.endX = centerX;
        meteor.endY = centerY;

        const radius = 72;
        const angle = (index * Math.PI * 2) / 4;
        meteor.logoX = centerX + Math.cos(angle) * radius;
        meteor.logoY = centerY + Math.sin(angle) * radius;
      }

      meteor.x = meteor.startX;
      meteor.y = meteor.startY;
      return meteor;
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const initCycle = () => {
      meteors = [];
      cycleCount += 1;
      stateTimer = 0;
      if (cycleCount % 5 === 0) {
        animationState = "CONVERGE";
        for (let i = 0; i < 4; i += 1) meteors.push(createMeteor(true, i));
      } else {
        animationState = "FLIGHT";
        meteors.push(createMeteor(false, 0));
      }
    };

    const updateMeteor = (meteor: Meteor) => {
      const step = meteor.isConverging ? CONFIG.convergeProgressStep : CONFIG.singleProgressStep;
      meteor.progress += step;

      const baseX = meteor.startX + (meteor.endX - meteor.startX) * meteor.progress;
      const baseY = meteor.startY + (meteor.endY - meteor.startY) * meteor.progress;
      const baseAngle = Math.atan2(meteor.endY - meteor.startY, meteor.endX - meteor.startX);

      const waveOffset = Math.sin(meteor.progress * 20 + meteor.phase) * meteor.amplitude * (1 - meteor.progress);
      const secondaryOffset =
        Math.cos(meteor.progress * 12 + meteor.phase * 0.8) * (meteor.amplitude * 0.24) * (1 - meteor.progress);
      const totalOffset = waveOffset + secondaryOffset;

      meteor.x = baseX + Math.cos(baseAngle + Math.PI / 2) * totalOffset;
      meteor.y = baseY + Math.sin(baseAngle + Math.PI / 2) * totalOffset;

      meteor.history.push({ x: meteor.x, y: meteor.y });
      if (meteor.history.length > CONFIG.trailLength) meteor.history.shift();
    };

    const drawMeteor = (meteor: Meteor) => {
      for (let i = 1; i < meteor.history.length; i += 1) {
        const prev = meteor.history[i - 1];
        const point = meteor.history[i];
        const alpha = (i / meteor.history.length) * meteor.opacity;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(point.x, point.y);
        ctx.lineWidth = 4.2;
        ctx.strokeStyle = meteor.palette.trail.replace(/0\.\d+\)/, `${alpha * 0.95})`);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(meteor.x, meteor.y, meteor.size, 0, Math.PI * 2);
      ctx.fillStyle = meteor.palette.head.replace(/0\.\d+\)/, `${meteor.opacity})`);
      ctx.shadowBlur = 34;
      ctx.shadowColor = meteor.palette.glow;
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    const drawExplosion = (progress: number) => {
      const centerX = width / 2;
      const centerY = height / 2;
      const outerRadius = Math.max(160, Math.min(width, height) * 0.24) * progress;
      const innerRadius = Math.max(52, Math.min(width, height) * 0.08) * (1 - progress * 0.65);
      const intensity = Math.max(1 - progress, 0);

      const gradient = ctx.createRadialGradient(centerX, centerY, innerRadius * 0.1, centerX, centerY, outerRadius);
      gradient.addColorStop(0, `rgba(255,88,88,${0.42 * intensity})`);
      gradient.addColorStop(0.36, `rgba(82,142,255,${0.38 * intensity})`);
      gradient.addColorStop(0.72, `rgba(28,38,68,${0.34 * intensity})`);
      gradient.addColorStop(1, "rgba(12,16,30,0)");

      ctx.save();
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, outerRadius * 0.72, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(90,154,255,${0.62 * intensity})`;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.restore();
    };

    const drawLogo = (alpha: number) => {
      const centerX = width / 2;
      const centerY = height / 2;
      const size = Math.max(180, Math.min(width, height) * 0.27);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 56 * alpha;
      ctx.shadowColor = "rgba(132,122,255,0.95)";
      if (logoLoaded) {
        ctx.drawImage(logoImage, centerX - size / 2, centerY - size / 2, size, size);
      } else {
        ctx.beginPath();
        ctx.arc(centerX, centerY, size * 0.26, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.restore();
    };

    const animate = () => {
      if (disposed) return;
      ctx.clearRect(0, 0, width, height);

      if (animationState === "FLIGHT") {
        const meteor = meteors[0];
        if (meteor) {
          updateMeteor(meteor);
          drawMeteor(meteor);
          if (meteor.progress >= 1.1) initCycle();
        }
      } else if (animationState === "CONVERGE") {
        let arrived = true;
        for (const meteor of meteors) {
          if (meteor.progress < 1) {
            updateMeteor(meteor);
            arrived = false;
          } else {
            meteor.x += (meteor.logoX - meteor.x) * 0.12;
            meteor.y += (meteor.logoY - meteor.y) * 0.12;
          }
          drawMeteor(meteor);
        }

        if (arrived) {
          stateTimer += 1;
          if (stateTimer > 30) {
            animationState = "BURST";
            stateTimer = 0;
          }
        }
      } else if (animationState === "BURST") {
        stateTimer += 1;
        const progress = Math.min(stateTimer / CONFIG.burstFrames, 1);
        for (const meteor of meteors) {
          meteor.x += (meteor.logoX - meteor.x) * 0.14;
          meteor.y += (meteor.logoY - meteor.y) * 0.14;
          meteor.opacity = Math.max(1 - progress * 1.35, 0);
          drawMeteor(meteor);
        }
        drawExplosion(progress);
        if (stateTimer >= CONFIG.burstFrames) {
          animationState = "LOGO";
          stateTimer = 0;
          for (const meteor of meteors) meteor.opacity = 0.32;
        }
      } else if (animationState === "LOGO") {
        stateTimer += 1;
        const alpha = Math.min(stateTimer / 30, 1);
        for (const meteor of meteors) {
          meteor.x += (meteor.logoX - meteor.x) * 0.12;
          meteor.y += (meteor.logoY - meteor.y) * 0.12;
          drawMeteor(meteor);
        }
        drawLogo(alpha);

        if (stateTimer > CONFIG.logoHoldFrames) {
          animationState = "FADE";
          stateTimer = 0;
        }
      } else if (animationState === "FADE") {
        stateTimer += 1;
        const fade = Math.max(1 - stateTimer / 60, 0);
        for (const meteor of meteors) {
          meteor.opacity = fade;
          drawMeteor(meteor);
        }
        drawLogo(fade);
        if (stateTimer >= 60) initCycle();
      }

      rafId = window.requestAnimationFrame(animate);
    };

    resize();
    initCycle();
    rafId = window.requestAnimationFrame(animate);
    window.addEventListener("resize", resize);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
