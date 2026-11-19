# Bob Gacha

물리 시뮬레이션을 이용한 뽑기 웹앱입니다.

## 설치

[mise](https://mise.jdx.dev/installing-mise.html)를 설치한 뒤 저장소 루트에서 실행합니다.

```sh
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
```

## 로컬 실행

```sh
mise exec -- pnpm dev
```

[http://localhost:5173/bob-gacha/](http://localhost:5173/bob-gacha/)에서 엽니다.

후보를 한 줄에 하나씩 2~12개 입력하고 카지노 룰렛이나 구슬 경주를 시작합니다. WebGL 2를 지원하는 브라우저가 필요합니다.

## 룰렛 음원

[f_ilippo의 에비앙 카지노 룰렛 녹음](https://freesound.org/people/f_ilippo/sounds/59194/)에서 레일 주행(0.79~2.89초), 느린 구름(13.25~15.24초), 포켓 충돌(20.03~21.58초)을 잘라 사용했습니다. 주행 구간은 반복 재생할 수 있게 양끝을 겹쳐 편집했습니다.

포켓 구름에는 [Hashdemboii의 목재 위 플라스틱 공](https://freesound.org/people/Hashdemboii/sounds/493244/), 바닥과 중앙부 충돌에는 [cabled_mess의 나무 탁자 위 주사위](https://freesound.org/people/cabled_mess/sounds/565982/)와 [AmberdeMeillon의 당구공 충돌](https://freesound.org/people/AmberdeMeillon/sounds/443066/)을 각각 섞었습니다. 모두 Freesound의 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/deed.ko) 녹음에서 편집했습니다.

## 당첨 효과음

룰렛과 구슬 경주는 직접 합성한 당첨 효과음을 사용합니다. 음이 올라간 뒤 0.26초에 이름과 빛이 나타나는 타격음이 울리고, 이어 높은 차임이 잦아듭니다.
