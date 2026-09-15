'use client';

import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { createToy, type ToyController } from '@/lib/toy';

type ModelContext = {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute(input: unknown): Promise<object>;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
};

export default function Home() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ToyController | null>(null);
  const [sound, setSound] = useState(true);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canvas.current) return;
    try {
      controller.current = createToy(
        canvas.current,
        () => setCount((n) => n + 1),
        setError,
      );
    } catch {
      queueMicrotask(() =>
        setError(
          '無法啟動 3D 畫面，請用最新版 Safari 或 Chrome 開啟，並啟用硬體加速。',
        ),
      );
    }
    return () => {
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    controller.current?.setSound(sound);
  }, [sound]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'squeeze_toy',
            description:
              'Squeeze the visible 3D jelly, fracture its frost layer, and allow it to recover.',
            inputSchema: {
              type: 'object',
              properties: {
                strength: { type: 'number', minimum: 0.2, maximum: 1 },
              },
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            async execute(input) {
              if (!input || typeof input !== 'object' || Array.isArray(input))
                throw new Error('Expected an object');
              const values = input as Record<string, unknown>;
              if (Object.keys(values).some((key) => key !== 'strength'))
                throw new Error('Unknown parameter');
              const strength = values.strength ?? 0.96;
              if (
                typeof strength !== 'number' ||
                !Number.isFinite(strength) ||
                strength < 0.2 ||
                strength > 1
              )
                throw new Error('strength must be 0.2 to 1');
              if (!controller.current)
                throw new Error('3D renderer is unavailable');
              controller.current.squeeze(strength);
              await new Promise((resolve) => setTimeout(resolve, 2100));
              return { status: 'squeezed', strength };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => undefined);
    } catch {
      /* Optional progressive enhancement. */
    }
    return () => lifecycle.abort();
  }, []);

  return (
    <main className="studio">
      <header className="studio-header">
        <div>
          <strong>BLUEBERRY / CRUSH</strong>
          <span>藍莓冰霜捏捏 · 非官方互動實驗</span>
        </div>
        <label className="audio-toggle" htmlFor="audio">
          {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          <span>聲音</span>
          <Switch
            id="audio"
            checked={sound}
            onCheckedChange={setSound}
            aria-label="開關捏壓與碎裂音效"
          />
        </label>
      </header>

      <section className="object-stage" aria-label="立體藍莓冰霜捏捏">
        <div className="object-caption">
          <p>SOFT OUTSIDE. CRUNCH INSIDE.</p>
          <h1>
            軟軟的，
            <br />
            還有一點碎。
          </h1>
        </div>
        <button
          className="object-control"
          type="button"
          aria-label="按住並往內推以捏碎冰霜內層；鍵盤按住空白鍵或 Enter"
          onKeyDown={(e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
              e.preventDefault();
              controller.current?.hold(true);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              controller.current?.hold(false);
            }
          }}
          onBlur={() => controller.current?.release()}
        >
          <canvas ref={canvas} aria-hidden="true" />
        </button>
        {error && (
          <div className="render-error" role="alert">
            {error}
          </div>
        )}
        <div className="object-note">
          <span>霧藍脆層 / 透明軟膠</span>
          <span aria-live="polite">
            {count ? `揉捏 ${count} 次` : '試著捏深一點'}
          </span>
        </div>
      </section>

      <footer className="interaction-bar">
        <div>
          <strong>按住 → 往內推 → 喀滋 → 放手</strong>
          <p>電腦拖曳揉捏 · 手機雙指向內擠壓 · 戴耳機聽細碎聲</p>
        </div>
        <Button
          className="demo-squeeze"
          onClick={() => controller.current?.squeeze()}
        >
          <RotateCcw size={17} />
          示範捏一下
        </Button>
      </footer>
    </main>
  );
}
