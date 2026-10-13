# DROPLOG 패치노트 입력

`patches.json`의 `items` 배열 맨 앞에 최신 패치를 추가합니다. 시안의 숫자는 예시이므로 복사하지 않고 PUBG 공식 패치노트를 확인한 내용만 입력합니다.

```json
{
  "items": [
    {
      "id": "고유한-문자열",
      "version": "UPDATE 00.0",
      "date": "YYYY.MM.DD",
      "title": "패치 제목",
      "summary": "공식 내용을 짧게 요약",
      "tags": ["change"],
      "impact": "우리 스쿼드 기록과 비교한 영향",
      "sourceUrl": "https://pubg.com/...",
      "weapons": [
        {
          "name": "총기명",
          "type": "buff",
          "stats": [["항목", "이전", "이후", "up"]],
          "note": "변경 설명"
        }
      ],
      "returns": [["콘텐츠명", "기간 또는 설명", "사녹"]]
    }
  ]
}
```

- `tags`, `type`: `buff`, `nerf`, `change`, `return`, `new`
- 수치 상승은 `up`, 하락은 `down`
- `weapons`와 `returns`가 없으면 빈 배열을 사용합니다.
