# 치킨로그 — PUBG 스쿼드 결산 디스코드 봇

PUBG PC/Steam 전적을 검색하고, 디스코드 친구들과 함께한 플레이를 MVP·킬왕·딜량왕·버스충으로 결산하는 봇입니다.

## 현재 기능

- PUBG 닉네임으로 평생 전적 검색
- 솔로/듀오/스쿼드와 FPP/TPP 모드 선택
- 승리, Top 10, 킬, K/D, 평균 딜량 등을 Discord Embed로 표시
- 디스코드 사용자와 PUBG 닉네임 연결
- 파티 참가 버튼과 최대 10명의 파티 세션
- 파티 시작 이후 함께 플레이한 경기 자동 수집
- 경기 기록 없이 현재 파티를 종료하는 파티 취소 명령과 버튼
- 팀 기록, MVP, 킬왕, 딜량왕, 생존왕 자동 결산
- 등록 정보와 파티 기록을 SQLite에 영구 저장
- 같은 닉네임의 결과를 기본 2분간 캐싱
- 원하는 디스코드 채널에서만 명령어를 허용하는 선택 설정

## 1. 필요한 계정과 키 준비

### Discord

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 `New Application`을 누릅니다.
2. `Bot` 메뉴에서 봇을 만들고 토큰을 발급받습니다.
3. `Installation` 메뉴에서 Guild Install에 `applications.commands`와 `bot`을 추가합니다.
4. 봇 권한으로 `View Channels`, `Send Messages`, `Embed Links`를 허용하고 테스트 서버에 설치합니다.

이 봇은 메시지 내용을 읽지 않으므로 Privileged Gateway Intents를 켤 필요가 없습니다.

### PUBG

1. [PUBG Developer Portal](https://developer.pubg.com/)에서 로그인합니다.
2. 개인 앱을 등록하고 무료 PUBG API 키를 발급받습니다.

Discord 토큰과 PUBG API 키는 다른 사람에게 보내거나 Git에 올리면 안 됩니다.

## 2. 프로젝트 설치

Node.js 22.5 이상이 필요합니다. PowerShell에서 이 프로젝트 폴더로 이동한 뒤 실행합니다.

```powershell
npm install
Copy-Item .env.example .env
```

`.env` 파일을 열어 다음 네 값을 입력합니다.

```env
DISCORD_TOKEN=Discord Bot Token
DISCORD_CLIENT_ID=Discord Application ID
DISCORD_GUILD_ID=테스트 서버 ID
PUBG_API_KEY=PUBG API Key
```

디스코드 ID를 복사하려면 디스코드의 `사용자 설정 → 고급 → 개발자 모드`를 켭니다. 그 후 서버 아이콘을 우클릭하여 서버 ID를 복사할 수 있습니다.

## 3. 명령어 등록 및 실행

테스트 서버에 `/전적` 명령어를 등록합니다.

```powershell
npm run register
```

봇을 실행합니다.

```powershell
npm start
```

터미널에 `치킨로그 봇이 준비되었습니다.`가 나타나면 디스코드에서 실행합니다.

```text
/전적 닉네임:PLAYER_NAME 모드:스쿼드 FPP
```

## 파티 결산 사용 순서

파티에 참가할 사람은 최초 한 번 자신의 PUBG 닉네임을 등록합니다.

```text
/등록 닉네임:PLAYER_NAME
```

파티장이 게임을 시작하기 전에 아래 명령어를 실행합니다.

```text
/파티시작
```

함께 플레이할 친구들은 생성된 메시지의 `파티 참가` 버튼을 누릅니다. 모든 참가자는 먼저 `/등록`을 완료해야 합니다.

PUBG 플레이를 마친 뒤 파티장이 `결산하기` 버튼을 누르거나 아래 명령어를 실행합니다.

```text
/파티결산
```

파티 시작 이후 참가자 중 2명 이상이 함께 플레이한 매치를 찾아 팀 기록과 MVP를 보여줍니다. PUBG API에 새 경기가 반영되기까지 시간이 걸릴 수 있으므로, 경기를 찾지 못하면 잠시 기다렸다가 다시 결산하면 됩니다.

경기 없이 파티를 끝내거나 결산할 경기가 없을 때는 파티장이 `파티 취소` 버튼을 누르거나 아래 명령어를 실행합니다.

```text
/파티취소
```

파티장 또는 서버 관리자만 파티를 결산하거나 취소할 수 있습니다. 취소 후에는 같은 채널에서 바로 새 파티를 시작할 수 있습니다.

등록 정보와 파티 세션은 기본적으로 `data/bot.sqlite`에 저장됩니다. 이 파일은 공개 저장소에 올리지 않는 것이 좋습니다.

터미널을 닫거나 컴퓨터를 끄면 봇도 오프라인이 됩니다. 개발이 끝난 뒤 같은 프로젝트를 클라우드 서버에 배포하면 24시간 실행할 수 있습니다.

## 특정 채널에서만 사용하기

디스코드 채널을 우클릭해 채널 ID를 복사하고 `.env`에 입력합니다.

```env
ALLOWED_CHANNEL_ID=채널_ID
```

비워두면 서버의 모든 채널에서 사용할 수 있습니다.

## 실제 운영 서버로 옮기기

테스트가 끝난 뒤 봇을 운영 서버에 초대하고 해당 서버 ID를 `DISCORD_GUILD_ID`에 입력한 다음 `npm run register`를 다시 실행하면 됩니다.

여러 서버에서 공용으로 사용할 단계가 되면 아래 값을 변경하고 명령어를 한 번 더 등록합니다.

```env
REGISTER_GLOBALLY=true
```

전역 명령어는 디스코드에 반영되는 데 시간이 걸릴 수 있습니다.

## 자주 발생하는 문제

- `/전적`이 보이지 않음: `npm run register`를 실행했는지, `DISCORD_GUILD_ID`가 맞는지 확인합니다.
- 봇이 오프라인임: `npm start`가 실행 중인지 확인합니다.
- PUBG 인증 오류: `PUBG_API_KEY` 앞뒤에 공백이 없는지 확인합니다.
- 파티에 참가할 수 없음: 해당 서버에서 `/등록`을 먼저 실행했는지 확인합니다.
- 결산할 경기가 없음: 파티 시작 이후 실제로 함께 플레이했는지 확인하고 API 반영을 잠시 기다립니다.
- 경기 없이 파티를 종료하고 싶음: 파티장 또는 서버 관리자가 `/파티취소`를 실행합니다.
- 닉네임을 못 찾음: 현재 기본 플랫폼은 PC/Steam이며 PUBG Mobile은 공식 API에서 지원하지 않습니다.
- 요청 제한 오류: 개발용 PUBG 키의 기본 제한은 분당 10회입니다. 잠시 기다린 뒤 다시 시도합니다.
- 실행할 때 SQLite 실험 기능 경고가 보임: Node.js 내장 SQLite 안내이며 봇 실행에는 영향을 주지 않습니다.

## 테스트

```powershell
npm test
```
