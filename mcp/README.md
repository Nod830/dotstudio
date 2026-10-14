# 도트공방 MCP 서버

Claude Code나 Codex가 도트공방을 직접 조작하게 해 주는 MCP 서버예요. 외부 패키지가 없어서 Node만 있으면 돼요.

## 연결하기

### Claude Code
전역(모든 폴더)으로 등록돼 있어요. 다시 등록할 때:

```bash
claude mcp add --scope user dotstudio -- node C:/hg11/DotStudio/dotstudio/mcp/server.js
```

지울 때:

```bash
claude mcp remove dotstudio -s user
```

### Codex
`~/.codex/config.toml`에 추가:

```toml
[mcp_servers.dotstudio]
command = "node"
args = ["C:/hg11/DotStudio/dotstudio/mcp/server.js"]
```

## 쓰기

1. AI 도구를 켜면 MCP 서버가 같이 켜져요.
2. 브라우저로 **http://localhost:5174** 를 열어요. (`node serve.js`로 띄운 5173 화면도 자동으로 연결돼요.)
3. 상단에 **🤖 AI 연결됨**이 보이면 준비 끝이에요. AI에게 "32×32 슬라임 Idle 4프레임 그려 줘"처럼 말하면 돼요.

AI가 한 작업도 작업 기록에 남아서 Ctrl+Z로 되돌릴 수 있어요.

## 도구

| 도구 | 하는 일 |
|---|---|
| `get_state` | 크기 · 레이어 · 프레임 · 태그 · 팔레트 보기 |
| `get_image` | 지금 그림을 이미지로 받기 (AI가 결과 확인) |
| `new_sprite` | 새 그림 |
| `draw_ascii` | 글자 그림으로 그리기 (`#`=검정 같은 식) |
| `set_pixels` · `draw_shape` · `fill` · `clear` | 점 · 직선/사각형/원 · 채우기 · 지우기 |
| `transform` | 뒤집기 · 90° 회전 · 옮기기 |
| `layer` · `frame` · `tag` | 레이어 · 프레임 · 태그 관리 |
| `palette` | 팔레트와 주 색 / 보조 색 |
| `apply_effect` | 외곽선 · 색 바꾸기 · 색조/밝기 |
| `history` | 실행 취소 · 다시 실행 |
| `export` | .aseprite · PNG · GIF · 시트+JSON. `path`를 주면 그 경로(예: Unity Assets)에 바로 저장 |
| `open_file` · `import_sheet` | 디스크의 파일 열기 · 시트 나눠 가져오기 |

## 참고

- 서버는 이 컴퓨터(127.0.0.1)에서만 받아요. 다른 웹사이트의 요청은 막아요.
- 포트를 바꾸려면 `DOTSTUDIO_MCP_PORT` 환경 변수를 쓰세요. 이때 브라우저 쪽(`js/mcp-bridge.js`)의 주소도 같이 바꿔야 해요.
- Claude Code와 Codex를 동시에 켜도 돼요. 먼저 켠 쪽이 포트를 열고, 나중에 켠 쪽은 그 서버를 거쳐서 같은 도트공방을 함께 써요. 먼저 켠 쪽이 꺼지면 남은 쪽이 이어받고, 이때 브라우저가 다시 붙기까지 몇 초 걸려요. 같은 그림을 동시에 건드리면 순서대로 처리돼요.
- 확인용 테스트: 브라우저에 도트공방을 열어 둔 채로 `node tests/mcp-smoke.js`
