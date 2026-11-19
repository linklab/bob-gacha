<script lang="ts">
  import type { DrawResult } from "../lib/draw";

  let { result }: { result: DrawResult } = $props();

  const fireworks = [
    { x: 22, y: 36, delay: 0, color: "#ffcc67" },
    { x: 78, y: 30, delay: 160, color: "#b8ffac" },
    { x: 68, y: 70, delay: 370, color: "#ff9273" },
  ];
  const sparks = Array.from({ length: 14 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 14;
    const reach = index % 2 ? 1 : 0.69;
    return {
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach,
      rotation: (angle * 180) / Math.PI + 90,
    };
  });

  const paperColors = ["#ffca60", "#ff8b71", "#a3f3a0", "#fff0c3", "#8cdcff"];
  const confetti = Array.from({ length: 38 }, (_, index) => {
    const side = index % 2 ? 1 : -1;
    const reach = (((index * 13) % 37) + 2) / 39;
    const lift = (((index * 17) % 37) + 2) / 39;
    return {
      origin: side > 0 ? 87 : 13,
      distance: `${-side * (10 + reach * 57)}cqw`,
      rise: `${-(14 + lift * 56)}cqh`,
      delay: 35 + (index % 6) * 26 + (side > 0 ? 150 : 0),
      duration: 1320 + (index % 7) * 96,
      rotation: `${side * (120 + index * 29)}deg`,
      color: paperColors[index % paperColors.length],
    };
  });
</script>

<div class="draw-result" data-testid="draw-result" style:--winner={result.candidate.color}>
  <div class="effects" aria-hidden="true">
    <div class="flash"></div>
    {#each fireworks as burst (burst.x)}
      <div
        class="firework"
        style:left={`${burst.x}%`}
        style:top={`${burst.y}%`}
        style:--delay={`${burst.delay}ms`}
        style:--color={burst.color}
      >
        <span class="ring"></span>
        {#each sparks as spark (spark.rotation)}
          <span
            class="spark"
            style:--x={spark.x}
            style:--y={spark.y}
            style:--rotation={`${spark.rotation}deg`}
          ></span>
        {/each}
      </div>
    {/each}
    {#each confetti as piece (piece.rotation)}
      <span
        class="paper"
        style:left={`${piece.origin}%`}
        style:--distance={piece.distance}
        style:--rise={piece.rise}
        style:--delay={`${piece.delay}ms`}
        style:--duration={`${piece.duration}ms`}
        style:--rotation={piece.rotation}
        style:--color={piece.color}
      ></span>
    {/each}
  </div>

  <div class="winner">
    <span class="result-label">당첨</span>
    <strong class:long={result.candidate.name.length > 11}>{result.candidate.name}</strong>
    <span class="pocket-result">
      {result.pocket !== undefined ? `${result.pocket}번 포켓` : `${result.candidate.id}번 구슬`}
    </span>
  </div>
</div>

<style>
  .draw-result {
    position: absolute;
    z-index: 1;
    inset: 0;
    display: grid;
    place-items: center;
    container-type: size;
    pointer-events: none;
  }

  .winner {
    position: relative;
    display: grid;
    width: min(85cqw, 840px);
    justify-items: center;
    gap: clamp(4px, 1.4cqh, 12px);
    padding-block: clamp(14px, 6cqh, 46px);
    color: #fff9e7;
    text-align: center;
    text-shadow: 0 2px 9px rgb(12 7 2 / 90%);
    isolation: isolate;
  }

  .winner::before {
    position: absolute;
    z-index: -1;
    inset: -30% -8%;
    content: "";
    background: radial-gradient(ellipse, rgb(14 9 8 / 94%) 17%, rgb(20 12 10 / 73%) 42%, transparent 72%);
  }

  .winner strong {
    max-width: 100%;
    color: #fff5d8;
    font-size: clamp(2.6rem, min(10.5cqw, 20cqh), 6.75rem);
    font-weight: 900;
    letter-spacing: -0.065em;
    line-height: 1.06;
    overflow-wrap: anywhere;
    text-wrap: balance;
    text-shadow: 0 3px 0 #8b4e25, 0 6px 14px #1a0b04, 0 0 30px color-mix(in srgb, var(--winner) 53%, transparent);
  }

  .winner strong.long {
    display: -webkit-box;
    overflow: hidden;
    font-size: clamp(1.35rem, min(6.1cqw, 12cqh), 4.1rem);
    letter-spacing: -0.035em;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }

  .result-label {
    color: #ffd27d;
    font-size: clamp(0.9rem, 2.8cqw, 1.2rem);
    font-weight: 800;
    letter-spacing: 0.26em;
    text-indent: 0.26em;
  }

  .pocket-result {
    color: #ffebc8;
    font-size: clamp(0.81rem, 2.7cqw, 1rem);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }

  .effects,
  .flash {
    position: absolute;
    inset: 0;
  }

  .flash {
    background:
      radial-gradient(ellipse at 50% 50%, rgb(255 184 92 / 44%), transparent 57%),
      radial-gradient(ellipse at 5% 28%, rgb(255 215 140 / 42%), transparent 46%),
      radial-gradient(ellipse at 98% 26%, rgb(255 238 182 / 40%), transparent 45%);
  }

  .firework,
  .ring,
  .spark,
  .paper {
    position: absolute;
  }

  .firework {
    --reach: min(30cqw, 19cqh, 174px);
  }

  .ring {
    width: calc(var(--reach) * 1.8);
    aspect-ratio: 1;
    border: 2px solid var(--color);
    border-radius: 50%;
    box-shadow: 0 0 19px var(--color), inset 0 0 12px var(--color);
    translate: -50% -50%;
  }

  .spark {
    width: clamp(2px, 0.55cqw, 5px);
    height: clamp(9px, 2.5cqw, 24px);
    border-radius: 100%;
    background: linear-gradient(#fffce6, var(--color) 54%, transparent);
    box-shadow: 0 -5px 14px var(--color);
  }

  .paper {
    top: 76%;
    width: clamp(4px, 0.95cqw, 9px);
    height: clamp(8px, 1.65cqw, 16px);
    border-radius: 2px;
    background: linear-gradient(135deg, #fff7d3, var(--color) 47%);
  }

  .paper:nth-child(3n) {
    height: clamp(4px, 0.95cqw, 9px);
    border-radius: 50%;
  }

  @media (prefers-reduced-motion: no-preference) {
    .winner {
      animation: winner-pop 720ms cubic-bezier(0.18, 0.77, 0.27, 1) both;
    }

    .flash {
      animation: flash 1.26s ease-out both;
    }

    .ring {
      animation: ring 730ms var(--delay) ease-out both;
    }

    .spark {
      animation: spark 960ms var(--delay) cubic-bezier(0.15, 0.62, 0.3, 1) both;
    }

    .paper {
      animation: paper var(--duration) var(--delay) linear both;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ring,
    .spark,
    .paper {
      display: none;
    }

    .flash {
      opacity: 0.35;
    }
  }

  @keyframes winner-pop {
    0% { opacity: 0; transform: scale(0.72); }
    17% { opacity: 1; transform: scale(1.12); }
    33% { transform: scale(0.98); }
    51% { transform: scale(1.07); }
    100% { transform: scale(1); }
  }

  @keyframes flash {
    0% { opacity: 0; }
    11% { opacity: 0.94; }
    38% { opacity: 0.5; }
    100% { opacity: 0; }
  }

  @keyframes ring {
    0% { opacity: 0; scale: 0.06; }
    13% { opacity: 0.88; }
    100% { opacity: 0; scale: 1.07; }
  }

  @keyframes spark {
    0% { opacity: 0; scale: 0.18; }
    12% { opacity: 1; }
    55% { opacity: 0.85; scale: 1; }
    100% {
      opacity: 0;
      transform: translate(calc(var(--x) * var(--reach)), calc(var(--y) * var(--reach))) rotate(var(--rotation));
      scale: 0.12;
    }
  }

  @keyframes paper {
    0% { opacity: 0; transform: translate(0) rotate(0); }
    8% { opacity: 1; }
    35% { transform: translate(calc(var(--distance) * 0.62), var(--rise)) rotate(calc(var(--rotation) * 0.48)); }
    78% { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--distance), 34cqh) rotate(var(--rotation)); }
  }
</style>
