코드는 Claude Code(Opus)가 작성했고, 기획, 명세, 하네스, 검증 시나리오, 최종 판단은 개발자가 맡았습니다. 커밋의 Co-Authored-By 트레일러가 그 기록입니다.

# AgentHandover (`agent-cli`)

Claude Code의 로컬 세션 메타데이터와 현재 Git 경로를 읽어 반복 작업 패턴을 찾고, 다음 프로젝트에서 재사용할 커스텀 에이전트 정의를 만드는 TypeScript CLI입니다.

## 범위와 차별점

대화 기록에서 온보딩 문서나 메모리·규칙을 만드는 도구, 현재 대화에서 에이전트 하나를 생성하는 기능과 문제 영역은 겹칩니다. AgentHandover가 다루는 범위는 **여러 세션의 서브에이전트 메타데이터에서 반복 역할을 군집화하고, 세션 빈도로 신뢰도를 매기며, 현재 Git HEAD에 존재하는 경로만 남겨 실행 가능한 `.claude/agents/*.md` 여러 개로 변환하는 과정**입니다.

최초이거나 유일한 접근이라고 주장하지 않습니다. 이 도구의 목적은 세션을 요약하는 데 그치지 않고 사람이 빠진 뒤에도 다음 사람과 에이전트가 검토 가능한 근거와 함께 같은 역할을 다시 실행하도록 만드는 것입니다.

## 처리 흐름

```text
scanner
  ~/.claude/projects 아래의 세션·서브에이전트 메타데이터 수집
  + 현재 저장소에서 실제로 존재하는 Git 경로 요약
        ↓
analyzer
  설명을 로컬 규칙으로 1차 그룹화
  + 그룹 요약만 `claude -p`에 전달해 후보명·신뢰도 정리
        ↓
generator
  선택한 후보를 `.claude/agents/<name>.md`로 생성
```

원본 JSONL 전체를 저장소에 복사하지 않습니다. 분석 전에는 세션 설명에 회사명, 고객 데이터, 자격증명이나 개인 정보가 포함되지 않았는지 사용자가 직접 확인해야 합니다.

## 설치와 실행

Node.js 20 이상과 로그인된 Claude Code CLI가 필요합니다.

```bash
npm install
npm run build
node dist/index.js init
node dist/index.js analyze
node dist/index.js generate --dry-run
node dist/index.js generate
```

- `init`: 개인용 또는 팀 공유 에이전트 위치를 선택합니다.
- `analyze [--project <name>] [--no-cache]`: 세션을 스캔하고 반복 패턴을 분류합니다.
- `generate [--all] [--only <names>] [--exclude <names>] [--team] [--dry-run]`: 후보를 검토하고 에이전트 파일을 생성합니다.

분석과 생성은 Anthropic API 키를 직접 전달하는 대신 설치된 Claude Code의 `claude -p`를 사용합니다. 실제 파일을 만들기 전에는 `--dry-run`으로 대상과 근거를 확인할 수 있습니다.

## 합성 예제

[`examples/synthetic-session/`](examples/synthetic-session/)은 scanner가 읽는 메타데이터와 JSONL의 최소 형태를 보여 주는 완전한 합성 데이터입니다. 실제 사용자, 회사, 저장소 또는 세션에서 가져온 값은 없습니다.

## 개발

```bash
npm run build
npm run dev -- --help
```

## 라이선스

[MIT License](LICENSE)
