<script lang="ts">
  import type { DrawResult } from "../lib/draw";

  let { result }: { result: DrawResult } = $props();

  const colors = ["#ffe4a1", "#fff7e1", "#dbb4ff", "#ffac55"];
  const sparks = Array.from({ length: 38 }, (_, index) => {
    const angle = (index * 137.5 * Math.PI) / 180;
    const reach = 0.42 + ((index * 11) % 17) / 24;
    return {
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach,
      angle: `${(angle * 180) / Math.PI + 90}deg`,
      size: 0.56 + (index % 5) * 0.19,
      delay: `${(index % 7) * 27}ms`,
      duration: `${760 + ((index * 83) % 7) * 110}ms`,
      color: colors[index % colors.length],
    };
  });
</script>

<div class="draw-result" data-testid="draw-result" style:--winner={result.candidate.color}>
  <div class="effects" aria-hidden="true">
    <span class="beam"></span>
    <span class="halo"></span>
    <span class="halo echo"></span>
    <span class="flare"></span>
    {#each sparks as spark (spark.angle)}
      <span
        class="spark"
        style:--x={spark.x}
        style:--y={spark.y}
        style:--angle={spark.angle}
        style:--size={spark.size}
        style:--delay={spark.delay}
        style:--duration={spark.duration}
        style:--color={spark.color}
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
    /* The opening impact in the reward sound starts at 260 ms. */
    --reveal-delay: 260ms;
    position: absolute;
    z-index: 1;
    inset: 0;
    display: grid;
    place-items: center;
    container-type: size;
    overflow: hidden;
    pointer-events: none;
  }

  .effects {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 50% 48%, rgb(75 34 112 / 38%), transparent 62%),
      radial-gradient(ellipse at center, transparent 11%, rgb(10 5 23 / 79%) 91%);
  }

  .beam,
  .halo,
  .flare,
  .spark {
    position: absolute;
    opacity: 0;
  }

  .beam {
    inset: -4% 8% 9%;
    background:
      linear-gradient(90deg, transparent 47%, rgb(255 209 126 / 30%) 49.8%, transparent 52.5%),
      radial-gradient(ellipse at 50% 22%, rgb(207 114 255 / 65%), transparent 63%),
      radial-gradient(ellipse at 50% 55%, rgb(255 193 82 / 73%), transparent 69%);
    clip-path: polygon(13% 0, 87% 0, 53% 68%, 50% 100%, 47% 68%);
    transform-origin: 50% 57%;
    mask-image: linear-gradient(transparent, #000 15%, #000 59%, transparent);
  }

  .halo {
    top: 50%;
    left: 50%;
    width: min(48cqw, 61cqh, 456px);
    aspect-ratio: 1;
    translate: -50% -50%;
    transform: rotate(45deg);
    border: 1px solid #ffe9ac;
    border-radius: 16%;
    box-shadow: 0 0 26px #feca6870, inset 0 0 24px #feca6849;
  }

  .echo {
    border-color: #ddaeff;
    box-shadow: 0 0 32px #ad76f58f, inset 0 0 24px #ad76f548;
  }

  .flare {
    inset: 0;
    transform-origin: center;
    background:
      radial-gradient(ellipse 38% 7% at 50% 50%, #fff4ccdf, #f4b15f48 53%, transparent 100%),
      radial-gradient(ellipse 42% 54% at 50% 50%, #f6ae698f, #b177cc33 57%, transparent 100%);
  }

  .spark {
    top: 50%;
    left: 50%;
    width: calc(clamp(2px, 0.8cqw, 7px) * var(--size));
    height: calc(clamp(5px, 2cqw, 17px) * var(--size));
    background: linear-gradient(#fff9e0, var(--color) 57%, transparent);
    clip-path: polygon(50% 0, 100% 32%, 50% 100%, 0 32%);
    translate: -50% -50%;
  }

  .spark:nth-child(3n) {
    aspect-ratio: 1;
    width: auto;
    background: var(--color);
    clip-path: polygon(50% 0, 63% 37%, 100% 50%, 63% 63%, 50% 100%, 37% 63%, 0 50%, 37% 37%);
  }

  .winner {
    position: relative;
    display: grid;
    width: min(85cqw, 840px);
    justify-items: center;
    gap: clamp(4px, 1.4cqh, 12px);
    padding-block: clamp(12px, 5cqh, 40px);
    color: #fff9e7;
    text-align: center;
    isolation: isolate;
  }

  .winner::before {
    position: absolute;
    z-index: -1;
    inset: -26% -8%;
    content: "";
    background: radial-gradient(ellipse, rgb(24 12 35 / 94%) 18%, rgb(23 11 33 / 72%) 46%, transparent 72%);
  }

  .winner strong {
    max-width: 100%;
    background: linear-gradient(#fffdf1 13%, #ffe4ab 55%, #f0ae5f 100%);
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 2px 0 #82502b) drop-shadow(0 4px 10px #0b0715) drop-shadow(0 0 15px color-mix(in srgb, var(--winner) 46%, #934da3));
    font-size: clamp(2.55rem, min(10.5cqw, 20cqh), 6.75rem);
    font-weight: 900;
    letter-spacing: -0.06em;
    line-height: 1.11;
    overflow-wrap: anywhere;
    text-wrap: balance;
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
    display: flex;
    align-items: center;
    gap: clamp(6px, 2cqw, 20px);
    color: #ffda90;
    font-size: clamp(0.85rem, 2.8cqw, 1.16rem);
    font-weight: 850;
    letter-spacing: 0.29em;
    text-indent: 0.29em;
    text-shadow: 0 0 12px #f6bb7475;
  }

  .result-label::before,
  .result-label::after {
    width: clamp(18px, 7cqw, 68px);
    height: 1px;
    content: "";
    background: linear-gradient(90deg, transparent, #eaa769);
  }

  .result-label::after {
    transform: rotate(180deg);
  }

  .pocket-result {
    color: #f7e2c5;
    font-size: clamp(0.8rem, 2.7cqw, 1rem);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-reduced-motion: no-preference) {
    .effects {
      animation: scene-dim 260ms ease-out both;
    }

    .beam {
      animation: beam 1.65s ease-out both;
    }

    .halo {
      animation: halo 0.96s var(--reveal-delay) cubic-bezier(0.16, 0.68, 0.2, 1) both;
    }

    .echo {
      animation-delay: calc(var(--reveal-delay) + 105ms);
    }

    .flare {
      animation: flare 0.75s var(--reveal-delay) ease-out both;
    }

    .spark {
      animation: spark var(--duration) calc(var(--reveal-delay) + var(--delay)) cubic-bezier(0.15, 0.68, 0.3, 1) both;
    }

    .winner {
      animation: winner-reveal 520ms var(--reveal-delay) cubic-bezier(0.16, 0.84, 0.27, 1) both;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .beam {
      opacity: 0.44;
    }

    .halo:not(.echo) {
      opacity: 0.47;
    }
  }

  @keyframes scene-dim {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes beam {
    0% { opacity: 0; scale: 0.34 0.65; }
    14% { opacity: 0.66; scale: 0.58 0.94; }
    21% { opacity: 0.98; scale: 1.13 1.02; }
    100% { opacity: 0.46; scale: 0.83 1; }
  }

  @keyframes halo {
    0% { opacity: 0; scale: 0.28; }
    17% { opacity: 0.85; }
    100% { opacity: 0; scale: 1.9; }
  }

  @keyframes flare {
    0% { opacity: 0; scale: 0.38 0.72; }
    12% { opacity: 1; scale: 1.12 1; }
    100% { opacity: 0; scale: 1.32 1.18; }
  }

  @keyframes spark {
    0% { opacity: 0; transform: rotate(var(--angle)) scale(0.35); }
    14% { opacity: 1; }
    60% { opacity: 0.84; }
    100% {
      opacity: 0;
      transform: translate(calc(var(--x) * 50cqw), calc(var(--y) * 50cqh)) rotate(var(--angle)) scale(0.34);
    }
  }

  @keyframes winner-reveal {
    0% { opacity: 0; transform: scale(0.83) translateY(8px); }
    33% { opacity: 1; transform: scale(1.07); }
    100% { opacity: 1; transform: scale(1); }
  }
</style>
