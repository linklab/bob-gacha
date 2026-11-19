<script lang="ts">
  import timing from "../lib/audio/draw-win-timing.json";
  import type { DrawResult } from "../lib/draw";

  let { result }: { result: DrawResult } = $props();

  const colors = ["#fff1a5", "#ffbd62", "#fffbea", "#d7adff", "#85edff"];
  const bursts = [
    { x: 50, y: 51, time: timing.impactMs, count: 46, color: "#ffe5a1" },
    { x: 22, y: 35, time: timing.leftBurstMs, count: 23, color: "#c3a4ff" },
    { x: 78, y: 63, time: timing.rightBurstMs, count: 26, color: "#ffc178" },
  ];
  const emitters = bursts.map((burst, wave) => ({
    ...burst,
    sparks: Array.from({ length: burst.count }, (_, index) => {
      const angle = ((index * 137.5 + wave * 63) * Math.PI) / 180;
      const reach = 0.46 + ((index * 11) % 17) / 21;
      return {
        x: Math.cos(angle) * reach,
        y: Math.sin(angle) * reach,
        angle: `${(angle * 180) / Math.PI + 90}deg`,
        size: 0.49 + (index % 6) * 0.18,
        delay: `${(index % 7) * 23}ms`,
        duration: `${1150 + ((index * 83) % 7) * 165 + wave * 85}ms`,
        color: colors[(index + wave) % colors.length],
      };
    }),
  }));
  const embers = Array.from({ length: 24 }, (_, index) => ({
    x: `${6 + ((index * 37) % 89)}%`,
    y: `${33 + ((index * 29) % 62)}%`,
    size: `${4 + ((index * 11) % 9)}px`,
    drift: `${((index * 17) % 37) - 18}cqw`,
    rise: `${12 + ((index * 13) % 21)}cqh`,
    delay: `${-((index * 421) % 3900)}ms`,
    duration: `${3200 + ((index * 271) % 2200)}ms`,
    color: colors[index % colors.length],
  }));
</script>

<div
  class="draw-result"
  data-testid="draw-result"
  style:--winner={result.candidate.color}
  style:--reveal-delay={`${timing.impactMs}ms`}
>
  <div class="effects" aria-hidden="true">
    <span class="beam"></span>
    <span class="charge"></span>
    <span class="rays"></span>
    <span class="flare"></span>
    <div class="afterglow">
      <span class="orbit"></span>
      {#each embers as ember (ember.x)}
        <span
          class="ember"
          style:left={ember.x}
          style:top={ember.y}
          style:--size={ember.size}
          style:--drift={ember.drift}
          style:--rise={ember.rise}
          style:--delay={ember.delay}
          style:--duration={ember.duration}
          style:--color={ember.color}
        ></span>
      {/each}
    </div>
    {#each emitters as burst (burst.time)}
      <div
        class="emitter"
        class:main-burst={burst.time === timing.impactMs}
        style:left={`${burst.x}%`}
        style:top={`${burst.y}%`}
        style:--burst-time={`${burst.time}ms`}
        style:--burst-color={burst.color}
      >
        <span class="shockwave"></span>
        <span class="bloom"></span>
        {#each burst.sparks as spark (spark.angle)}
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
    {/each}
  </div>

  <div class="winner">
    <span class="crest" aria-hidden="true"></span>
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
    overflow: hidden;
    pointer-events: none;
  }

  .effects {
    position: absolute;
    inset: 0;
    isolation: isolate;
    background:
      radial-gradient(ellipse at 50% 52%, rgb(102 46 138 / 36%), transparent 60%),
      radial-gradient(ellipse at center, rgb(15 6 24 / 12%) 4%, rgb(8 4 20 / 90%) 91%);
  }

  .beam,
  .charge,
  .rays,
  .flare,
  .emitter,
  .shockwave,
  .bloom,
  .spark {
    position: absolute;
    pointer-events: none;
  }

  .beam,
  .charge,
  .rays,
  .flare,
  .shockwave,
  .bloom,
  .spark {
    opacity: 0;
  }

  .beam {
    inset: -7% 7% -12%;
    transform-origin: 50% 50%;
    mix-blend-mode: screen;
    background:
      linear-gradient(90deg, transparent 42%, #ffa94b4d 48%, #fff0b59a 49.4%, #fffbe1dd 50%, #e9adff82 51%, transparent 58%),
      radial-gradient(ellipse at 50% 20%, #c865ffbd, transparent 56%),
      radial-gradient(ellipse at 50% 70%, #ffaf4caa, transparent 60%);
    clip-path: polygon(18% 0, 82% 0, 54% 48%, 73% 100%, 27% 100%, 46% 48%);
    mask-image: linear-gradient(transparent, #000 18%, #000 66%, transparent);
  }

  .charge,
  .shockwave,
  .bloom,
  .spark {
    top: 0;
    left: 0;
    translate: -50% -50%;
  }

  .charge {
    top: 51%;
    left: 50%;
    width: min(70cqw, 72cqh, 620px);
    aspect-ratio: 1;
    border: 1px solid #ddaaff;
    border-radius: 22%;
    background: radial-gradient(circle, #ffd29266, transparent 68%);
    box-shadow: 0 0 34px #a55cffa6, inset 0 0 24px #edbaff70;
  }

  .rays {
    inset: -38%;
    transform-origin: 50% 51%;
    mix-blend-mode: screen;
    background: conic-gradient(from 0deg at 50% 51%,
      transparent 0 9deg, #ffe2a670 12deg, transparent 15deg 35deg,
      #d599ff9c 38deg, transparent 41deg 60deg, #ffcf7e72 64deg, transparent 67deg 89deg,
      #fff0bdcf 91deg, transparent 94deg 111deg, #c4a8ff7a 113deg, transparent 117deg 150deg,
      #ffe0a489 153deg, transparent 160deg 179deg, #ffc77a90 182deg, transparent 187deg 203deg,
      #b7ccfd89 208deg, transparent 212deg 233deg, #ffe8bb8c 236deg, transparent 241deg 266deg,
      #fdd69ec0 268deg, transparent 271deg 294deg, #d0a3ff7e 298deg, transparent 305deg 326deg,
      #ffbd6c82 329deg, transparent 335deg 360deg);
    mask-image: radial-gradient(ellipse at 50% 51%, #000 5%, #000a 29%, transparent 65%);
  }

  .flare {
    inset: 0;
    mix-blend-mode: screen;
    background:
      radial-gradient(ellipse 58% 1.2% at 50% 51%, #fffce4, #ffcf8dac 55%, transparent 100%),
      radial-gradient(ellipse 50% 13% at 50% 51%, #fff6c4ce, #f2a54755 53%, transparent 100%),
      radial-gradient(ellipse 46% 59% at 50% 51%, #ffdfb584, #a475fa43 61%, transparent 100%);
  }

  .emitter {
    --wave-size: min(33cqw, 36cqh, 260px);
    --reach-x: 34cqw;
    --reach-y: 42cqh;
  }

  .main-burst {
    --wave-size: min(61cqw, 67cqh, 600px);
    --reach-x: 50cqw;
    --reach-y: 51cqh;
  }

  .shockwave {
    width: var(--wave-size);
    aspect-ratio: 1;
    transform: rotate(45deg);
    border: 2px solid var(--burst-color);
    border-radius: 22%;
    box-shadow: 0 0 28px var(--burst-color), inset 0 0 22px color-mix(in srgb, var(--burst-color) 68%, transparent);
  }

  .bloom {
    width: calc(var(--wave-size) * 1.55);
    aspect-ratio: 1;
    mix-blend-mode: screen;
    background: radial-gradient(circle, var(--burst-color), color-mix(in srgb, var(--burst-color) 42%, transparent) 23%, transparent 68%);
  }

  .spark {
    width: calc(clamp(2px, 0.63cqw, 7px) * var(--size));
    height: calc(clamp(10px, 3.8cqw, 43px) * var(--size));
    background: linear-gradient(#fffdf2, var(--color) 32%, transparent);
    clip-path: polygon(50% 0, 100% 20%, 53% 100%, 0 22%);
  }

  .spark:nth-child(3n) {
    width: calc(clamp(5px, 1.35cqw, 15px) * var(--size));
    height: auto;
    aspect-ratio: 1;
    background: var(--color);
    clip-path: polygon(50% 0, 63% 37%, 100% 50%, 63% 63%, 50% 100%, 37% 63%, 0 50%, 37% 37%);
  }

  .afterglow,
  .orbit,
  .ember {
    position: absolute;
  }

  .afterglow {
    inset: 0;
    opacity: 0;
    mix-blend-mode: screen;
  }

  .orbit {
    inset: 50% auto auto 50%;
    width: min(106cqw, 128cqh, 920px);
    aspect-ratio: 1;
    translate: -50% -50%;
    border-radius: 50%;
    background: conic-gradient(from 28deg,
      transparent 14%, #e8a6ffac 22%, #fff1bf 25%, transparent 31% 49%,
      #e6a65495 60%, #fff1bf 63%, transparent 68% 84%, #a68de367 91%, transparent 99%);
    mask-image: radial-gradient(circle, transparent 55%, #0004 60%, #000 65%, transparent 72%);
  }

  .ember {
    width: var(--size);
    aspect-ratio: 1;
    background: var(--color);
    box-shadow: 0 0 9px var(--color), 0 0 22px var(--color);
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

  .crest {
    --cut: polygon(0 50%, 9% 14%, 29% 14%, 34% 0, 66% 0, 71% 14%, 91% 14%, 100% 50%, 91% 86%, 71% 86%, 66% 100%, 34% 100%, 29% 86%, 9% 86%);
    position: absolute;
    z-index: -1;
    inset: -9% -2%;
    filter: drop-shadow(0 0 23px #bc68ef94) drop-shadow(0 7px 18px #100921ab);
  }

  .crest::before,
  .crest::after {
    position: absolute;
    content: "";
    clip-path: var(--cut);
  }

  .crest::before {
    inset: 0;
    background: linear-gradient(130deg, #ba75f744 9%, #f7c875 36%, #fff7bf 50%, #af724d 65%, #bd7bff64 91%);
  }

  .crest::after {
    inset: 2px;
    background:
      radial-gradient(ellipse at 50% 102%, #8b5143b5, transparent 53%),
      radial-gradient(ellipse at 50% -25%, #764b91d9, transparent 60%),
      linear-gradient(100deg, #311746f3, #1a1129 46% 55%, #371e43f7);
  }

  .winner strong {
    max-width: 100%;
    background: linear-gradient(106deg, transparent 39%, #fffdeb 50%, transparent 61%) 110% 50% / 250% 100%,
      linear-gradient(#fffdf1 13%, #ffe4ab 55%, #f0ae5f 100%);
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
      animation: scene-dim var(--reveal-delay) ease-out both;
    }

    .beam {
      animation: beam 3.4s ease-out both;
    }

    .charge {
      animation: charge var(--reveal-delay) cubic-bezier(0.35, 0, 0.8, 1) both;
    }

    .rays {
      animation: rays 2.8s var(--reveal-delay) ease-out both;
    }

    .shockwave {
      animation: shockwave 1.26s var(--burst-time) cubic-bezier(0.16, 0.57, 0.27, 1) both;
    }

    .bloom {
      animation: bloom 0.86s var(--burst-time) ease-out both;
    }

    .flare {
      animation: flare 0.88s var(--reveal-delay) ease-out both;
    }

    .spark {
      animation: spark var(--duration) calc(var(--burst-time) + var(--delay)) cubic-bezier(0.12, 0.57, 0.24, 1) both;
    }

    .afterglow {
      animation: scene-dim 1.4s calc(var(--reveal-delay) + 240ms) ease-out both;
    }

    .orbit {
      animation: orbit 21s linear infinite;
    }

    .ember {
      animation: ember var(--duration) var(--delay) linear infinite;
    }

    .winner {
      animation: winner-reveal 740ms var(--reveal-delay) cubic-bezier(0.16, 0.84, 0.27, 1) both;
    }

    .winner strong {
      animation: title-shine 4s calc(var(--reveal-delay) + 640ms) ease-in-out infinite both;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .beam {
      opacity: 0.40;
    }

    .main-burst .shockwave {
      opacity: 0.46;
    }
  }

  @keyframes scene-dim {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes charge {
    0% { opacity: 0; transform: rotate(9deg) scale(1.22); }
    40% { opacity: 0.7; }
    82% { opacity: 1; }
    100% { opacity: 0; transform: rotate(48deg) scale(0.16); }
  }

  @keyframes beam {
    0% { opacity: 0; scale: 0.12 0.68; }
    12% { opacity: 0.91; scale: 0.35 0.96; }
    17% { opacity: 1; scale: 1.31 1.06; }
    35% { opacity: 0.82; }
    62% { opacity: 0.67; }
    100% { opacity: 0.42; scale: 0.95 1; }
  }

  @keyframes rays {
    0% { opacity: 0; transform: rotate(-13deg) scale(0.79); }
    7% { opacity: 1; }
    31% { opacity: 0.76; }
    65% { opacity: 0.35; }
    100% { opacity: 0.16; transform: rotate(14deg) scale(1.12); }
  }

  @keyframes shockwave {
    0% { opacity: 0; scale: 0.13; }
    13% { opacity: 0.92; }
    54% { opacity: 0.42; }
    100% { opacity: 0; scale: 1.93; }
  }

  @keyframes bloom {
    0% { opacity: 0; scale: 0.11; }
    14% { opacity: 0.87; scale: 0.9; }
    100% { opacity: 0; scale: 1.45; }
  }

  @keyframes flare {
    0% { opacity: 0; scale: 0.5 0.7; }
    11% { opacity: 1; scale: 1.07 1; }
    35% { opacity: 0.48; }
    100% { opacity: 0; scale: 1.25 1.15; }
  }

  @keyframes spark {
    0% { opacity: 0; transform: rotate(var(--angle)) scale(0.3); }
    16% { opacity: 1; }
    52% {
      opacity: 0.92;
      transform: translate(calc(var(--x) * var(--reach-x) * 0.76), calc(var(--y) * var(--reach-y) * 0.78)) rotate(var(--angle));
    }
    100% {
      opacity: 0;
      transform: translate(calc(var(--x) * var(--reach-x)), calc(var(--y) * var(--reach-y) + 8cqh)) rotate(calc(var(--angle) + 37deg)) scale(0.42);
    }
  }

  @keyframes winner-reveal {
    0% { opacity: 0; transform: scale(0.73) translateY(10px); }
    31% { opacity: 1; transform: scale(1.09); }
    59% { opacity: 1; transform: scale(0.99); }
    100% { opacity: 1; transform: scale(1); }
  }

  @keyframes orbit {
    from { transform: rotate(0) scale(1.07) rotateX(16deg); }
    to { transform: rotate(1turn) scale(1.07) rotateX(16deg); }
  }

  @keyframes ember {
    0% { opacity: 0; transform: translate(0, 4cqh) rotate(45deg) scale(0.35); }
    17% { opacity: 0.93; }
    35% { opacity: 0.52; }
    58% { opacity: 0.84; }
    100% {
      opacity: 0;
      transform: translate(var(--drift), calc(-1 * var(--rise))) rotate(170deg) scale(0.64);
    }
  }

  @keyframes title-shine {
    0%, 38% { background-position: 112% 50%, center; }
    76%, 100% { background-position: -12% 50%, center; }
  }
</style>
