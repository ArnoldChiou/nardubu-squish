'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, Sparkles, Volume2, VolumeX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

type Contact = {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  lastAt: number;
  speed: number;
};

type Berry = { x: number; y: number; r: number; phase: number };

type WebMcpDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: {
        name: string;
        title: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations: {
          readOnlyHint: boolean;
          untrustedContentHint: boolean;
        };
        execute: (input: unknown) => unknown;
      },
      options?: { signal?: AbortSignal },
    ) => void | Promise<void>;
  };
};

const berries: Berry[] = [
  { x: -0.34, y: 0.2, r: 0.105, phase: 0.4 },
  { x: -0.13, y: 0.13, r: 0.09, phase: 1.3 },
  { x: 0.12, y: 0.24, r: 0.11, phase: 2.4 },
  { x: 0.34, y: 0.1, r: 0.088, phase: 4.2 },
  { x: -0.28, y: -0.05, r: 0.075, phase: 3.1 },
  { x: 0.02, y: -0.08, r: 0.098, phase: 5.4 },
  { x: 0.23, y: -0.02, r: 0.072, phase: 0.9 },
];

const petals = Array.from({ length: 34 }, (_, index) => ({
  x: -0.46 + ((index * 37) % 73) / 100,
  y: -0.34 + ((index * 53) % 57) / 100,
  r: 1.4 + (index % 4) * 0.7,
  phase: index * 0.73,
}));

function shortestAngle(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function roundedBlobPath(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
) {
  const last = points[points.length - 1];
  const first = points[0];
  ctx.beginPath();
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    ctx.quadraticCurveTo(
      point.x,
      point.y,
      (point.x + next.x) / 2,
      (point.y + next.y) / 2,
    );
  }
  ctx.closePath();
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contactsRef = useRef(new Map<number, Contact>());
  const audioRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(true);
  const lastSoundAtRef = useRef(0);
  const autoPressRef = useRef(0);
  const keyboardPressedRef = useRef(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [pressCount, setPressCount] = useState(0);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const playSquish = useCallback((strength: number, release = false) => {
    if (!soundEnabledRef.current || typeof window === 'undefined') return;

    const AudioContextClass = window.AudioContext;
    const audio = audioRef.current ?? new AudioContextClass();
    audioRef.current = audio;
    void audio.resume();

    const now = audio.currentTime;
    const duration = release ? 0.24 : 0.34;
    const noiseBuffer = audio.createBuffer(
      1,
      Math.ceil(audio.sampleRate * duration),
      audio.sampleRate,
    );
    const channel = noiseBuffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.86 + white * 0.14;
      channel[index] = previous * (1 - index / channel.length);
    }

    const noise = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    noise.buffer = noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(release ? 720 : 460, now);
    filter.frequency.exponentialRampToValueAtTime(
      release ? 260 : 150,
      now + duration,
    );
    filter.Q.value = 2.2;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      0.055 + strength * 0.08,
      now + 0.018,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(filter).connect(gain).connect(audio.destination);
    noise.start(now);
    noise.stop(now + duration);

    const oscillator = audio.createOscillator();
    const oscillatorGain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(release ? 145 : 82, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      release ? 74 : 48,
      now + duration * 0.72,
    );
    oscillatorGain.gain.setValueAtTime(0.0001, now);
    oscillatorGain.gain.exponentialRampToValueAtTime(
      0.035 + strength * 0.035,
      now + 0.012,
    );
    oscillatorGain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + duration * 0.8,
    );
    oscillator.connect(oscillatorGain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let width = 1;
    let height = 1;
    let animationFrame = 0;
    let lastTime = performance.now();
    let squeeze = 0;
    let squeezeVelocity = 0;
    let releaseWave = 0;
    let releaseVelocity = 0;
    let previousTarget = 0;
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.034);
      lastTime = time;
      const contacts = [...contactsRef.current.values()];

      if (autoPressRef.current > 0) {
        autoPressRef.current = Math.max(0, autoPressRef.current - dt);
      }
      const autoAmount =
        autoPressRef.current > 0
          ? Math.sin(
              Math.min(1, (1.25 - autoPressRef.current) / 0.28) * Math.PI * 0.5,
            ) * Math.min(1, autoPressRef.current * 2.4)
          : 0;
      const pointerAmount = contacts.length
        ? Math.min(
            1,
            0.48 +
              contacts.reduce(
                (sum, contact) => sum + Math.min(contact.speed / 680, 0.22),
                0,
              ),
          )
        : 0;
      const target = Math.max(
        pointerAmount,
        autoAmount,
        keyboardPressedRef.current ? 0.82 : 0,
      );
      const stiffness = reduceMotion ? 50 : 115;
      const damping = reduceMotion ? 18 : 10.5;
      squeezeVelocity += (target - squeeze) * stiffness * dt;
      squeezeVelocity *= Math.exp(-damping * dt);
      squeeze += squeezeVelocity * dt;
      if (previousTarget > 0.2 && target === 0) releaseVelocity += 1.45;
      previousTarget = target;
      releaseVelocity += -releaseWave * 150 * dt;
      releaseVelocity *= Math.exp(-8.5 * dt);
      releaseWave += releaseVelocity * dt;

      const centerX = width / 2;
      const centerY = height * 0.53;
      const baseRx = Math.min(width * 0.31, 255);
      const baseRy = Math.min(height * 0.31, 198);
      const globalRx = baseRx * (1 - squeeze * 0.09 + releaseWave * 0.055);
      const globalRy = baseRy * (1 + squeeze * 0.115 - releaseWave * 0.035);
      const surfaceContacts = contacts.map((contact) => ({
        ...contact,
        angle: Math.atan2(
          (contact.y - centerY) / baseRy,
          (contact.x - centerX) / baseRx,
        ),
      }));

      context.clearRect(0, 0, width, height);

      const ambient = context.createRadialGradient(
        centerX,
        centerY + baseRy * 0.7,
        12,
        centerX,
        centerY + baseRy * 0.7,
        baseRx * 1.42,
      );
      ambient.addColorStop(0, 'rgba(65, 89, 134, 0.22)');
      ambient.addColorStop(0.48, 'rgba(52, 68, 109, 0.06)');
      ambient.addColorStop(1, 'rgba(42, 54, 86, 0)');
      context.fillStyle = ambient;
      context.fillRect(0, 0, width, height);

      const points = Array.from({ length: 88 }, (_, index) => {
        const angle = (index / 88) * Math.PI * 2;
        let localDent = 0;
        for (const contact of surfaceContacts) {
          const delta = shortestAngle(angle, contact.angle);
          localDent += Math.exp(-(delta * delta) / 0.105) * squeeze * 0.18;
        }
        const organic =
          Math.sin(angle * 3 + time * 0.0013) *
          (0.008 + Math.abs(releaseWave) * 0.035);
        const pressureBulge = squeeze * 0.055 * Math.cos(angle * 2);
        const radial = Math.max(0.72, 1 - localDent + organic - pressureBulge);
        return {
          x: centerX + Math.cos(angle) * globalRx * radial,
          y: centerY + Math.sin(angle) * globalRy * radial,
        };
      });

      context.save();
      context.shadowColor = 'rgba(14, 24, 57, 0.34)';
      context.shadowBlur = 44;
      context.shadowOffsetY = 26;
      roundedBlobPath(context, points);
      context.fillStyle = 'rgba(42, 57, 96, 0.16)';
      context.fill();
      context.restore();

      roundedBlobPath(context, points);
      context.save();
      context.clip();

      const bodyGradient = context.createRadialGradient(
        centerX - baseRx * 0.34,
        centerY - baseRy * 0.58,
        4,
        centerX + baseRx * 0.12,
        centerY + baseRy * 0.12,
        baseRx * 1.16,
      );
      bodyGradient.addColorStop(0, 'rgba(245, 252, 255, 0.93)');
      bodyGradient.addColorStop(0.18, 'rgba(192, 226, 251, 0.78)');
      bodyGradient.addColorStop(0.52, 'rgba(122, 159, 216, 0.58)');
      bodyGradient.addColorStop(0.78, 'rgba(67, 83, 145, 0.52)');
      bodyGradient.addColorStop(1, 'rgba(36, 47, 91, 0.72)');
      context.fillStyle = bodyGradient;
      context.fillRect(
        centerX - baseRx * 1.3,
        centerY - baseRy * 1.3,
        baseRx * 2.6,
        baseRy * 2.6,
      );

      const interiorScaleX = globalRx * (1 + squeeze * 0.025);
      const interiorScaleY = globalRy * (1 - squeeze * 0.03);
      const driftX = contacts.length
        ? (contacts[0].x - centerX) * -0.035 * squeeze
        : releaseWave * 18;
      const driftY = contacts.length
        ? (contacts[0].y - centerY) * -0.025 * squeeze
        : -releaseWave * 10;

      for (const berry of berries) {
        const wobbleX =
          Math.sin(time * 0.0025 + berry.phase) * (2 + squeeze * 5);
        const wobbleY =
          Math.cos(time * 0.002 + berry.phase) * (1.5 + squeeze * 3);
        const x = centerX + berry.x * interiorScaleX + driftX + wobbleX;
        const y = centerY + berry.y * interiorScaleY + driftY + wobbleY;
        const radius = berry.r * baseRx * (1 + squeeze * 0.04);
        const berryGradient = context.createRadialGradient(
          x - radius * 0.38,
          y - radius * 0.38,
          1,
          x,
          y,
          radius,
        );
        berryGradient.addColorStop(0, '#7395c5');
        berryGradient.addColorStop(0.23, '#314f88');
        berryGradient.addColorStop(0.72, '#142750');
        berryGradient.addColorStop(1, '#0b1632');
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = berryGradient;
        context.fill();
        context.strokeStyle = 'rgba(159, 191, 230, 0.46)';
        context.lineWidth = 1.2;
        context.stroke();
        context.save();
        context.translate(x, y - radius * 0.7);
        context.rotate(berry.phase + squeeze * 0.4);
        context.fillStyle = 'rgba(117, 153, 190, 0.84)';
        for (let petal = 0; petal < 5; petal += 1) {
          context.rotate((Math.PI * 2) / 5);
          context.beginPath();
          context.ellipse(
            0,
            -radius * 0.22,
            radius * 0.12,
            radius * 0.31,
            0,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
        context.restore();
      }

      context.save();
      context.translate(
        centerX + interiorScaleX * 0.35 + driftX,
        centerY - interiorScaleY * 0.06 + driftY,
      );
      context.rotate(-0.3 + squeeze * 0.08);
      context.strokeStyle = 'rgba(37, 101, 74, 0.8)';
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(-4, 58);
      context.quadraticCurveTo(8, 8, 28, -62);
      context.stroke();
      for (let leaf = 0; leaf < 6; leaf += 1) {
        const side = leaf % 2 === 0 ? -1 : 1;
        const y = 36 - leaf * 18;
        context.save();
        context.translate(8 + side * 8, y);
        context.rotate(side * 0.72);
        context.beginPath();
        context.ellipse(0, 0, 8, 18, 0, 0, Math.PI * 2);
        context.fillStyle = `rgba(${45 + leaf * 3}, ${
          126 + leaf * 5
        }, ${82 + leaf * 2}, 0.78)`;
        context.fill();
        context.restore();
      }
      context.restore();

      for (const petal of petals) {
        const x =
          centerX +
          petal.x * interiorScaleX +
          driftX * 0.45 +
          Math.sin(time * 0.002 + petal.phase) * squeeze * 4;
        const y =
          centerY +
          petal.y * interiorScaleY +
          driftY * 0.45 +
          Math.cos(time * 0.0017 + petal.phase) * squeeze * 3;
        context.beginPath();
        context.arc(x, y, petal.r, 0, Math.PI * 2);
        context.fillStyle = `rgba(255, 247, 252, ${
          0.52 + (petal.phase % 0.35)
        })`;
        context.fill();
      }

      const lowerGlow = context.createLinearGradient(
        centerX,
        centerY,
        centerX,
        centerY + baseRy,
      );
      lowerGlow.addColorStop(0, 'rgba(143, 185, 224, 0)');
      lowerGlow.addColorStop(1, 'rgba(204, 231, 245, 0.43)');
      context.fillStyle = lowerGlow;
      context.fillRect(centerX - baseRx, centerY, baseRx * 2, baseRy);

      context.restore();

      roundedBlobPath(context, points);
      const edgeGradient = context.createLinearGradient(
        centerX - baseRx,
        centerY - baseRy,
        centerX + baseRx,
        centerY + baseRy,
      );
      edgeGradient.addColorStop(0, 'rgba(255, 255, 255, 0.78)');
      edgeGradient.addColorStop(0.43, 'rgba(181, 216, 245, 0.38)');
      edgeGradient.addColorStop(0.7, 'rgba(49, 68, 125, 0.5)');
      edgeGradient.addColorStop(1, 'rgba(229, 245, 252, 0.42)');
      context.strokeStyle = edgeGradient;
      context.lineWidth = 3.2;
      context.stroke();

      context.save();
      context.globalCompositeOperation = 'screen';
      context.beginPath();
      context.ellipse(
        centerX - baseRx * 0.23,
        centerY - baseRy * 0.56,
        baseRx * 0.38,
        baseRy * 0.14,
        -0.16,
        0,
        Math.PI * 2,
      );
      const shine = context.createRadialGradient(
        centerX - baseRx * 0.3,
        centerY - baseRy * 0.61,
        1,
        centerX - baseRx * 0.18,
        centerY - baseRy * 0.55,
        baseRx * 0.38,
      );
      shine.addColorStop(0, 'rgba(255,255,255,0.72)');
      shine.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = shine;
      context.fill();
      context.restore();

      for (const contact of surfaceContacts) {
        const pulse = 10 + squeeze * 16;
        const touchGlow = context.createRadialGradient(
          contact.x,
          contact.y,
          1,
          contact.x,
          contact.y,
          pulse * 2.4,
        );
        touchGlow.addColorStop(0, 'rgba(255,255,255,0.3)');
        touchGlow.addColorStop(1, 'rgba(255,255,255,0)');
        context.beginPath();
        context.arc(contact.x, contact.y, pulse * 2.4, 0, Math.PI * 2);
        context.fillStyle = touchGlow;
        context.fill();
      }

      animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const isOnToy = (x: number, y: number, canvas: HTMLCanvasElement) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const rx = Math.min(width * 0.31, 255);
    const ry = Math.min(height * 0.31, 198);
    const dx = (x - width / 2) / rx;
    const dy = (y - height * 0.53) / ry;
    return dx * dx + dy * dy < 1.18;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    if (!isOnToy(point.x, point.y, event.currentTarget)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    contactsRef.current.set(event.pointerId, {
      ...point,
      lastX: point.x,
      lastY: point.y,
      lastAt: performance.now(),
      speed: 0,
    });
    setHasInteracted(true);
    setPressCount((count) => count + 1);
    playSquish(0.82);
    navigator.vibrate?.(18);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const contact = contactsRef.current.get(event.pointerId);
    if (!contact) return;
    const point = pointFromEvent(event);
    const now = performance.now();
    const distance = Math.hypot(
      point.x - contact.lastX,
      point.y - contact.lastY,
    );
    const elapsed = Math.max(8, now - contact.lastAt);
    contact.x = point.x;
    contact.y = point.y;
    contact.speed = (distance / elapsed) * 1000;
    contact.lastX = point.x;
    contact.lastY = point.y;
    contact.lastAt = now;
    if (distance > 4 && now - lastSoundAtRef.current > 95) {
      lastSoundAtRef.current = now;
      playSquish(Math.min(0.5, contact.speed / 950));
    }
  };

  const releasePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!contactsRef.current.has(event.pointerId)) return;
    contactsRef.current.delete(event.pointerId);
    playSquish(0.6, true);
    navigator.vibrate?.([8, 20, 7]);
  };

  const autoSquish = useCallback(
    (strength = 0.9) => {
      const safeStrength = Math.min(1, Math.max(0.2, strength));
      autoPressRef.current = 0.95 + safeStrength * 0.34;
      setHasInteracted(true);
      setPressCount((count) => count + 1);
      playSquish(safeStrength);
      window.setTimeout(() => playSquish(0.55, true), 650);
    },
    [playSquish],
  );

  useEffect(() => {
    const context = (document as WebMcpDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'squeeze_toy',
            title: '捏一下果凍',
            description:
              '在目前畫面觸發一次果凍擠壓、回彈與音效，並更新已捏次數。',
            inputSchema: {
              type: 'object',
              properties: {
                strength: {
                  type: 'number',
                  minimum: 0.2,
                  maximum: 1,
                  description: '擠壓強度，0.2 到 1。',
                },
              },
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: false,
              untrustedContentHint: false,
            },
            execute(input) {
              const raw =
                typeof input === 'object' && input !== null
                  ? (input as { strength?: unknown }).strength
                  : undefined;
              if (
                raw !== undefined &&
                (typeof raw !== 'number' || raw < 0.2 || raw > 1)
              ) {
                throw new Error('strength 必須是 0.2 到 1 之間的數字');
              }
              const strength = typeof raw === 'number' ? raw : 0.9;
              autoSquish(strength);
              return { status: 'squeezed', strength };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => undefined);
    } catch {
      // WebMCP is optional in browsers that do not implement it yet.
    }

    return () => lifecycle.abort();
  }, [autoSquish]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Nardubu 果凍捏捏">
          <span className="brand-mark" aria-hidden="true">
            <Sparkles />
          </span>
          <span>
            <strong>NARDUBU</strong>
            <small>果凍捏捏實驗室</small>
          </span>
        </div>
        <div className="sound-control">
          {soundEnabled ? (
            <Volume2 aria-hidden="true" />
          ) : (
            <VolumeX aria-hidden="true" />
          )}
          <label htmlFor="sound-switch">聲音</label>
          <Switch
            id="sound-switch"
            checked={soundEnabled}
            onCheckedChange={setSoundEnabled}
            aria-label="切換擠壓音效"
          />
        </div>
      </header>

      <section className="playground" aria-labelledby="toy-title">
        <div className="copy-block">
          <p className="eyebrow">BLUEBERRY JELLY · 01</p>
          <h1 id="toy-title">
            捏下去，
            <br />
            慢慢回彈。
          </h1>
          <p>
            按住果凍拖動，感受內容物被推開。放開時記得聽那一聲柔軟的「噗」。
          </p>
          <Button
            className="auto-button"
            onClick={() => autoSquish()}
            size="lg"
          >
            <RotateCcw data-icon="inline-start" />
            自動捏一下
          </Button>
        </div>

        <div className="toy-stage">
          <button
            type="button"
            className="canvas-button"
            aria-label="可互動的藍莓果凍捏捏。按住滑鼠或用兩指擠壓；鍵盤可按空白鍵。"
            onKeyDown={(event) => {
              if (
                (event.key === ' ' || event.key === 'Enter') &&
                !keyboardPressedRef.current
              ) {
                event.preventDefault();
                keyboardPressedRef.current = true;
                setHasInteracted(true);
                setPressCount((count) => count + 1);
                playSquish(0.8);
              }
            }}
            onKeyUp={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                keyboardPressedRef.current = false;
                playSquish(0.55, true);
              }
            }}
          >
            <canvas
              ref={canvasRef}
              className="squish-canvas"
              aria-hidden="true"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={releasePointer}
              onPointerCancel={releasePointer}
            />
          </button>
          <div
            className={`gesture-hint ${hasInteracted ? 'is-hidden' : ''}`}
            aria-hidden="true"
          >
            <span className="finger-dot" />
            <span>按住並拖曳</span>
          </div>
          <div className="stage-label" aria-live="polite">
            <span className="live-dot" />
            {pressCount > 0 ? `已捏 ${pressCount} 次` : '等待觸碰'}
          </div>
        </div>

        <aside className="tips" aria-label="操作提示">
          <div>
            <span>01</span>
            <p>從邊緣往中心推，凹陷會更明顯。</p>
          </div>
          <div>
            <span>02</span>
            <p>手機上可用兩指同時擠壓，並獲得震動回饋。</p>
          </div>
          <div>
            <span>03</span>
            <p>戴耳機時，濕潤的低頻質感更清楚。</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
