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
